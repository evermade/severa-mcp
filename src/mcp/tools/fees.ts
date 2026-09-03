import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type {
  ProjectFeeOutputModel,
  FlatRateOutputModel,
  ProjectRecurringFeeRuleOutputModel,
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

export function registerFeeTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_project_fees",
    {
      description: [
        "List project fees from `/v1/projectfees` (needs `fees:read` scope, already requested).",
        "",
        "Server-side filter is thin — only `changedSince`. For project- or user-scoped queries, prefer `severa_query`:",
        "- `/v1/projects/{projectGuid}/projectfees`",
        "- `/v1/users/{userGuid}/projectfees`",
        "",
        "Client-side filters (post-fetch):",
        "- `projectGuid`, `userGuid`",
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
        descriptionContains: z.string().min(1).nullish(),
        eventDateFrom: isoDate().nullish(),
        eventDateTo: isoDate().nullish(),
        billableStatus: z
          .enum(["Billable", "NotBillable", "RemovedFromInvoice"])
          .nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List project fees" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "fees");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<ProjectFeeOutputModel>(env, "/v1/projectfees", {
        query: {
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows
        .filter((r) => {
          if (args.projectGuid && r.project?.guid !== args.projectGuid) return false;
          if (args.userGuid && r.user?.guid !== args.userGuid) return false;
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

      if (!hits.length) return toText("No project fees match those filters.");
      const total = hits.reduce((s, r) => s + (r.totalPrice?.amount ?? 0), 0);
      const currency =
        hits.find((r) => r.totalPrice?.currencyCode)?.totalPrice?.currencyCode ?? "EUR";
      return toText(
        `${hits.length} fee(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""} — total ${total.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderFeeRow).join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_list_flat_rates",
    {
      description: [
        "List flat-rate fee arrangements from `/v1/flatrates` — fixed-price billing blocks attached to projects/phases (e.g. a monthly retainer that bills X EUR including Y hours).",
        "",
        "Server-side filters:",
        "- `invoiceGuid` — flat rates tied to one invoice",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `projectGuid` — scope to one project",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        invoiceGuid: uuid().nullish(),
        changedSince: isoDate().nullish(),
        projectGuid: uuid().nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List flat rates" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "fees");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<FlatRateOutputModel>(env, "/v1/flatrates", {
        query: {
          ...(args.invoiceGuid ? { invoiceGuid: args.invoiceGuid } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });
      const hits = rows
        .filter((r) => !args.projectGuid || r.project?.guid === args.projectGuid)
        .slice(0, limit);
      if (!hits.length) return toText("No flat rates match those filters.");
      const total = hits.reduce((s, r) => s + (r.price?.amount ?? 0), 0);
      const currency = hits.find((r) => r.price?.currencyCode)?.price?.currencyCode ?? "EUR";
      return toText(
        `${hits.length} flat rate(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""} — total ${total.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderFlatRateRow).join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_list_project_recurring_fees",
    {
      description: [
        "List recurring fee rules on projects from `/v1/projectrecurringfeerules` — schedules that auto-generate project fees on a cadence (monthly retainers, annual licenses). Answers 'who's paying us recurring fees?'.",
        "",
        "Server-side filters:",
        "- `productType`",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `projectGuid`, `customerGuid`",
        "- `isActive`",
        "- `nameContains`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        productType: z.string().nullish(),
        changedSince: isoDate().nullish(),
        projectGuid: uuid().nullish(),
        customerGuid: uuid().nullish(),
        isActive: z.boolean().nullish(),
        nameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List recurring fees" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "fees");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<ProjectRecurringFeeRuleOutputModel>(
        env,
        "/v1/projectrecurringfeerules",
        {
          query: {
            ...(args.productType ? { productType: args.productType } : {}),
            ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
            rowCount: Math.min(1000, Math.max(limit, 100)),
          },
        },
      );
      const hits = rows
        .filter((r) => {
          if (args.projectGuid && r.project?.guid !== args.projectGuid) return false;
          if (args.customerGuid && r.customer?.guid !== args.customerGuid) return false;
          if (args.isActive != null && r.isActive !== args.isActive) return false;
          if (args.nameContains && !matches(r.name, args.nameContains)) return false;
          return true;
        })
        .slice(0, limit);
      if (!hits.length) return toText("No recurring fees match those filters.");
      return toText(
        `${hits.length} recurring fee(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderRecurringRow).join("\n")}`,
      );
    },
  );
}

function renderFlatRateRow(r: FlatRateOutputModel): string {
  const parts = [
    `**${r.project?.name ?? "(no project)"}**`,
    r.phase?.name,
    formatMoney(r.price),
    r.includesHours != null ? `incl. ${r.includesHours}h` : undefined,
    r.billingSchedule,
    r.plannedBillingDate?.slice(0, 10),
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}

function renderRecurringRow(r: ProjectRecurringFeeRuleOutputModel): string {
  const parts = [
    `**${r.name ?? "(no name)"}**`,
    r.customer?.name,
    r.project?.name,
    r.quantity != null ? `${r.quantity}x` : undefined,
    formatMoney(r.unitPrice),
    r.frequency,
    r.recurrenceStartDate?.slice(0, 10),
    r.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}

function renderFeeRow(r: ProjectFeeOutputModel): string {
  const parts = [
    r.eventDate?.slice(0, 10),
    r.project?.name,
    r.description,
    r.quantity != null ? `${r.quantity}x` : undefined,
    formatMoney(r.totalPrice),
    r.billableStatus,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}
