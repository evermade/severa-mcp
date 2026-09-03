import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type { PhaseOutputModel } from "../../severa/types";
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

export function registerPhaseTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_phases",
    {
      description: [
        "List Severa project phases from `/v1/phases`. Use this to discover phase GUIDs needed by `severa_log_hours` and other per-phase tools.",
        "",
        "Server-side filters:",
        "- `projectGuid` / `projectGuids`",
        "- `code` — phase code (exact)",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `nameContains`, `statusNameContains`",
        "- `isClosed` — filter on `phaseStatus.isClosed`",
        "",
        "For the hierarchical tree, prefer `severa_query({ path: '/v1/projects/{guid}/phaseswithhierarchy' })`. `limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        projectGuid: uuid().nullish(),
        projectGuids: z.array(uuid()).nullish(),
        code: z.string().nullish(),
        changedSince: isoDate().nullish(),
        nameContains: z.string().min(1).nullish(),
        statusNameContains: z.string().min(1).nullish(),
        isClosed: z.boolean().nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List phases" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "phases");
      const limit = args.limit ?? 100;
      const projectGuids = [
        ...(args.projectGuid ? [args.projectGuid] : []),
        ...(args.projectGuids ?? []),
      ];
      const rows = await severaPaginate<PhaseOutputModel>(env, "/v1/phases", {
        query: {
          ...(projectGuids.length ? { projectGuids } : {}),
          ...(args.code ? { code: args.code } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows
        .filter((p) => {
          if (args.nameContains && !matches(p.name, args.nameContains)) return false;
          if (args.statusNameContains && !matches(p.phaseStatus?.name, args.statusNameContains))
            return false;
          if (args.isClosed != null && p.phaseStatus?.isClosed !== args.isClosed) {
            return false;
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No phases match those filters.");
      return toText(
        `${hits.length} phase(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderPhaseRow).join("\n")}`,
      );
    },
  );
}

function renderPhaseRow(p: PhaseOutputModel): string {
  const parts = [
    `**${p.name ?? "(no name)"}**`,
    p.code,
    p.project?.name,
    p.phaseStatus?.name,
    p.startDate?.slice(0, 10),
    p.deadline?.slice(0, 10),
    p.phaseStatus?.isClosed || p.isClosed ? "(closed)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${p.guid}\``;
}
