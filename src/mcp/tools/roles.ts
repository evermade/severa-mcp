import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type { RoleOutputModel } from "../../severa/types";
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

export function registerRoleTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_roles",
    {
      description: [
        "List Severa roles from `/v1/roles` — job roles used for resource allocation and capacity planning (e.g. 'Senior developer', 'Designer'). These are distinct from permission roles.",
        "",
        "Server-side filters:",
        "- `isActive`",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `nameContains`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        isActive: z.boolean().nullish(),
        changedSince: isoDate().nullish(),
        nameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List roles" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "roles");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<RoleOutputModel>(env, "/v1/roles", {
        query: {
          ...(args.isActive != null ? { isActive: args.isActive } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows
        .filter((r) => {
          if (args.nameContains && !matches(r.name, args.nameContains)) return false;
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No roles match those filters.");
      return toText(
        `${hits.length} role(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderRoleRow).join("\n")}`,
      );
    },
  );
}

function renderRoleRow(r: RoleOutputModel): string {
  const parts = [
    `**${r.name ?? "(no name)"}**`,
    r.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}
