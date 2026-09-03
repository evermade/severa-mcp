import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type { ProductOutputModel } from "../../severa/types";
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

export function registerProductTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_products",
    {
      description: [
        "List Severa products from `/v1/products`.",
        "",
        "Server-side filters:",
        "- `type` — product type enum",
        "- `isActive`",
        "- `code` — exact product code",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `nameContains`",
        "- `categoryGuid` — resolve via `severa_query({ path: '/v1/productcategories' })`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        type: z.string().nullish(),
        isActive: z.boolean().nullish(),
        code: z.string().nullish(),
        changedSince: isoDate().nullish(),
        nameContains: z.string().min(1).nullish(),
        categoryGuid: z.string().uuid().nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List products" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "products");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<ProductOutputModel>(env, "/v1/products", {
        query: {
          ...(args.type ? { type: args.type } : {}),
          ...(args.isActive != null ? { isActive: args.isActive } : {}),
          ...(args.code ? { code: args.code } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows
        .filter((p) => {
          if (args.nameContains && !matches(p.name, args.nameContains)) return false;
          if (args.categoryGuid && p.category?.guid !== args.categoryGuid) return false;
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No products match those filters.");
      return toText(
        `${hits.length} product(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderProductRow).join("\n")}`,
      );
    },
  );
}

function renderProductRow(p: ProductOutputModel): string {
  const parts = [
    `**${p.name ?? "(no name)"}**`,
    p.code,
    p.category?.name,
    p.type,
    formatMoney(p.unitPrice),
    p.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${p.guid}\``;
}
