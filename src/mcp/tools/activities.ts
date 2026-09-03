import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { requireSeveraUserGuid } from "../../severa/user-resolver";
import { matches } from "../../severa/reference-cache";
import type { ActivityModel } from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { toText } from "../format";
import { effectiveUserGuids, requireCategoryAccess, requireEffectiveVisible } from "../../authz";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = () => z.string().uuid();

export function registerActivityTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_activities",
    {
      description: [
        "List Severa activities (CRM meetings, calls, tasks) from `/v1/activities`. Exposes every filter the endpoint supports plus client-side conveniences.",
        "",
        "Server-side filters:",
        "- `closed`, `isApproved`, `isUnassigned`, `hasDuration`, `hasHours`",
        "- `activityCategories`, `activityTypeGuids`, `recurrenceType`",
        "- `customerGuids`, `includeTasksWithNoCustomer`",
        "- `projectGuids`, `includeTasksWithNoProject`, `projectBusinessUnitGuids`, `projectOwnerGuids`",
        "- `userGuids`, `includeAsMember`, `userKeywordGuids`",
        "- `phaseGuids`, `includeSubPhases`, `projectTaskStatusGuids`",
        "- `contactGuids`",
        "- `startDateTime`, `endDateTime`, `useStrictStartAndEndDateTime` (ISO datetime, e.g. 2026-04-01T00:00:00Z or YYYY-MM-DD)",
        "- `changedSince`",
        "",
        "Client-side filters:",
        "- `nameContains`, `descriptionContains`",
        "- `onlyMine` — shortcut for userGuids = signed-in user",
        "",
        "Resolve `activityTypeGuids` via `severa_query({ path: '/v1/activitytypes' })`. `limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        closed: z.boolean().nullish(),
        isApproved: z.boolean().nullish(),
        isUnassigned: z.boolean().nullish(),
        hasDuration: z.boolean().nullish(),
        hasHours: z.boolean().nullish(),
        activityCategories: z.array(z.string()).nullish(),
        activityTypeGuids: z.array(uuid()).nullish(),
        recurrenceType: z.string().nullish(),
        customerGuids: z.array(uuid()).nullish(),
        includeTasksWithNoCustomer: z.boolean().nullish(),
        projectGuids: z.array(uuid()).nullish(),
        includeTasksWithNoProject: z.boolean().nullish(),
        projectBusinessUnitGuids: z.array(uuid()).nullish(),
        projectOwnerGuids: z.array(uuid()).nullish(),
        userGuids: z.array(uuid()).nullish(),
        onlyMine: z.boolean().nullish(),
        includeAsMember: z.boolean().nullish(),
        userKeywordGuids: z.array(uuid()).nullish(),
        phaseGuids: z.array(uuid()).nullish(),
        includeSubPhases: z.boolean().nullish(),
        projectTaskStatusGuids: z.array(uuid()).nullish(),
        contactGuids: z.array(uuid()).nullish(),
        startDateTime: z.string().min(1).nullish(),
        endDateTime: z.string().min(1).nullish(),
        useStrictStartAndEndDateTime: z.boolean().nullish(),
        changedSince: isoDate().nullish(),
        nameContains: z.string().min(1).nullish(),
        descriptionContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List activities" },
    },
    async (args) => {
      const authz = await requireCategoryAccess(env, props, "activities");
      const limit = args.limit ?? 100;
      const requestedGuids = args.onlyMine
        ? [await requireSeveraUserGuid(env, props.email)]
        : args.userGuids;
      const userGuids = effectiveUserGuids(authz, requestedGuids);
      requireEffectiveVisible(requestedGuids ?? undefined, userGuids, "view activities");

      const normalizeDate = (v?: string | null): string | undefined => {
        if (!v) return undefined;
        return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v;
      };

      const rows = await severaPaginate<ActivityModel>(env, "/v1/activities", {
        query: {
          ...(args.closed != null ? { closed: args.closed } : {}),
          ...(args.isApproved != null ? { isApproved: args.isApproved } : {}),
          ...(args.isUnassigned != null ? { isUnassigned: args.isUnassigned } : {}),
          ...(args.hasDuration != null ? { hasDuration: args.hasDuration } : {}),
          ...(args.hasHours != null ? { hasHours: args.hasHours } : {}),
          ...(args.activityCategories?.length
            ? { activityCategories: args.activityCategories }
            : {}),
          ...(args.activityTypeGuids?.length ? { activityTypeGuids: args.activityTypeGuids } : {}),
          ...(args.recurrenceType ? { recurrenceType: args.recurrenceType } : {}),
          ...(args.customerGuids?.length ? { customerGuids: args.customerGuids } : {}),
          ...(args.includeTasksWithNoCustomer != null
            ? { includeTasksWithNoCustomer: args.includeTasksWithNoCustomer }
            : {}),
          ...(args.projectGuids?.length ? { projectGuids: args.projectGuids } : {}),
          ...(args.includeTasksWithNoProject != null
            ? { includeTasksWithNoProject: args.includeTasksWithNoProject }
            : {}),
          ...(args.projectBusinessUnitGuids?.length
            ? { projectBusinessUnitGuids: args.projectBusinessUnitGuids }
            : {}),
          ...(args.projectOwnerGuids?.length
            ? { projectOwnerGuids: args.projectOwnerGuids }
            : {}),
          ...(userGuids?.length ? { userGuids } : {}),
          ...(args.includeAsMember != null ? { includeAsMember: args.includeAsMember } : {}),
          ...(args.userKeywordGuids?.length ? { userKeywordGuids: args.userKeywordGuids } : {}),
          ...(args.phaseGuids?.length ? { phaseGuids: args.phaseGuids } : {}),
          ...(args.includeSubPhases != null
            ? { includeSubPhases: args.includeSubPhases }
            : {}),
          ...(args.projectTaskStatusGuids?.length
            ? { projectTaskStatusGuids: args.projectTaskStatusGuids }
            : {}),
          ...(args.contactGuids?.length ? { contactGuids: args.contactGuids } : {}),
          ...(normalizeDate(args.startDateTime)
            ? { startDateTime: normalizeDate(args.startDateTime)! }
            : {}),
          ...(normalizeDate(args.endDateTime)
            ? { endDateTime: normalizeDate(args.endDateTime)! }
            : {}),
          ...(args.useStrictStartAndEndDateTime != null
            ? { useStrictStartAndEndDateTime: args.useStrictStartAndEndDateTime }
            : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows
        .filter((a) => {
          if (args.nameContains && !matches(a.name, args.nameContains)) return false;
          if (args.descriptionContains && !matches(a.description, args.descriptionContains))
            return false;
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No activities match those filters.");
      return toText(
        `${hits.length} activit${hits.length === 1 ? "y" : "ies"}${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderActivityRow).join("\n")}`,
      );
    },
  );
}

function renderActivityRow(a: ActivityModel): string {
  const when = a.startDateTime ? a.startDateTime.slice(0, 16).replace("T", " ") : undefined;
  const parts = [
    `**${a.name ?? "(no subject)"}**`,
    a.activityType?.name,
    a.customer?.name,
    a.project?.name,
    when,
    a.workHours ? `${a.workHours}h` : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${a.guid}\``;
}
