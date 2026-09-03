import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
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

export function registerRootPhaseTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_root_phases",
    {
      description: [
        "List root phases (top-level phases of projects) from `/v1/rootphaseswithhierarchy`. Useful for skimming the high-level structure of many projects at once — one row per root phase, scoped by the usual project filters.",
        "",
        "Server-side filters (arrays; resolve GUIDs via `severa_list_projects` / `severa_find_customer` / `severa_query`):",
        "- `customerGuids`, `projectGuids`, `projectKeywordGuids`, `projectStatusTypeGuids`, `salesStatusTypeGuids`",
        "- `salesPersonGuids`, `projectOwnerGuids`, `customerOwnerGuids`, `projectMemberUserGuids`",
        "- `businessUnitGuids`",
        "- `openProjects` — true = only projects that are still open",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        customerGuids: z.array(z.string().uuid()).nullish(),
        projectGuids: z.array(z.string().uuid()).nullish(),
        projectKeywordGuids: z.array(z.string().uuid()).nullish(),
        projectStatusTypeGuids: z.array(z.string().uuid()).nullish(),
        salesStatusTypeGuids: z.array(z.string().uuid()).nullish(),
        salesPersonGuids: z.array(z.string().uuid()).nullish(),
        projectOwnerGuids: z.array(z.string().uuid()).nullish(),
        customerOwnerGuids: z.array(z.string().uuid()).nullish(),
        projectMemberUserGuids: z.array(z.string().uuid()).nullish(),
        businessUnitGuids: z.array(z.string().uuid()).nullish(),
        openProjects: z.boolean().nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List root phases" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "root-phases");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<PhaseOutputModel>(env, "/v1/rootphaseswithhierarchy", {
        query: {
          ...(args.customerGuids?.length ? { customerGuids: args.customerGuids } : {}),
          ...(args.projectGuids?.length ? { projectGuids: args.projectGuids } : {}),
          ...(args.projectKeywordGuids?.length ? { projectKeywordGuids: args.projectKeywordGuids } : {}),
          ...(args.projectStatusTypeGuids?.length
            ? { projectStatusTypeGuids: args.projectStatusTypeGuids }
            : {}),
          ...(args.salesStatusTypeGuids?.length
            ? { salesStatusTypeGuids: args.salesStatusTypeGuids }
            : {}),
          ...(args.salesPersonGuids?.length ? { salesPersonGuids: args.salesPersonGuids } : {}),
          ...(args.projectOwnerGuids?.length ? { projectOwnerGuids: args.projectOwnerGuids } : {}),
          ...(args.customerOwnerGuids?.length ? { customerOwnerGuids: args.customerOwnerGuids } : {}),
          ...(args.projectMemberUserGuids?.length
            ? { projectMemberUserGuids: args.projectMemberUserGuids }
            : {}),
          ...(args.businessUnitGuids?.length ? { businessUnitGuids: args.businessUnitGuids } : {}),
          ...(args.openProjects != null ? { openProjects: args.openProjects } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows.slice(0, limit);
      if (!hits.length) return toText("No root phases match those filters.");
      return toText(
        `${hits.length} root phase(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderRow).join("\n")}`,
      );
    },
  );
}

function renderRow(p: PhaseOutputModel): string {
  const parts = [
    `**${p.name ?? "(no name)"}**`,
    p.project?.name,
    p.startDate?.slice(0, 10),
    p.deadline ? `→ ${p.deadline.slice(0, 10)}` : undefined,
    p.isClosed ? "(closed)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${p.guid}\``;
}
