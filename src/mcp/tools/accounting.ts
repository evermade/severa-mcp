import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type {
  BankAccountOutputModel,
  AccountModel,
  KpiFormulaOutputModel,
} from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { toText } from "../format";
import { requireCategoryAccess } from "../../authz";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = () => z.string().uuid();

export function registerAccountingTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_bank_accounts",
    {
      description: [
        "List bank accounts configured on the organization from `/v1/bankaccounts`. Admin/finance context — IBANs, BIC, bank names, owning company / business unit.",
        "",
        "Server-side filters:",
        "- `active`",
        "- `companyGuid` / `businessUnitGuid`",
        "- `textToSearch`",
        "",
        "Client-side: `nameContains`. `limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        active: z.boolean().nullish(),
        companyGuid: uuid().nullish(),
        businessUnitGuid: uuid().nullish(),
        textToSearch: z.string().min(1).nullish(),
        nameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List bank accounts" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "accounting");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<BankAccountOutputModel>(env, "/v1/bankaccounts", {
        query: {
          ...(args.active != null ? { active: args.active } : {}),
          ...(args.companyGuid ? { companyGuid: args.companyGuid } : {}),
          ...(args.businessUnitGuid ? { businessUnitGuid: args.businessUnitGuid } : {}),
          ...(args.textToSearch ? { textToSearch: args.textToSearch } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });
      const hits = rows
        .filter((b) => !args.nameContains || matches(b.bankName, args.nameContains))
        .slice(0, limit);
      if (!hits.length) return toText("No bank accounts match those filters.");
      return toText(
        `${hits.length} bank account(s):\n${hits.map(renderBankAccount).join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_list_accounts",
    {
      description: [
        "List chart-of-accounts entries — either sales accounts (`/v1/salesaccounts`) or cost accounts (`/v1/costaccounts`) depending on `kind`. Used to map Severa transactions to the accounting ledger.",
        "",
        "Args:",
        "- `kind` — `sales` or `cost`",
        "- `active` — server-side filter",
        "- `textToSearch` — server-side substring on name",
        "- `nameContains` — client-side (if different from textToSearch behaviour)",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        kind: z.enum(["sales", "cost"]),
        active: z.boolean().nullish(),
        textToSearch: z.string().min(1).nullish(),
        nameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List accounting accounts" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "accounting");
      const limit = args.limit ?? 100;
      const path = args.kind === "sales" ? "/v1/salesaccounts" : "/v1/costaccounts";
      const rows = await severaPaginate<AccountModel>(env, path, {
        query: {
          ...(args.active != null ? { active: args.active } : {}),
          ...(args.textToSearch ? { textToSearch: args.textToSearch } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });
      const hits = rows
        .filter((a) => !args.nameContains || matches(a.name, args.nameContains))
        .slice(0, limit);
      if (!hits.length) return toText(`No ${args.kind} accounts match those filters.`);
      return toText(
        `${hits.length} ${args.kind} account(s):\n${hits.map(renderAccount).join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_list_kpi_formulas",
    {
      description: [
        "List saved KPI formula definitions from `/v1/kpiformulas`. Tenant-specific — what metrics your org has defined on dashboards. Returns the formula *definitions*, not the computed values.",
        "",
        "Server-side filters:",
        "- `category`",
        "- `isActive`",
        "- `textToSearch`",
        "- `changedSince` — YYYY-MM-DD",
        "- `includeDefinition` — include the expression body (larger response)",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        category: z.string().nullish(),
        isActive: z.boolean().nullish(),
        textToSearch: z.string().min(1).nullish(),
        changedSince: isoDate().nullish(),
        includeDefinition: z.boolean().nullish(),
        nameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List KPI formulas" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "accounting");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<KpiFormulaOutputModel>(env, "/v1/kpiformulas", {
        query: {
          ...(args.category ? { category: args.category } : {}),
          ...(args.isActive != null ? { isActive: args.isActive } : {}),
          ...(args.textToSearch ? { textToSearch: args.textToSearch } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          ...(args.includeDefinition != null ? { includeDefinition: args.includeDefinition } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });
      const hits = rows
        .filter((k) => !args.nameContains || matches(k.name, args.nameContains))
        .slice(0, limit);
      if (!hits.length) return toText("No KPI formulas match those filters.");
      return toText(`${hits.length} formula(s):\n${hits.map(renderKpi).join("\n")}`);
    },
  );
}

function renderBankAccount(b: BankAccountOutputModel): string {
  const parts = [
    `**${b.bankName ?? "(no bank)"}**`,
    b.accountNumber,
    b.bic,
    b.company?.name,
    b.businessUnit?.name,
    b.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${b.guid}\``;
}

function renderAccount(a: AccountModel): string {
  const parts = [
    `**${a.name ?? "(no name)"}**`,
    a.number,
    a.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${a.guid}\``;
}

function renderKpi(k: KpiFormulaOutputModel): string {
  const parts = [
    `**${k.name ?? "(no name)"}**`,
    k.category,
    k.unit,
    k.dataType,
    k.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${k.guid}\``;
}
