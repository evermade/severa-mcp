// Role-derived permission scoping. See the plan this implements for the
// full rationale: three config-driven tiers built on each caller's real
// Severa `permissionProfile.name`, with no hardcoded role names — if the
// three role-list env vars below are all unset, this is a no-op and every
// caller gets today's unrestricted behavior.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireSeveraUserRole } from "./severa/user-resolver";
import type { Env } from "./env";
import type { SessionProps } from "./auth/session";
import type { Guid } from "./severa/types";
import { toText } from "./mcp/format";

export interface CallerAuthz {
  // Full-access tier — no restriction anywhere, including sensitive fields
  // like employment-contract details that are otherwise gated separately
  // from row visibility.
  isFullAccess: boolean;
  rowScope: "all" | "self";
  // Set whenever rowScope is "self", and also for the business-only tier
  // (needed there for the isFullAccess-or-self gate on sensitive fields,
  // even though rowScope itself is "all").
  selfGuid: Guid | null;
  // Whole tool categories (matching `src/mcp/tools/*.ts` basenames) that
  // must not be registered at all for this caller.
  blockedToolKeys: Set<string>;
  // severa_query is a raw proxy to any Severa endpoint — full-access tier only.
  canUseQuery: boolean;
}

export class AccessDeniedError extends Error {}

function parseList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

const FULL_ACCESS: CallerAuthz = {
  isFullAccess: true,
  rowScope: "all",
  selfGuid: null,
  blockedToolKeys: new Set(),
  canUseQuery: true,
};

export async function resolveCallerAuthz(env: Env, props: SessionProps): Promise<CallerAuthz> {
  const fullRoles = parseList(env.SEVERA_FULL_ACCESS_ROLES);
  const businessRoles = parseList(env.SEVERA_BUSINESS_ONLY_ROLES);
  const selfRoles = parseList(env.SEVERA_SELF_ONLY_ROLES);

  if (fullRoles.size === 0 && businessRoles.size === 0 && selfRoles.size === 0) {
    return FULL_ACCESS;
  }

  const { guid, role } = await requireSeveraUserRole(env, props.email);
  const normalized = role.toLowerCase();

  if (fullRoles.has(normalized)) return FULL_ACCESS;

  if (businessRoles.has(normalized)) {
    return {
      isFullAccess: false,
      rowScope: "all",
      selfGuid: guid,
      blockedToolKeys: parseList(env.SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS),
      canUseQuery: false,
    };
  }

  if (selfRoles.has(normalized)) {
    return {
      isFullAccess: false,
      rowScope: "self",
      selfGuid: guid,
      blockedToolKeys: new Set(),
      canUseQuery: false,
    };
  }

  throw new AccessDeniedError(
    `Your Severa role ("${role || "unknown"}") does not currently have access to this tool. Contact an admin if you believe this is a mistake.`,
  );
}

export function filterVisible<T>(
  authz: CallerAuthz,
  rows: T[],
  getGuid: (row: T) => Guid | undefined,
): T[] {
  if (authz.rowScope === "all") return rows;
  return rows.filter((row) => getGuid(row) === authz.selfGuid);
}

export function effectiveUserGuids(
  authz: CallerAuthz,
  requested?: Guid[] | null,
): Guid[] | undefined {
  if (authz.rowScope === "all") return requested ?? undefined;
  if (!requested?.length) return authz.selfGuid ? [authz.selfGuid] : [];
  return requested.filter((g) => g === authz.selfGuid);
}

export function requireVisible(authz: CallerAuthz, guid: Guid | undefined, what: string): void {
  if (authz.rowScope !== "all" && guid !== authz.selfGuid) {
    throw new AccessDeniedError(`You can only ${what} for yourself.`);
  }
}

// The real security boundary for tool-category blocking. Registration-time
// gating in mcp/server.ts/local.ts (the `allow(key)` checks) is only a
// best-effort tool-list tailoring layer — it can go stale for as long as a
// Durable Object instance stays hot (no reconnect needed to trigger it, but
// no guarantee either). Every handler in a blockable category calls this as
// its first line so a caller demoted mid-session is denied on their next
// call once the role cache (src/severa/user-resolver.ts) refreshes,
// regardless of what was registered when the session started.
export async function requireCategoryAccess(
  env: Env,
  props: SessionProps,
  category: string,
): Promise<CallerAuthz> {
  const authz = await resolveCallerAuthz(env, props);
  if (authz.blockedToolKeys.has(category)) {
    throw new AccessDeniedError(`This tool is not available for your current Severa role.`);
  }
  return authz;
}

// Same check as requireVisible, but a no-op when the caller didn't ask for
// anyone in particular (guid undefined) — for list tools where an explicit
// userGuid argument names a specific target, but omitting it just means
// "show me what I'm allowed to see" rather than "show me nobody."
export function requireVisibleIfRequested(
  authz: CallerAuthz,
  guid: Guid | null | undefined,
  what: string,
): void {
  if (guid != null) requireVisible(authz, guid, what);
}

// For list tools that accept an array of target GUIDs: throws a clear
// denial when the caller explicitly asked for specific people and every one
// of them was outside their visibility (rather than silently returning an
// empty "no results" — which reads as "nothing matched your filters," not
// "you're not allowed to see this," and leaves the LLM to guess why).
export function requireEffectiveVisible(
  requested: Guid[] | undefined,
  effective: Guid[] | undefined,
  what: string,
): void {
  if (requested?.length && !effective?.length) {
    throw new AccessDeniedError(`You can only ${what} for yourself.`);
  }
}

// A caller whose role isn't recognized gets exactly one tool explaining why,
// rather than a broken/empty MCP connection.
export function registerAccessDeniedTool(server: McpServer, message: string): void {
  server.registerTool(
    "severa_access_denied",
    {
      description: "Explains why this account currently has no access to Severa tools.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        title: "Access denied",
      },
    },
    async () => toText(message),
  );
}
