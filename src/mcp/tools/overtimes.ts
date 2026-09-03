import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type { OvertimeOutputModel } from "../../severa/types";
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

export function registerOvertimeTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_overtimes",
    {
      description: [
        "List Severa overtime definitions from `/v1/overtimes` — the overtime *types* available in the org (e.g. 50%, 100%), not the hours people have logged under them. For actual logged overtime hours, use `severa_list_work_hours` / `severa_get_my_hours` with the relevant `workTypeGuid`.",
        "",
        "Server-side filters:",
        "- `active` — true = only active, false = only inactive, omit = both",
        "- `textToSearch` — substring on name",
        "",
        "Client-side filters:",
        "- `nameContains`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        active: z.boolean().nullish(),
        textToSearch: z.string().min(1).nullish(),
        nameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List overtimes" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "overtimes");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<OvertimeOutputModel>(env, "/v1/overtimes", {
        query: {
          ...(args.active != null ? { active: args.active } : {}),
          ...(args.textToSearch ? { textToSearch: args.textToSearch } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows
        .filter((o) => {
          if (args.nameContains && !matches(o.name, args.nameContains)) return false;
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No overtime definitions match those filters.");
      return toText(
        `${hits.length} overtime type(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderOvertimeRow).join("\n")}`,
      );
    },
  );
}

function renderOvertimeRow(o: OvertimeOutputModel): string {
  const parts = [
    `**${o.name ?? "(no name)"}**`,
    o.code,
    o.percentage != null ? `${o.percentage}%` : undefined,
    o.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${o.guid}\``;
}
