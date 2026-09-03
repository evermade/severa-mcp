import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type {
  ProjectTravelExpenseOutputModel,
  TravelReimbursementOutputModel,
} from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { formatMoney, toText } from "../format";
import { requireCategoryAccess } from "../../authz";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = () => z.string().uuid();

export function registerTravelTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_project_travel_expenses",
    {
      description: [
        "List project travel expenses from `/v1/projecttravelexpenses` (needs `travels:read` scope, already requested).",
        "",
        "Server-side filter is thin — only `changedSince`. For project- or user-scoped queries, prefer `severa_query`:",
        "- `/v1/projects/{projectGuid}/projecttravelexpenses`",
        "- `/v1/users/{userGuid}/projecttravelexpenses`",
        "",
        "Client-side filters (post-fetch):",
        "- `projectGuid`, `userGuid`, `travelExpenseTypeGuid`",
        "- `descriptionContains`",
        "- `eventDateFrom` / `eventDateTo` — YYYY-MM-DD range",
        "- `billableStatus`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        changedSince: isoDate().nullish(),
        projectGuid: uuid().nullish(),
        userGuid: uuid().nullish(),
        travelExpenseTypeGuid: uuid().nullish(),
        descriptionContains: z.string().min(1).nullish(),
        eventDateFrom: isoDate().nullish(),
        eventDateTo: isoDate().nullish(),
        billableStatus: z
          .enum(["Billable", "NotBillable", "RemovedFromInvoice"])
          .nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List project travel expenses" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "travels");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<ProjectTravelExpenseOutputModel>(
        env,
        "/v1/projecttravelexpenses",
        {
          query: {
            ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
            rowCount: Math.min(1000, Math.max(limit, 100)),
          },
        },
      );

      const hits = rows
        .filter((r) => {
          if (args.projectGuid && r.project?.guid !== args.projectGuid) return false;
          if (args.userGuid && r.user?.guid !== args.userGuid) return false;
          if (
            args.travelExpenseTypeGuid &&
            r.travelExpenseType?.guid !== args.travelExpenseTypeGuid
          ) {
            return false;
          }
          if (args.descriptionContains && !matches(r.description, args.descriptionContains))
            return false;
          if (args.billableStatus && r.billableStatus !== args.billableStatus) return false;
          if (args.eventDateFrom || args.eventDateTo) {
            const d = r.eventDate?.slice(0, 10);
            if (!d) return false;
            if (args.eventDateFrom && d < args.eventDateFrom) return false;
            if (args.eventDateTo && d > args.eventDateTo) return false;
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No travel expenses match those filters.");
      const total = hits.reduce((s, r) => s + (r.totalPrice?.amount ?? 0), 0);
      const currency =
        hits.find((r) => r.totalPrice?.currencyCode)?.totalPrice?.currencyCode ?? "EUR";
      return toText(
        `${hits.length} expense(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""} — total ${total.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderExpenseRow).join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_list_travel_reimbursements",
    {
      description: [
        "List travel reimbursements from `/v1/travelreimbursements` (needs `travels:read` scope, already requested).",
        "",
        "Server-side filters:",
        "- `travelReimbursementStatusGuids` — via `severa_query({ path: '/v1/travelreimbursementstatuses' })`",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters (post-fetch):",
        "- `userGuid`",
        "- `statusNameContains`",
        "- `startFrom` / `startTo` — YYYY-MM-DD range on `startDate`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        travelReimbursementStatusGuids: z.array(uuid()).nullish(),
        changedSince: isoDate().nullish(),
        userGuid: uuid().nullish(),
        statusNameContains: z.string().min(1).nullish(),
        startFrom: isoDate().nullish(),
        startTo: isoDate().nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List travel reimbursements" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "travels");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<TravelReimbursementOutputModel>(
        env,
        "/v1/travelreimbursements",
        {
          query: {
            ...(args.travelReimbursementStatusGuids?.length
              ? { travelReimbursementStatusGuids: args.travelReimbursementStatusGuids }
              : {}),
            ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
            rowCount: Math.min(1000, Math.max(limit, 100)),
          },
        },
      );

      const hits = rows
        .filter((r) => {
          if (args.userGuid && r.user?.guid !== args.userGuid) return false;
          if (args.statusNameContains && !matches(r.status?.name, args.statusNameContains))
            return false;
          if (args.startFrom || args.startTo) {
            const d = r.startDate?.slice(0, 10);
            if (!d) return false;
            if (args.startFrom && d < args.startFrom) return false;
            if (args.startTo && d > args.startTo) return false;
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No travel reimbursements match those filters.");
      const total = hits.reduce((s, r) => s + (r.totalAmount?.amount ?? 0), 0);
      const currency =
        hits.find((r) => r.totalAmount?.currencyCode)?.totalAmount?.currencyCode ?? "EUR";
      return toText(
        `${hits.length} reimbursement(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""} — total ${total.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderReimbursementRow).join("\n")}`,
      );
    },
  );
}

function renderExpenseRow(r: ProjectTravelExpenseOutputModel): string {
  const who = [r.user?.firstName, r.user?.lastName].filter(Boolean).join(" ") || "?";
  const parts = [
    r.eventDate?.slice(0, 10),
    r.project?.name,
    r.travelExpenseType?.name,
    who,
    r.description,
    formatMoney(r.totalPrice),
    r.billableStatus,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}

function renderReimbursementRow(r: TravelReimbursementOutputModel): string {
  const who = [r.user?.firstName, r.user?.lastName].filter(Boolean).join(" ") || "?";
  const parts = [
    `${r.startDate?.slice(0, 10) ?? "?"}${r.endDate ? ` → ${r.endDate.slice(0, 10)}` : ""}`,
    who,
    r.destination,
    r.purpose,
    r.status?.name,
    formatMoney(r.totalAmount),
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}
