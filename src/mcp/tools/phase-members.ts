import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import type { PhaseMemberOutputModel } from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { toText } from "../format";
import { requireCategoryAccess, type CallerAuthz } from "../../authz";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function registerPhaseMemberTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_phase_members",
    {
      description: [
        "List phase-member assignments from `/v1/phasemembers` — which users are staffed on which phases. Answers 'who's on this project?' and 'what phases is X working on?'.",
        "",
        "Server-side filters:",
        "- `isUserActive` — filter out assignments for deactivated users",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `userGuid` — scope to one user",
        "- `phaseGuid` — scope to one phase (discover via `severa_list_phases`)",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        isUserActive: z.boolean().nullish(),
        changedSince: isoDate().nullish(),
        userGuid: z.string().uuid().nullish(),
        phaseGuid: z.string().uuid().nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List phase members" },
    },
    async (args) => {
      const authz = await requireCategoryAccess(env, props, "phase-members");
      const limit = args.limit ?? 100;
      // Non-admins never see inactive users, even if they explicitly ask
      // for isUserActive: false — force it, don't just default it.
      const isUserActive = authz.isFullAccess ? args.isUserActive : true;
      const rows = await severaPaginate<PhaseMemberOutputModel>(env, "/v1/phasemembers", {
        query: {
          ...(isUserActive != null ? { isUserActive } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      // Defense-in-depth: don't rely solely on the server-side filter above.
      const visible = authz.isFullAccess ? rows : rows.filter((m) => m.isActive !== false);

      const hits = visible
        .filter((m) => {
          if (args.userGuid && m.user?.guid !== args.userGuid) return false;
          if (args.phaseGuid && m.phase?.guid !== args.phaseGuid) return false;
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No phase members match those filters.");
      return toText(
        `${hits.length} member(s)${hits.length < visible.length ? ` (of ${visible.length} fetched)` : ""}:\n${hits.map((m) => renderMemberRow(m, authz)).join("\n")}`,
      );
    },
  );
}

function renderMemberRow(m: PhaseMemberOutputModel, authz: CallerAuthz): string {
  const who =
    m.user?.name ||
    [m.user?.firstName, m.user?.lastName].filter(Boolean).join(" ") ||
    "(no user)";
  // Employment-relationship info stays hidden regardless of row-visibility
  // scope — a caller with broad visibility (e.g. for resourcing) still
  // shouldn't see everyone's contract type, only their own.
  const canSeeContractTitle = authz.isFullAccess || m.user?.guid === authz.selfGuid;
  const contractTitle = canSeeContractTitle ? m.currentWorkContractTitle : m.currentWorkContractTitle ? "(restricted)" : undefined;
  const parts = [
    `**${who}**`,
    m.phase?.name,
    contractTitle,
    m.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${m.guid}\``;
}
