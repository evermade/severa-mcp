import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import type {
  ResourceAllocationOutputModel,
  RoleAllocationOutputModel,
} from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { toText } from "../format";
import { filterVisible, requireCategoryAccess, requireVisibleIfRequested } from "../../authz";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = () => z.string().uuid();

export function registerResourceAllocationTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_resource_allocations",
    {
      description: [
        "List Severa resource allocations (who's booked to what, when) from `/v1/resourceallocations`.",
        "",
        "Server-side filter is thin — only `changedSince`.",
        "",
        "Client-side filters (post-fetch):",
        "- `projectGuid`, `phaseGuid`, `userGuid`",
        "- `startFrom` / `startTo` — YYYY-MM-DD range on `startDate`",
        "",
        "Richer scoped variants exist — prefer via `severa_query`:",
        "- `/v1/projects/{projectGuid}/resourceallocations/allocations`",
        "- `/v1/phases/{phaseGuid}/resourceallocations/allocations`",
        "- `/v1/users/{userGuid}/resourceallocations/allocations`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        changedSince: isoDate().nullish(),
        projectGuid: uuid().nullish(),
        phaseGuid: uuid().nullish(),
        userGuid: uuid().nullish(),
        startFrom: isoDate().nullish(),
        startTo: isoDate().nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List resource allocations" },
    },
    async (args) => {
      const authz = await requireCategoryAccess(env, props, "resource-allocations");
      const limit = args.limit ?? 100;
      requireVisibleIfRequested(authz, args.userGuid, "view resource allocations");
      const rows = await severaPaginate<ResourceAllocationOutputModel>(
        env,
        "/v1/resourceallocations",
        {
          query: {
            ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
            rowCount: Math.min(1000, Math.max(limit, 100)),
          },
        },
      );

      const visible = filterVisible(authz, rows, (r) => r.user?.guid);
      const hits = visible
        .filter((r) => {
          if (args.projectGuid && r.project?.guid !== args.projectGuid) return false;
          if (args.phaseGuid && r.phase?.guid !== args.phaseGuid) return false;
          if (args.userGuid && r.user?.guid !== args.userGuid) return false;
          if (args.startFrom || args.startTo) {
            const d = r.startDate?.slice(0, 10);
            if (!d) return false;
            if (args.startFrom && d < args.startFrom) return false;
            if (args.startTo && d > args.startTo) return false;
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No resource allocations match those filters.");
      return toText(
        `${hits.length} allocation(s)${hits.length < visible.length ? ` (of ${visible.length} fetched)` : ""}:\n${hits.map(renderAllocationRow).join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_list_role_allocations",
    {
      description: [
        "List role-based allocations from `/v1/roleallocations` — useful for 'who at this role is free next month'.",
        "",
        "Server-side filters (rich):",
        "- `startDate`, `endDate` — YYYY-MM-DD (date range the allocation must overlap)",
        "- `useSalesProbability` — weight allocations by sales-case probability",
        "- `roleGuids` — via `severa_query({ path: '/v1/roles' })`",
        "- `phaseGuids`",
        "- `projectGuids`",
        "",
        "Client-side filter:",
        "- `projectNameContains`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        startDate: isoDate().nullish(),
        endDate: isoDate().nullish(),
        useSalesProbability: z.boolean().nullish(),
        roleGuids: z.array(uuid()).nullish(),
        phaseGuids: z.array(uuid()).nullish(),
        projectGuids: z.array(uuid()).nullish(),
        projectNameContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List role allocations" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "resource-allocations");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<RoleAllocationOutputModel>(
        env,
        "/v1/roleallocations",
        {
          query: {
            ...(args.startDate ? { startDate: args.startDate } : {}),
            ...(args.endDate ? { endDate: args.endDate } : {}),
            ...(args.useSalesProbability != null
              ? { useSalesProbability: args.useSalesProbability }
              : {}),
            ...(args.roleGuids?.length ? { roleGuids: args.roleGuids } : {}),
            ...(args.phaseGuids?.length ? { phaseGuids: args.phaseGuids } : {}),
            ...(args.projectGuids?.length ? { projectGuids: args.projectGuids } : {}),
            rowCount: Math.min(1000, Math.max(limit, 100)),
          },
        },
      );

      const hits = rows
        .filter((r) => {
          if (
            args.projectNameContains &&
            !(r.project?.name ?? "")
              .toLowerCase()
              .includes(args.projectNameContains.toLowerCase())
          ) {
            return false;
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No role allocations match those filters.");
      return toText(
        `${hits.length} allocation(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderRoleAllocationRow).join("\n")}`,
      );
    },
  );
}

function renderAllocationRow(r: ResourceAllocationOutputModel): string {
  const who = [r.user?.firstName, r.user?.lastName].filter(Boolean).join(" ") || "?";
  const parts = [
    who,
    r.project?.name,
    r.phase?.name,
    r.startDate?.slice(0, 10),
    r.endDate?.slice(0, 10),
    r.hoursAllocated != null ? `${r.hoursAllocated}h` : undefined,
    r.percentageAllocated != null ? `${r.percentageAllocated}%` : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}

function renderRoleAllocationRow(r: RoleAllocationOutputModel): string {
  const parts = [
    r.role?.name,
    r.project?.name,
    r.phase?.name,
    r.startDate?.slice(0, 10),
    r.endDate?.slice(0, 10),
    r.hoursAllocated != null ? `${r.hoursAllocated}h` : undefined,
    r.salesProbability != null ? `${r.salesProbability}%` : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}
