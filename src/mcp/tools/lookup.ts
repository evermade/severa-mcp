import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaFetch, severaPaginate } from "../../severa/client";
import { requireSeveraUserGuid } from "../../severa/user-resolver";
import {
  getActiveCustomers,
  getActiveProjects,
  matches,
} from "../../severa/reference-cache";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import type { CustomerModel, Money, ProjectOutputModel, UserWithName } from "../../severa/types";
import { formatMoney, toJsonBlock, toText } from "../format";
import type { CallerAuthz } from "../../authz";
import {
  applyProjectClientFilters,
  buildProjectsServerQuery,
  describeAppliedFilters,
  projectFiltersBase,
  projectsExtraFilters,
  resolveIsWonToStatusTypeGuids,
} from "./_filters";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerLookupTools(
  server: McpServer,
  env: Env,
  props: SessionProps,
  authz: CallerAuthz,
) {
  server.registerTool(
    "severa_find_customer",
    {
      description:
        "Find Severa customers whose name contains the given text (case-insensitive). Searches the active customer list. Use to resolve a customer name into a GUID.",
      inputSchema: {
        text: z.string().min(1),
        limit: z.number().int().min(1).max(50).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Find customer" },
    },
    async ({ text, limit }) => {
      const all = await getActiveCustomers(env);
      const hits = all
        .filter((c) => matches(c.name, text) || matches(c.code, text) || matches(c.number, text))
        .slice(0, limit ?? 15);
      if (!hits.length) return toText(`No active customers matching "${text}".`);
      const lines = hits.map(
        (c) => `- ${c.name}${c.code ? ` (${c.code})` : ""} — \`${c.guid}\``,
      );
      return toText(`Found ${hits.length} customer(s):\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "severa_find_project",
    {
      description:
        "Find open Severa projects whose name contains the given text (case-insensitive). Optionally scope to a customer GUID.",
      inputSchema: {
        text: z.string().min(1),
        customerGuid: z.string().uuid().nullish(),
        limit: z.number().int().min(1).max(50).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Find project" },
    },
    async ({ text, customerGuid, limit }) => {
      const all = await getActiveProjects(env);
      const scoped = customerGuid ? all.filter((p) => p.customer?.guid === customerGuid) : all;
      const hits = scoped
        .filter((p) => matches(p.name, text) || matches(p.number, text))
        .slice(0, limit ?? 15);
      if (!hits.length) return toText(`No open projects matching "${text}".`);
      const lines = hits.map(
        (p) =>
          `- ${p.name}${p.number ? ` [${p.number}]` : ""}${
            p.customer ? ` — ${p.customer.name}` : ""
          } — \`${p.guid}\``,
      );
      return toText(`Found ${hits.length} project(s):\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "severa_find_user",
    {
      description:
        "Find Severa users by email (exact) or by free-text match against name. Returns GUID, name, email.",
      inputSchema: {
        email: z.string().email().nullish(),
        text: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(50).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Find user" },
    },
    async ({ email, text, limit }) => {
      if (!email && !text) return toText("Provide at least `email` or `text`.");
      const users = email
        ? await severaPaginate<UserWithName>(env, "/v1/users", {
            query: {
              email,
              ...(authz.isFullAccess ? {} : { isActive: true }),
              rowCount: 25,
            },
          })
        : await severaPaginate<UserWithName>(env, "/v1/users", {
            query: { isActive: true, rowCount: 500 },
          });
      // Defense-in-depth: non-admins never see an inactive user, even if the
      // server-side filter above were somehow bypassed or ignored.
      const visible = authz.isFullAccess ? users : users.filter((u) => u.isActive !== false);
      const filtered = text
        ? visible.filter(
            (u) =>
              matches(u.firstName, text) ||
              matches(u.lastName, text) ||
              matches(u.userName, text) ||
              matches(u.email, text),
          )
        : visible;
      const hits = filtered.slice(0, limit ?? 15);
      if (!hits.length) return toText("No users matched.");
      const lines = hits.map(
        (u) =>
          `- ${[u.firstName, u.lastName].filter(Boolean).join(" ") || u.userName || u.email || "(unnamed)"} — ${u.email ?? "no email"} — \`${u.guid}\``,
      );
      return toText(`Found ${hits.length} user(s):\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "severa_get_project",
    {
      description: "Fetch full details for a Severa project by GUID, including phases and sales fields.",
      inputSchema: { projectGuid: z.string().uuid() },
      annotations: { ...READ_ANNOTATIONS, title: "Get project" },
    },
    async ({ projectGuid }) => {
      const project = await severaFetch<ProjectOutputModel>(env, `/v1/projects/${projectGuid}`);
      return toJsonBlock(`Project: ${project.name}`, project);
    },
  );

  server.registerTool(
    "severa_get_customer",
    {
      description: "Fetch full details for a Severa customer by GUID.",
      inputSchema: { customerGuid: z.string().uuid() },
      annotations: { ...READ_ANNOTATIONS, title: "Get customer" },
    },
    async ({ customerGuid }) => {
      const customer = await severaFetch<CustomerModel>(env, `/v1/customers/${customerGuid}`);
      return toJsonBlock(`Customer: ${customer.name}`, customer);
    },
  );

  server.registerTool(
    "severa_list_customers",
    {
      description: [
        "List Severa customers from `/v1/customers` with the full filter set the endpoint supports. Use this (not `severa_find_customer`) when you need filters beyond a name substring — e.g. customer-owner, inactive customers, date-based changes, or exact-match by email/VAT/name.",
        "",
        "Server-side filters (sent to Severa):",
        "- `isActive` — omit = all, true = only active, false = only inactive",
        "- `isInternal` — internal customers (e.g. Genero itself)",
        "- `customerOwnerGuid` — resolve via `severa_find_user`",
        "- `changedSince` — YYYY-MM-DD; customers updated since this date",
        "- `emailAddresses` — exact-match array (any contact email)",
        "- `customerNames` — exact-match array",
        "- `vatNumber` — exact match",
        "- `numbers` — array of Severa customer numbers",
        "",
        "Client-side filter:",
        "- `nameContains` — substring of customer name or code (case-insensitive)",
        "",
        "Use `limit` to cap the displayed list (default 100, max 500). Returns a list with name, code, number, and GUID.",
      ].join("\n"),
      inputSchema: {
        isActive: z.boolean().nullish(),
        isInternal: z.boolean().nullish(),
        customerOwnerGuid: z.string().uuid().nullish(),
        changedSince: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        emailAddresses: z.array(z.string().email()).nullish(),
        customerNames: z.array(z.string().min(1)).nullish(),
        vatNumber: z.string().nullish(),
        numbers: z.array(z.number().int()).nullish(),
        nameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List customers" },
    },
    async (args) => {
      const {
        isActive,
        isInternal,
        customerOwnerGuid,
        changedSince,
        emailAddresses,
        customerNames,
        vatNumber,
        numbers,
        nameContains,
      } = args;
      const limit = args.limit ?? 100;

      const customers = await severaPaginate<CustomerModel>(env, "/v1/customers", {
        query: {
          ...(isActive != null ? { isActive } : {}),
          ...(isInternal != null ? { isInternal } : {}),
          ...(customerOwnerGuid ? { customerOwnerGuids: [customerOwnerGuid] } : {}),
          ...(changedSince ? { changedSince: `${changedSince}T00:00:00Z` } : {}),
          ...(emailAddresses?.length ? { emailAddresses } : {}),
          ...(customerNames?.length ? { customerNames } : {}),
          ...(vatNumber ? { vatNumber } : {}),
          ...(numbers?.length ? { numbers: numbers.map(String) } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = customers
        .filter((c) => {
          if (nameContains) {
            if (!matches(c.name, nameContains) && !matches(c.code, nameContains)) {
              return false;
            }
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No customers match those filters.");
      const lines = hits.map(
        (c) =>
          `- ${c.name}${c.code ? ` (${c.code})` : ""}${c.number ? ` [#${c.number}]` : ""} — \`${c.guid}\``,
      );
      return toText(
        `${hits.length} customer(s)${hits.length < customers.length ? ` (of ${customers.length} fetched)` : ""}:\n${lines.join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_list_projects",
    {
      description: [
        "List Severa projects from `/v1/projects`. Exposes every filter the endpoint supports plus client-side conveniences.",
        "",
        "IMPORTANT: at some Severa setups (including Genero), cases that reach a Won status like 'Order / NB' are listed under `/v1/projects`, NOT under `/v1/salescases`. If `severa_list_sales_cases` returns nothing for a Won-status question, use this tool instead.",
        "",
        "TIP: `/v1/projects` contains lots of historical data. When filtering by `salesStatusTypeGuids` alone you may hit the 2000-row pagination ceiling before reaching recent matches. Pair status filters with a date filter (`salesStatusChangedSince` is usually the right one for 'marked as X in period Y' questions) to narrow server-side.",
        "",
        "Server-side filters (singular shortcuts merge into the plural *Guids):",
        "- `customerGuid` / `customerGuids` — resolve via `severa_find_customer`",
        "- `salesPersonGuid` / `salesPersonGuids` / `onlyMine` — via `severa_find_user`",
        "- `projectOwnerGuid` / `projectOwnerGuids`",
        "- `customerOwnerGuids`, `projectGuids`, `projectKeywordGuids`, `projectStatusTypeGuids`, `salesStatusTypeGuids`, `businessUnitGuids`, `marketSegmentationGuids`, `companyCurrencyGuids`, `currencyGuid` / `currencyGuids`, `projectMemberUserGuids`, `numbers`",
        "- `isClosed`, `isBillable`, `internal`, `hasRecurringFees`",
        "- `minimumBillableAmount`, `invoiceableDate`",
        "- `changedSince` / `salesStatusChangedSince` / `projectStatusChangedSince` — YYYY-MM-DD (answers 'changed/marked this month')",
        "- Reference-data GUIDs via `severa_query({ path: '/v1/salesstatustypes' | '/v1/projectstatustypes' | '/v1/keywords' | '/v1/businessunits' | ... })`",
        "",
        "Client-side filters (applied after fetch):",
        "- `isWon` — by `salesStatus.isWon`",
        "- `nameContains` — matches project name, customer name, or project number",
        "- `statusNameContains` — substring of sales-status name",
        "- `expectedOrderFrom` / `expectedOrderTo` — YYYY-MM-DD range on `expectedOrderDate`",
        "- `closedFrom` / `closedTo` — YYYY-MM-DD range on `closedDate`",
        "",
        "`limit` caps the displayed list (default 100, max 500).",
      ].join("\n"),
      inputSchema: { ...projectFiltersBase, ...projectsExtraFilters },
      annotations: { ...READ_ANNOTATIONS, title: "List projects" },
    },
    async (args) => {
      const limit = args.limit ?? 100;
      const queryOpts: { effectiveSalesPerson?: string; limit: number } = { limit };
      if (args.onlyMine) {
        queryOpts.effectiveSalesPerson = await requireSeveraUserGuid(env, props.email);
      }
      const effectiveArgs = { ...args };
      const resolvedGuids = await resolveIsWonToStatusTypeGuids(env, args);
      if (resolvedGuids) effectiveArgs.salesStatusTypeGuids = resolvedGuids;
      const projects = await severaPaginate<ProjectOutputModel>(env, "/v1/projects", {
        query: buildProjectsServerQuery(effectiveArgs, queryOpts),
      });

      const hits = applyProjectClientFilters(projects, args, { limit });

      const describeOpts: { effectiveSalesPerson?: string; resolvedStatusTypeGuids?: string[] } = {};
      if (queryOpts.effectiveSalesPerson) describeOpts.effectiveSalesPerson = queryOpts.effectiveSalesPerson;
      if (resolvedGuids) describeOpts.resolvedStatusTypeGuids = resolvedGuids;
      const filterSummary = describeAppliedFilters(args, describeOpts);
      const truncated = projects.length >= 1000;

      if (!hits.length) {
        return toText(
          `No projects match those filters.\n\nFilters applied:\n${filterSummary.map((l) => `- ${l}`).join("\n") || "- (none)"}`,
        );
      }
      const totalRaw = hits.reduce((s, p) => s + (p.expectedValue?.amount ?? 0), 0);
      const currency =
        hits.find((p) => p.expectedValue?.currencyCode)?.expectedValue?.currencyCode ?? "EUR";
      const warning = truncated
        ? `\n\n⚠ Fetched ${projects.length} rows (likely truncated — pair with a date filter like \`salesStatusChangedSince\` if you expected a narrower window). Filters applied:\n${filterSummary.map((l) => `- ${l}`).join("\n") || "- (none — result is unfiltered)"}`
        : "";
      return toText(
        `${hits.length} project(s)${hits.length < projects.length ? ` (of ${projects.length} fetched)` : ""} — total ${totalRaw.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderProjectRow).join("\n")}${warning}`,
      );
    },
  );
}

function renderProjectRow(p: ProjectOutputModel): string {
  const parts: (string | undefined)[] = [
    `**${p.name}**`,
    p.customer?.name,
    p.salesStatus?.name,
    p.probability != null ? `${p.probability}%` : undefined,
    formatMoney(p.expectedValue as Money | undefined),
    p.expectedOrderDate ? `order ${p.expectedOrderDate.slice(0, 10)}` : undefined,
    p.closedDate ? `closed ${p.closedDate.slice(0, 10)}` : undefined,
  ];
  return `- ${parts.filter(Boolean).join(" — ")} — \`${p.guid}\``;
}
