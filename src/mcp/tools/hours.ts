import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaFetch, severaPaginate } from "../../severa/client";
import { requireSeveraUserGuid } from "../../severa/user-resolver";
import { helsinkiToday, helsinkiWeekRange } from "../../severa/dates";
import type {
  TimeEntryModel,
  WorkHourOutputModel,
  WorkdayOutputModel,
} from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { toText } from "../format";
import {
  effectiveUserGuids,
  filterVisible,
  requireCategoryAccess,
  requireEffectiveVisible,
  requireVisible,
  requireVisibleIfRequested,
} from "../../authz";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export function registerHoursReadTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_get_my_hours",
    {
      description:
        "List the signed-in user's work hours in a date range. Defaults to the current week (Europe/Helsinki).",
      inputSchema: {
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Get my hours" },
    },
    async ({ from, to }) => {
      await requireCategoryAccess(env, props, "hours");
      const userGuid = await requireSeveraUserGuid(env, props.email);
      const range = from && to ? { from, to } : helsinkiWeekRange();
      const rows = await severaPaginate<WorkHourOutputModel>(
        env,
        `/v1/users/${userGuid}/workhours`,
        {
          query: { startDate: range.from, endDate: range.to, rowCount: 500 },
        },
      );
      if (!rows.length)
        return toText(`No work hours for ${props.email} between ${range.from} and ${range.to}.`);
      const totalHours = rows.reduce((s, r) => s + r.quantity, 0);
      const byProject = new Map<string, number>();
      for (const r of rows) {
        const k = r.project.name;
        byProject.set(k, (byProject.get(k) ?? 0) + r.quantity);
      }
      const breakdown = [...byProject.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, h]) => `- ${name}: **${h.toFixed(2)}h**`)
        .join("\n");
      return toText(
        `**${totalHours.toFixed(2)}h** logged ${range.from} → ${range.to}\n\nBy project:\n${breakdown}`,
      );
    },
  );

  server.registerTool(
    "severa_get_unbilled_hours",
    {
      description:
        "Sum billable-but-not-yet-invoiced work-hour quantity for a given project.",
      inputSchema: { projectGuid: z.string().uuid() },
      annotations: { ...READ_ANNOTATIONS, title: "Get unbilled hours" },
    },
    async ({ projectGuid }) => {
      const authz = await requireCategoryAccess(env, props, "hours");
      const rows = await severaPaginate<WorkHourOutputModel>(
        env,
        `/v1/projects/${projectGuid}/workhours`,
        {
          query: { isBillable: true, isBilled: false, rowCount: 1000 },
        },
      );
      const visible = filterVisible(authz, rows, (r) => r.user?.guid);
      if (!visible.length) return toText("No unbilled hours on this project.");
      const total = visible.reduce((s, r) => s + r.quantity, 0);
      const byUser = new Map<string, number>();
      for (const r of visible) {
        const name =
          [r.user.firstName, r.user.lastName].filter(Boolean).join(" ") ||
          r.user.email ||
          r.user.userName ||
          r.user.guid;
        byUser.set(name, (byUser.get(name) ?? 0) + r.quantity);
      }
      const breakdown = [...byUser.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, h]) => `- ${name}: **${h.toFixed(2)}h**`)
        .join("\n");
      return toText(`**${total.toFixed(2)}h** unbilled\n\n${breakdown}`);
    },
  );
}

const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = () => z.string().uuid();

