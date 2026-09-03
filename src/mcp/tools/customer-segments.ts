import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type { CustomerMarketSegmentModel } from "../../severa/types";
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

export function registerCustomerSegmentTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_customer_market_segments",
    {
      description: [
        "List customer-to-market-segment assignments from `/v1/customermarketsegments` — the join records between customers and the segment hierarchy (e.g. 'Acme Corp is in the Healthcare > Hospitals segment').",
        "",
        "For the segment reference data itself (list of available segments), use the MCP resource `severa://reference/market-segments` or `severa_query({ path: '/v1/marketsegmentations' })`.",
        "",
        "Server-side filters:",
        "- `textToSearch` — substring on customer or segment name",
        "- `parentMarketSegmentGuid` — scope to a parent segment",
        "- `includeParentLevel` — include records from parent segments",
        "",
        "Client-side filters:",
        "- `customerGuid` — records for one customer",
        "- `segmentNameContains` — filter by segment name",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        textToSearch: z.string().min(1).nullish(),
        parentMarketSegmentGuid: z.string().uuid().nullish(),
        includeParentLevel: z.boolean().nullish(),
        customerGuid: z.string().uuid().nullish(),
        segmentNameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List customer market segments" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "customer-segments");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<CustomerMarketSegmentModel>(
        env,
        "/v1/customermarketsegments",
        {
          query: {
            ...(args.textToSearch ? { textToSearch: args.textToSearch } : {}),
            ...(args.parentMarketSegmentGuid
              ? { parentMarketSegmentGuid: args.parentMarketSegmentGuid }
              : {}),
            ...(args.includeParentLevel != null
              ? { includeParentLevel: args.includeParentLevel }
              : {}),
            rowCount: Math.min(1000, Math.max(limit, 100)),
          },
        },
      );
      const hits = rows
        .filter((r) => {
          if (args.customerGuid && r.customer?.guid !== args.customerGuid) return false;
          if (args.segmentNameContains && !matches(r.marketSegment?.name, args.segmentNameContains))
            return false;
          return true;
        })
        .slice(0, limit);
      if (!hits.length) return toText("No customer market segment records match those filters.");
      return toText(
        `${hits.length} assignment(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderRow).join("\n")}`,
      );
    },
  );
}

function renderRow(r: CustomerMarketSegmentModel): string {
  const parts = [
    `**${r.customer?.name ?? "(no customer)"}**`,
    r.marketSegment?.name,
    r.parentMarketSegment?.name ? `under ${r.parentMarketSegment.name}` : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}
