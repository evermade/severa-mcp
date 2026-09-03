import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type {
  InvoiceOutputModel,
  InvoiceRowOutputModel,
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

export function registerInvoiceTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_invoices",
    {
      description: [
        "List Severa invoices from `/v1/invoices`. Exposes every filter the endpoint supports plus client-side conveniences.",
        "",
        "Server-side filters:",
        "- `customerGuids`, `projectGuids`, `projectOwnerGuids`, `projectBusinessUnitGuids`, `salesPersonGuids`, `createdByUserGuids`",
        "- `invoiceStatusGuids` — resolve via `severa_query({ path: '/v1/invoicestatuses' })`",
        "- `startDate` / `endDate` — invoice date range (YYYY-MM-DD)",
        "- `paymentDateStart` — covers paid/overdue filtering (YYYY-MM-DD)",
        "- `minimumTotalExcludingTax` / `maximumTotalExcludingTax` — EUR amount filter",
        "- `referenceNumbers`, `numbers` — exact-match arrays",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `customerNameContains`, `statusNameContains`",
        "- singular GUID shortcuts: `customerGuid`, `projectGuid`, `salesPersonGuid`, `invoiceStatusGuid`",
        "",
        "`limit` default 100, max 500. Returns name, customer, status, total, date, GUID.",
      ].join("\n"),
      inputSchema: {
        customerGuid: uuid().nullish(),
        customerGuids: z.array(uuid()).nullish(),
        projectGuid: uuid().nullish(),
        projectGuids: z.array(uuid()).nullish(),
        projectOwnerGuids: z.array(uuid()).nullish(),
        projectBusinessUnitGuids: z.array(uuid()).nullish(),
        salesPersonGuid: uuid().nullish(),
        salesPersonGuids: z.array(uuid()).nullish(),
        createdByUserGuids: z.array(uuid()).nullish(),
        invoiceStatusGuid: uuid().nullish(),
        invoiceStatusGuids: z.array(uuid()).nullish(),
        startDate: isoDate().nullish(),
        endDate: isoDate().nullish(),
        paymentDateStart: isoDate().nullish(),
        minimumTotalExcludingTax: z.number().nullish(),
        maximumTotalExcludingTax: z.number().nullish(),
        referenceNumbers: z.array(z.string()).nullish(),
        numbers: z.array(z.number().int()).nullish(),
        changedSince: isoDate().nullish(),
        customerNameContains: z.string().min(1).nullish(),
        statusNameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List invoices" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "invoices");
      const limit = args.limit ?? 100;
      const customerGuids = merge(args.customerGuid, args.customerGuids);
      const projectGuids = merge(args.projectGuid, args.projectGuids);
      const salesPersonGuids = merge(args.salesPersonGuid, args.salesPersonGuids);
      const invoiceStatusGuids = merge(args.invoiceStatusGuid, args.invoiceStatusGuids);

      const invoices = await severaPaginate<InvoiceOutputModel>(env, "/v1/invoices", {
        query: {
          ...(customerGuids ? { customerGuids } : {}),
          ...(projectGuids ? { projectGuids } : {}),
          ...(args.projectOwnerGuids?.length ? { projectOwnerGuids: args.projectOwnerGuids } : {}),
          ...(args.projectBusinessUnitGuids?.length
            ? { projectBusinessUnitGuids: args.projectBusinessUnitGuids }
            : {}),
          ...(salesPersonGuids ? { salesPersonGuids } : {}),
          ...(args.createdByUserGuids?.length ? { createdByUserGuids: args.createdByUserGuids } : {}),
          ...(invoiceStatusGuids ? { invoiceStatusGuids } : {}),
          ...(args.startDate ? { startDate: args.startDate } : {}),
          ...(args.endDate ? { endDate: args.endDate } : {}),
          ...(args.paymentDateStart ? { paymentDateStart: args.paymentDateStart } : {}),
          ...(args.minimumTotalExcludingTax != null
            ? { minimumTotalExcludingTax: args.minimumTotalExcludingTax }
            : {}),
          ...(args.maximumTotalExcludingTax != null
            ? { maximumTotalExcludingTax: args.maximumTotalExcludingTax }
            : {}),
          ...(args.referenceNumbers?.length ? { referenceNumbers: args.referenceNumbers } : {}),
          ...(args.numbers?.length ? { numbers: args.numbers.map(String) } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = invoices
        .filter((inv) => {
          if (args.customerNameContains && !matches(inv.customer?.name, args.customerNameContains)) {
            return false;
          }
          if (args.statusNameContains && !matches(inv.invoiceStatus?.name, args.statusNameContains)) {
            return false;
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No invoices match those filters.");
      const totalEx = hits.reduce((s, i) => s + (i.totalExcludingTax?.amount ?? 0), 0);
      const currency =
        hits.find((i) => i.totalExcludingTax?.currencyCode)?.totalExcludingTax?.currencyCode ?? "EUR";
      return toText(
        `${hits.length} invoice(s)${hits.length < invoices.length ? ` (of ${invoices.length} fetched)` : ""} — total ${totalEx.toLocaleString("sv-FI")} ${currency} (excl. tax):\n${hits.map(renderInvoiceRow).join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_list_invoice_rows",
    {
      description: [
        "List invoice line items from `/v1/invoicerows`. For invoice-scoped queries, prefer `severa_query({ path: '/v1/invoices/{invoiceGuid}/invoicerows' })` — /v1/invoicerows is thin on server-side filters (only `changedSince`).",
        "",
        "Server-side filters:",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `invoiceGuid` — filter to a specific invoice post-fetch",
        "- `descriptionContains`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        changedSince: isoDate().nullish(),
        invoiceGuid: uuid().nullish(),
        descriptionContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List invoice rows" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "invoices");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<InvoiceRowOutputModel>(env, "/v1/invoicerows", {
        query: {
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });
      const hits = rows
        .filter((r) => {
          if (args.invoiceGuid && r.invoice?.guid !== args.invoiceGuid) return false;
          if (args.descriptionContains && !matches(r.description, args.descriptionContains)) {
            return false;
          }
          return true;
        })
        .slice(0, limit);
      if (!hits.length) return toText("No invoice rows match those filters.");
      const total = hits.reduce((s, r) => s + (r.totalPrice?.amount ?? 0), 0);
      const currency =
        hits.find((r) => r.totalPrice?.currencyCode)?.totalPrice?.currencyCode ?? "EUR";
      return toText(
        `${hits.length} row(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""} — total ${total.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderInvoiceRowRow).join("\n")}`,
      );
    },
  );
}

function merge(
  single?: string | null,
  plural?: string[] | null,
): string[] | undefined {
  const xs = [...(single ? [single] : []), ...(plural ?? [])];
  return xs.length ? xs : undefined;
}

function renderInvoiceRow(i: InvoiceOutputModel): string {
  const parts = [
    `**#${i.number ?? "?"}**`,
    i.customer?.name,
    i.invoiceStatus?.name,
    formatMoney(i.totalExcludingTax),
    i.date?.slice(0, 10),
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${i.guid}\``;
}

function renderInvoiceRowRow(r: InvoiceRowOutputModel): string {
  const parts = [
    r.description ?? "(no description)",
    r.quantity != null ? `${r.quantity}${r.unit ? ` ${r.unit}` : ""}` : undefined,
    formatMoney(r.totalPrice),
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}