export function registerHoursListTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_work_hours",
    {
      description: [
        "List work-hour entries from `/v1/workhours` (global). Prefer the scoped `severa_get_my_hours` / `severa_get_unbilled_hours` when a single user or project is in scope — they're richer. This tool is for business-unit / date-range / billable-status queries that cross projects.",
        "",
        "Server-side filters (thin — pair with date range to avoid pagination ceiling):",
        "- `eventDateStart` / `eventDateEnd` — YYYY-MM-DD",
        "- `billableStatus` — `Billable` | `NotBillable` | `RemovedFromInvoice`",
        "- `businessUnitGuid` — single-value",
        "- `isApproved`",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `userGuid`, `projectGuid`, `phaseGuid`, `workTypeGuid`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        eventDateStart: isoDate().nullish(),
        eventDateEnd: isoDate().nullish(),
        billableStatus: z.enum(["Billable", "NotBillable", "RemovedFromInvoice"]).nullish(),
        businessUnitGuid: uuid().nullish(),
        isApproved: z.boolean().nullish(),
        changedSince: isoDate().nullish(),
        userGuid: uuid().nullish(),
        projectGuid: uuid().nullish(),
        phaseGuid: uuid().nullish(),
        workTypeGuid: uuid().nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List work hours" },
    },
    async (args) => {
      const authz = await requireCategoryAccess(env, props, "hours");
      const limit = args.limit ?? 100;
      requireVisibleIfRequested(authz, args.userGuid, "view work hours");
      const rows = await severaPaginate<WorkHourOutputModel>(env, "/v1/workhours", {
        query: {
          ...(args.eventDateStart ? { eventDateStart: args.eventDateStart } : {}),
          ...(args.eventDateEnd ? { eventDateEnd: args.eventDateEnd } : {}),
          ...(args.billableStatus ? { billableStatus: args.billableStatus } : {}),
          ...(args.businessUnitGuid ? { businessUnitGuid: args.businessUnitGuid } : {}),
          ...(args.isApproved != null ? { isApproved: args.isApproved } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const visible = filterVisible(authz, rows, (r) => r.user?.guid);
      const hits = visible
        .filter((r) => {
          if (args.userGuid && r.user?.guid !== args.userGuid) return false;
          if (args.projectGuid && r.project?.guid !== args.projectGuid) return false;
          if (args.phaseGuid && r.phase?.guid !== args.phaseGuid) return false;
          if (args.workTypeGuid && r.workType?.guid !== args.workTypeGuid) return false;
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No work-hour entries match those filters.");
      const totalHours = hits.reduce((s, r) => s + (r.quantity ?? 0), 0);
      return toText(
        `${hits.length} entr${hits.length === 1 ? "y" : "ies"}${hits.length < visible.length ? ` (of ${visible.length} fetched)` : ""} — total ${totalHours.toFixed(2)}h:\n${hits.map(renderWorkHourRow).join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_list_time_entries",
    {
      description: [
        "List time-entry records from `/v1/timeentries` (punch-clock style, distinct from billable work hours).",
        "",
        "Server-side filters:",
        "- `phaseGuid`",
        "- `timeEntryTypeGuid` — via `severa_query({ path: '/v1/timeentrytypes' })`",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `userGuid` — post-fetch",
        "- `eventDateStart` / `eventDateEnd` — YYYY-MM-DD on `eventDate`",
        "",
        "For user-scoped queries, prefer `severa_query({ path: '/v1/users/{userGuid}/timeentries' })`.",
      ].join("\n"),
      inputSchema: {
        phaseGuid: uuid().nullish(),
        timeEntryTypeGuid: uuid().nullish(),
        changedSince: isoDate().nullish(),
        userGuid: uuid().nullish(),
        eventDateStart: isoDate().nullish(),
        eventDateEnd: isoDate().nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List time entries" },
    },
    async (args) => {
      const authz = await requireCategoryAccess(env, props, "hours");
      const limit = args.limit ?? 100;
      requireVisibleIfRequested(authz, args.userGuid, "view time entries");
      const rows = await severaPaginate<TimeEntryModel>(env, "/v1/timeentries", {
        query: {
          ...(args.phaseGuid ? { phaseGuid: args.phaseGuid } : {}),
          ...(args.timeEntryTypeGuid ? { timeEntryTypeGuid: args.timeEntryTypeGuid } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const visible = filterVisible(authz, rows, (r) => r.user?.guid);
      const hits = visible
        .filter((r) => {
          if (args.userGuid && r.user?.guid !== args.userGuid) return false;
          if (args.eventDateStart || args.eventDateEnd) {
            const d = r.eventDate?.slice(0, 10);
            if (!d) return false;
            if (args.eventDateStart && d < args.eventDateStart) return false;
            if (args.eventDateEnd && d > args.eventDateEnd) return false;
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No time entries match those filters.");
      return toText(
        `${hits.length} entr${hits.length === 1 ? "y" : "ies"}${hits.length < visible.length ? ` (of ${visible.length} fetched)` : ""}:\n${hits.map(renderTimeEntryRow).join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_list_workdays",
    {
      description: [
        "List workday records from `/v1/workdays` (attendance / day-level summaries).",
        "",
        "Server-side filters:",
        "- `startDate`, `endDate` — YYYY-MM-DD",
        "- `userGuid` / `userGuids`",
        "- `isCompleted`",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "For single-user queries, prefer `severa_query({ path: '/v1/users/{userGuid}/workdays' })`.",
      ].join("\n"),
      inputSchema: {
        startDate: isoDate().nullish(),
        endDate: isoDate().nullish(),
        userGuid: uuid().nullish(),
        userGuids: z.array(uuid()).nullish(),
        isCompleted: z.boolean().nullish(),
        changedSince: isoDate().nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List workdays" },
    },
    async (args) => {
      const authz = await requireCategoryAccess(env, props, "hours");
      const limit = args.limit ?? 100;
      const requestedGuids = [
        ...(args.userGuid ? [args.userGuid] : []),
        ...(args.userGuids ?? []),
      ];
      const userGuids = effectiveUserGuids(authz, requestedGuids.length ? requestedGuids : undefined);
      requireEffectiveVisible(requestedGuids.length ? requestedGuids : undefined, userGuids, "view workdays");
      const rows = await severaPaginate<WorkdayOutputModel>(env, "/v1/workdays", {
        query: {
          ...(args.startDate ? { startDate: args.startDate } : {}),
          ...(args.endDate ? { endDate: args.endDate } : {}),
          ...(userGuids?.length ? { userGuids } : {}),
          ...(args.isCompleted != null ? { isCompleted: args.isCompleted } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      if (!rows.length) return toText("No workdays match those filters.");
      const hits = rows.slice(0, limit);
      const totalHours = hits.reduce((s, r) => s + (r.workHours ?? 0), 0);
      return toText(
        `${hits.length} workday(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""} — total ${totalHours.toFixed(2)}h:\n${hits.map(renderWorkdayRow).join("\n")}`,
      );
    },
  );
}

function renderWorkHourRow(r: WorkHourOutputModel): string {
  const who = [r.user?.firstName, r.user?.lastName].filter(Boolean).join(" ") || r.user?.userName || "?";
  const parts = [
    r.eventDate?.slice(0, 10),
    `${r.quantity}h`,
    who,
    r.project?.name,
    r.phase?.name,
    r.workType?.name,
    r.billableStatus,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}

function renderTimeEntryRow(r: TimeEntryModel): string {
  const who = [r.user?.firstName, r.user?.lastName].filter(Boolean).join(" ") || "?";
  const parts = [
    r.eventDate?.slice(0, 10),
    r.quantity != null ? `${r.quantity}h` : undefined,
    r.timeEntryType?.name,
    who,
    r.project?.name,
    r.phase?.name,
    r.description,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}

function renderWorkdayRow(r: WorkdayOutputModel): string {
  const who = [r.user?.firstName, r.user?.lastName].filter(Boolean).join(" ") || "?";
  const parts = [
    r.eventDate?.slice(0, 10),
    who,
    r.workHours != null ? `${r.workHours}h` : undefined,
    r.isCompleted === false ? "(not completed)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}

export function registerHoursWriteTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_log_hours",
    {
      description: [
        "Log a work-hour entry for the signed-in user. Requires a `phaseGuid` (phases belong to projects — discover via `severa_list_phases`) and a `workTypeGuid` (discover via `severa_query({ path: '/v1/worktypes' })`).",
        "",
        "For personal time-off (vacation, sick day, etc.), use an absence-type `workTypeGuid` — Severa models absences as work-hour entries under absence work types, not as separate 'holiday' records.",
      ].join("\n"),
      inputSchema: {
        phaseGuid: z.string().uuid(),
        workTypeGuid: z.string().uuid(),
        quantity: z.number().positive().max(24),
        eventDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish()
          .describe("YYYY-MM-DD (Europe/Helsinki). Defaults to today."),
        description: z.string().nullish(),
        isBillable: z.boolean().nullish(),
      },
      annotations: { ...WRITE_ANNOTATIONS, title: "Log work hours" },
    },
    async ({ phaseGuid, workTypeGuid, quantity, eventDate, description, isBillable }) => {
      await requireCategoryAccess(env, props, "hours");
      const userGuid = await requireSeveraUserGuid(env, props.email);
      const body = {
        user: { guid: userGuid },
        phase: { guid: phaseGuid },
        workType: { guid: workTypeGuid },
        quantity,
        eventDate: eventDate ?? helsinkiToday(),
        ...(description ? { description } : {}),
        ...(isBillable != null ? { isBillable } : {}),
      };
      const created = await severaFetch<WorkHourOutputModel>(env, "/v1/workhours", {
        method: "POST",
        body,
      });
      return toText(
        `Logged ${quantity}h on ${body.eventDate} to ${created.project?.name ?? "project"}. Entry GUID: \`${created.guid}\``,
      );
    },
  );

  server.registerTool(
    "severa_update_hours",
    {
      description: [
        "Update fields on an existing work-hour entry. Pass only the fields you want to change — they're packaged into a JSON Patch (RFC 6902) and sent to `/v1/workhours/{guid}`.",
        "",
        "Omitted fields are left untouched. Pass `description: \"\"` to clear a description; null is treated the same as omission.",
      ].join("\n"),
      inputSchema: {
        hoursGuid: z.string().uuid(),
        quantity: z.number().positive().max(24).nullish(),
        eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        description: z.string().nullish(),
        isBillable: z.boolean().nullish(),
        startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullish(),
        endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullish(),
        phaseGuid: z.string().uuid().nullish(),
        workTypeGuid: z.string().uuid().nullish(),
      },
      annotations: { ...WRITE_ANNOTATIONS, title: "Update work hours" },
    },
    async ({
      hoursGuid,
      quantity,
      eventDate,
      description,
      isBillable,
      startTime,
      endTime,
      phaseGuid,
      workTypeGuid,
    }) => {
      const authz = await requireCategoryAccess(env, props, "hours");
      const ops: Array<{ op: "replace"; path: string; value: unknown }> = [];
      if (quantity != null) ops.push({ op: "replace", path: "/quantity", value: quantity });
      if (eventDate != null) ops.push({ op: "replace", path: "/eventDate", value: eventDate });
      if (description != null) ops.push({ op: "replace", path: "/description", value: description });
      if (isBillable != null) ops.push({ op: "replace", path: "/isBillable", value: isBillable });
      if (startTime != null) ops.push({ op: "replace", path: "/startTime", value: startTime });
      if (endTime != null) ops.push({ op: "replace", path: "/endTime", value: endTime });
      if (phaseGuid != null) ops.push({ op: "replace", path: "/phase/guid", value: phaseGuid });
      if (workTypeGuid != null)
        ops.push({ op: "replace", path: "/workType/guid", value: workTypeGuid });

      if (!ops.length) return toText("No changes provided — specify at least one field to update.");

      const existing = await severaFetch<WorkHourOutputModel>(env, `/v1/workhours/${hoursGuid}`);
      requireVisible(authz, existing.user?.guid, "update this entry");

      await severaFetch<unknown>(env, `/v1/workhours/${hoursGuid}`, {
        method: "PATCH",
        body: ops,
      });
      return toText(
        `Updated ${ops.length} field(s) on \`${hoursGuid}\`: ${ops.map((o) => o.path.slice(1)).join(", ")}.`,
      );
    },
  );

  server.registerTool(
    "severa_delete_hours",
    {
      description:
        "Delete a work-hour entry by GUID (`DELETE /v1/workhours/{guid}`). Irreversible on the Severa side. Use only for entries that belong to the signed-in user — Severa enforces ownership, but surface it clearly in any confirmation prompt.",
      inputSchema: { hoursGuid: z.string().uuid() },
      annotations: {
        ...WRITE_ANNOTATIONS,
        destructiveHint: true,
        title: "Delete work hours",
      },
    },
    async ({ hoursGuid }) => {
      const authz = await requireCategoryAccess(env, props, "hours");
      const existing = await severaFetch<WorkHourOutputModel>(env, `/v1/workhours/${hoursGuid}`);
      requireVisible(authz, existing.user?.guid, "delete this entry");

      await severaFetch<unknown>(env, `/v1/workhours/${hoursGuid}`, { method: "DELETE" });
      return toText(`Deleted work-hour entry \`${hoursGuid}\`.`);
    },
  );

  server.registerTool(
    "severa_close_workday",
    {
      description: [
        "Mark a workday as completed / submitted (or reopen it). PATCHes `/v1/users/{userGuid}/workdays/{date}` with `isCompleted`. Defaults to the signed-in user and today.",
        "",
        "Use this when a user has finished logging hours for a day and wants to mark the day as done (locks the day from further edits in some Severa configs).",
      ].join("\n"),
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish()
          .describe("YYYY-MM-DD (Europe/Helsinki). Defaults to today."),
        isCompleted: z.boolean().nullish().describe("Default true. Set false to reopen a closed day."),
        userGuid: z
          .string()
          .uuid()
          .nullish()
          .describe("Defaults to the signed-in user."),
      },
      annotations: { ...WRITE_ANNOTATIONS, title: "Close workday" },
    },
    async ({ date, isCompleted, userGuid }) => {
      const authz = await requireCategoryAccess(env, props, "hours");
      const effectiveUser = userGuid ?? (await requireSeveraUserGuid(env, props.email));
      requireVisible(authz, effectiveUser, "close/reopen this workday");
      const effectiveDate = date ?? helsinkiToday();
      const completed = isCompleted ?? true;
      await severaFetch<unknown>(
        env,
        `/v1/users/${effectiveUser}/workdays/${effectiveDate}`,
        {
          method: "PATCH",
          body: [{ op: "replace", path: "/isCompleted", value: completed }],
        },
      );
      return toText(
        `${completed ? "Closed" : "Reopened"} workday ${effectiveDate} for user \`${effectiveUser}\`.`,
      );
    },
  );
}

export function registerHoursTools(
  server: McpServer,
  env: Env,
  props: SessionProps,
  opts: { enableWrites: boolean },
) {
  registerHoursReadTools(server, env, props);
  registerHoursListTools(server, env, props);
  if (opts.enableWrites) registerHoursWriteTools(server, env, props);
}
