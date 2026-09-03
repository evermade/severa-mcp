import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type { ContactModel } from "../../severa/types";
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

export function registerContactTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_contact_persons",
    {
      description: [
        "List Severa contact persons (customer contacts) from `/v1/contactpersons`.",
        "",
        "Server-side filters:",
        "- `active`",
        "- `textToSearch` — full-text search",
        "- `searchCriterias` — narrows what `textToSearch` applies to (array of field names)",
        "- `sortings` — array of field names to sort by",
        "- `changedSince` — YYYY-MM-DD",
        "- `changedSinceOptions` — enum variant for `changedSince`",
        "",
        "Client-side filters:",
        "- `customerGuid` — post-fetch scope to one customer's contacts",
        "- `nameContains`",
        "",
        "For customer-scoped queries, prefer `severa_query({ path: '/v1/customers/{customerGuid}/contactpersons' })`.",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        active: z.boolean().nullish(),
        textToSearch: z.string().min(1).nullish(),
        searchCriterias: z.array(z.string()).nullish(),
        sortings: z.array(z.string()).nullish(),
        changedSince: isoDate().nullish(),
        changedSinceOptions: z.array(z.string()).nullish(),
        customerGuid: z.string().uuid().nullish(),
        nameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List contact persons" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "contacts");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<ContactModel>(env, "/v1/contactpersons", {
        query: {
          ...(args.active != null ? { active: args.active } : {}),
          ...(args.textToSearch ? { textToSearch: args.textToSearch } : {}),
          ...(args.searchCriterias?.length ? { searchCriterias: args.searchCriterias } : {}),
          ...(args.sortings?.length ? { sortings: args.sortings } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          ...(args.changedSinceOptions?.length
            ? { changedSinceOptions: args.changedSinceOptions }
            : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows
        .filter((c) => {
          if (args.customerGuid && c.customer?.guid !== args.customerGuid) return false;
          if (args.nameContains) {
            if (
              !matches(c.firstName, args.nameContains) &&
              !matches(c.lastName, args.nameContains)
            ) {
              return false;
            }
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No contact persons match those filters.");
      return toText(
        `${hits.length} contact(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderContactRow).join("\n")}`,
      );
    },
  );
}

function renderContactRow(c: ContactModel): string {
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ") || "(unnamed)";
  const parts = [
    `**${fullName}**`,
    c.title,
    c.customer?.name,
    c.email,
    c.phone ?? c.mobilePhone,
    c.isDeleted ? "(deleted)" : c.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${c.guid}\``;
}
