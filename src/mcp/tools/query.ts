import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaFetch, severaPaginate } from "../../severa/client";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { toJsonBlock } from "../format";
import { AccessDeniedError, resolveCallerAuthz } from "../../authz";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerQueryTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_query",
    {
      description: [
        "Generic GET proxy to the Severa REST API. Use this for any read you need that isn't covered by a dedicated tool — it handles auth, retries, rate limiting, and pagination.",
        "",
        "Usage:",
        "- `path` must start with `/v1/`. Examples: `/v1/customers`, `/v1/salescases`, `/v1/projects/{guid}/workhours`, `/v1/invoices`.",
        "- `query` is a flat object. Array values become repeated params (e.g. `salesStatusTypeGuids: [\"a\",\"b\"]` → `?salesStatusTypeGuids=a&salesStatusTypeGuids=b`). Boolean/number/string all work.",
        "- `paginate` (default true) follows the `NextPageToken` header up to `maxRows` (default 500, max 5000). Set `paginate: false` for single-object endpoints like `/v1/customers/{guid}`.",
        "",
        "Reference-data endpoints — this is how you resolve metadata GUIDs for filters on other tools:",
        "- `/v1/salesstatustypes` (supports `?salesState=Won|Lost|InProgress`) — for `salesStatusTypeGuids`",
        "- `/v1/projectstatustypes` — for `projectStatusTypeGuids`",
        "- `/v1/phasestatustypes` — phase status GUIDs",
        "- `/v1/worktypes` — for `workTypeGuid` when logging hours",
        "- `/v1/businessunits`, `/v1/marketsegmentations`, `/v1/keywords`, `/v1/currencies`, `/v1/costcenters`, `/v1/pricelists`, `/v1/paymentterms`, `/v1/leadsources`",
        "",
        "Common query-filter patterns:",
        "- date range: `startDate` / `endDate` (ISO-8601, often with time component for `/workhours`)",
        "- open/closed: `isClosed: true|false`",
        "- active only: `isActive: true` or `active: true` (varies by endpoint)",
        "",
        "Full API reference: https://api.severa.visma.com/rest-api/doc/index.html",
        "",
        "Returns the raw JSON response. For list endpoints, that's an array; for item endpoints, a single object.",
      ].join("\n"),
      inputSchema: {
        path: z
          .string()
          .regex(/^\/v1\//, "Path must start with /v1/"),
        query: z
          .record(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.array(z.string()),
            ]),
          )
          .nullish(),
        paginate: z.boolean().nullish(),
        maxRows: z.number().int().min(1).max(5000).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Severa API query" },
    },
    async ({ path, query, paginate, maxRows }) => {
      // Highest-risk tool (raw, unfiltered proxy) — full-access tier only,
      // re-checked fresh on every call rather than trusted from registration
      // time, since a demoted caller must lose this immediately.
      const authz = await resolveCallerAuthz(env, props);
      if (!authz.canUseQuery) {
        throw new AccessDeniedError("This tool is not available for your current Severa role.");
      }
      const shouldPaginate = paginate ?? true;
      const max = maxRows ?? 500;
      const opts = query ? { query } : {};

      // Debug echo — list the query-param keys the server actually received,
      // so the LLM can see immediately if the transport stripped one (e.g.
      // claude.ai has been observed to silently lose date strings on some
      // tool calls).
      const receivedKeys = query ? Object.keys(query).sort() : [];
      const debug = `\n\n[server received: path=${path}, query-keys=[${receivedKeys.join(", ")}], paginate=${shouldPaginate}, maxRows=${max}]`;

      if (shouldPaginate) {
        const data = await severaPaginate<unknown>(env, path, opts, max);
        const truncated = data.length >= max;
        const title = `${path} — ${data.length} row(s)${truncated ? " (truncated; increase maxRows to see more)" : ""}${debug}`;
        return toJsonBlock(title, data);
      }
      const data = await severaFetch<unknown>(env, path, opts);
      return toJsonBlock(`${path}${debug}`, data);
    },
  );
}
