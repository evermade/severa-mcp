import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type { UserOutputModel } from "../../severa/types";
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

export function registerUserTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_users",
    {
      description: [
        "List Severa users from `/v1/users`. Use this (not `severa_find_user`) when you want to filter by business unit, keyword, supervisor, or get paginated bulk lists.",
        "",
        "Server-side filters:",
        "- `isActive`",
        "- `businessUnitGuids` — via `severa_query({ path: '/v1/businessunits' })`",
        "- `keywordGuids` — via `severa_query({ path: '/v1/keywords' })`",
        "- `supervisorUserGuids`",
        "- `code` — user code (exact)",
        "- `email` — exact",
        "- `purpose` — enum",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side:",
        "- `nameContains`, `emailContains`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        isActive: z.boolean().nullish(),
        businessUnitGuids: z.array(uuid()).nullish(),
        keywordGuids: z.array(uuid()).nullish(),
        supervisorUserGuids: z.array(uuid()).nullish(),
        code: z.string().nullish(),
        email: z.string().email().nullish(),
        purpose: z.string().nullish(),
        changedSince: isoDate().nullish(),
        nameContains: z.string().min(1).nullish(),
        emailContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List users" },
    },
    async (args) => {
      const authz = await requireCategoryAccess(env, props, "users");
      const limit = args.limit ?? 100;
      // Non-admins never see inactive users, even if they explicitly ask
      // for isActive: false — force it, don't just default it.
      const isActive = authz.isFullAccess ? args.isActive : true;
      const rows = await severaPaginate<UserOutputModel>(env, "/v1/users", {
        query: {
          ...(isActive != null ? { isActive } : {}),
          ...(args.businessUnitGuids?.length ? { businessUnitGuids: args.businessUnitGuids } : {}),
          ...(args.keywordGuids?.length ? { keywordGuids: args.keywordGuids } : {}),
          ...(args.supervisorUserGuids?.length
            ? { supervisorUserGuids: args.supervisorUserGuids }
            : {}),
          ...(args.code ? { code: args.code } : {}),
          ...(args.email ? { email: args.email } : {}),
          ...(args.purpose ? { purpose: args.purpose } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      // Defense-in-depth: don't rely solely on the server-side filter above.
      const visible = authz.isFullAccess ? rows : rows.filter((u) => u.isActive !== false);

      const hits = visible
        .filter((u) => {
          if (args.nameContains) {
            if (
              !matches(u.firstName, args.nameContains) &&
              !matches(u.lastName, args.nameContains) &&
              !matches(u.userName, args.nameContains)
            ) {
              return false;
            }
          }
          if (args.emailContains && !matches(u.email, args.emailContains)) return false;
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No users match those filters.");
      return toText(
        `${hits.length} user(s)${hits.length < visible.length ? ` (of ${visible.length} fetched)` : ""}:\n${hits.map(renderUserRow).join("\n")}`,
      );
    },
  );
}

function renderUserRow(u: UserOutputModel): string {
  const fullName =
    [u.firstName, u.lastName].filter(Boolean).join(" ") || u.userName || "(unnamed)";
  const parts = [
    `**${fullName}**`,
    u.email,
    u.title,
    u.businessUnit?.name,
    u.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${u.guid}\``;
}
