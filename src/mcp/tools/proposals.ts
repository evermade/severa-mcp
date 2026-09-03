import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type {
  ProposalOutputModel,
  ProposalFeeRowOutputModel,
  ProposalSubtotalOutputModel,
  ProposalWorkhourRowOutputModel,
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

export function registerProposalTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_proposals",
    {
      description: [
        "List Severa proposals (quotes) from `/v1/proposals`.",
        "",
        "The endpoint is thin on server-side filters — only `changedSince`. Most filtering is client-side.",
        "",
        "Server-side filter:",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `customerGuid`, `projectGuid`, `salesPersonGuid`, `proposalStatusGuid` — exact post-fetch match",
        "- `nameContains`, `statusNameContains`",
        "",
        "Resolve status GUIDs via `severa_query({ path: '/v1/proposalstatuses' })`. `limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        changedSince: isoDate().nullish(),
        customerGuid: uuid().nullish(),
        projectGuid: uuid().nullish(),
        salesPersonGuid: uuid().nullish(),
        proposalStatusGuid: uuid().nullish(),
        nameContains: z.string().min(1).nullish(),
        statusNameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List proposals" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "proposals");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<ProposalOutputModel>(env, "/v1/proposals", {
        query: {
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows
        .filter((p) => {
          if (args.customerGuid && p.customer?.guid !== args.customerGuid) return false;
          if (args.projectGuid && p.project?.guid !== args.projectGuid) return false;
          if (args.salesPersonGuid && p.salesPerson?.guid !== args.salesPersonGuid) return false;
          if (args.proposalStatusGuid && p.proposalStatus?.guid !== args.proposalStatusGuid)
            return false;
          if (args.nameContains && !matches(p.name, args.nameContains)) return false;
          if (args.statusNameContains && !matches(p.proposalStatus?.name, args.statusNameContains))
            return false;
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No proposals match those filters.");
      const total = hits.reduce((s, p) => s + (p.expectedValue?.amount ?? 0), 0);
      const currency =
        hits.find((p) => p.expectedValue?.currencyCode)?.expectedValue?.currencyCode ?? "EUR";
      return toText(
        `${hits.length} proposal(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""} — total ${total.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderProposalRow).join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_get_proposal_breakdown",
    {
      description: [
        "Fetch the full line-item breakdown of a single proposal: work-hour rows, fee rows, and subtotals — pulled in parallel from `/v1/proposalworkrows`, `/v1/proposalfeerows`, and `/v1/proposalsubtotals`, then filtered client-side to the given proposal and rendered as three sections.",
        "",
        "Use this when someone asks 'what's in proposal X' or wants to audit line items before a won/lost decision. For proposal-level metadata only (status, probability, expected value), use `severa_list_proposals`.",
        "",
        "Arg:",
        "- `proposalGuid` — the proposal to break down",
        "",
        "Note: these endpoints are thin server-side (only `changedSince`), so we fetch recent rows and filter. If a very old proposal has no recent activity its rows may not be returned; set `changedSince` on the underlying endpoints via `severa_query` if needed.",
      ].join("\n"),
      inputSchema: { proposalGuid: uuid() },
      annotations: { ...READ_ANNOTATIONS, title: "Proposal breakdown" },
    },
    async ({ proposalGuid }) => {
      await requireCategoryAccess(env, props, "proposals");
      const [workRows, feeRows, subtotals] = await Promise.all([
        severaPaginate<ProposalWorkhourRowOutputModel>(env, "/v1/proposalworkrows", {
          query: { rowCount: 1000 },
        }),
        severaPaginate<ProposalFeeRowOutputModel>(env, "/v1/proposalfeerows", {
          query: { rowCount: 1000 },
        }),
        severaPaginate<ProposalSubtotalOutputModel>(env, "/v1/proposalsubtotals", {
          query: { rowCount: 1000 },
        }),
      ]);
      const w = workRows.filter((r) => r.proposal?.guid === proposalGuid);
      const f = feeRows.filter((r) => r.proposal?.guid === proposalGuid);
      const s = subtotals.filter((r) => r.proposal?.guid === proposalGuid);
      if (!w.length && !f.length && !s.length) {
        return toText(
          `No rows found on proposal \`${proposalGuid}\`. If the proposal is old, try \`severa_query\` on each of /v1/proposalworkrows, /v1/proposalfeerows, /v1/proposalsubtotals without a changedSince filter.`,
        );
      }
      const workTotal = w.reduce((acc, r) => acc + (r.subtotal?.amount ?? 0), 0);
      const feeTotal = f.reduce((acc, r) => acc + (r.subtotal?.amount ?? 0), 0);
      const currency =
        w.find((r) => r.subtotal?.currencyCode)?.subtotal?.currencyCode ??
        f.find((r) => r.subtotal?.currencyCode)?.subtotal?.currencyCode ??
        "EUR";
      const sections = [
        `**Proposal \`${proposalGuid}\`** — work ${workTotal.toLocaleString("sv-FI")} ${currency} · fees ${feeTotal.toLocaleString("sv-FI")} ${currency} · ${(workTotal + feeTotal).toLocaleString("sv-FI")} ${currency} total`,
        "",
        `## Work-hour rows (${w.length})`,
        ...w.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map(renderWorkRow),
        "",
        `## Fee rows (${f.length})`,
        ...f.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map(renderFeeRow),
        "",
        `## Subtotals (${s.length})`,
        ...s.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map(renderSubtotalRow),
      ];
      return toText(sections.join("\n"));
    },
  );
}

function renderWorkRow(r: ProposalWorkhourRowOutputModel): string {
  const parts = [
    r.name,
    r.phase?.name,
    r.workType?.name,
    r.quantity != null ? `${r.quantity}h` : undefined,
    formatMoney(r.unitPrice),
    formatMoney(r.subtotal),
  ].filter(Boolean);
  return `- ${parts.join(" — ")}`;
}

function renderFeeRow(r: ProposalFeeRowOutputModel): string {
  const parts = [
    r.name,
    r.product?.name,
    r.quantity != null ? `${r.quantity}${r.measurementUnit ? ` ${r.measurementUnit}` : ""}` : undefined,
    formatMoney(r.unitPrice),
    formatMoney(r.subtotal),
  ].filter(Boolean);
  return `- ${parts.join(" — ")}`;
}

function renderSubtotalRow(s: ProposalSubtotalOutputModel): string {
  const parts = [s.name, s.phase?.name, s.description].filter(Boolean);
  return `- ${parts.join(" — ")}`;
}

function renderProposalRow(p: ProposalOutputModel): string {
  const parts = [
    `**${p.name ?? "(no name)"}**`,
    p.customer?.name,
    p.proposalStatus?.name,
    p.probability != null ? `${p.probability}%` : undefined,
    formatMoney(p.expectedValue),
    p.expectedOrderDate?.slice(0, 10),
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${p.guid}\``;
}
