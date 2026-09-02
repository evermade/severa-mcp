// Live integration test for role-derived permission scoping (src/authz.ts).
// Hits the real Severa API using credentials from .dev.vars — same opt-in
// pattern as severa-live.test.ts. Uses the existing SEVERA_USER_EMAIL test
// account rather than requiring new dedicated per-tier test users, so this
// carries no employee PII of its own: it derives "which tier should this
// email land in" from whatever SEVERA_*_ROLES lists are already in .dev.vars
// and cross-checks resolveCallerAuthz's real output against that.
//
// Opt in via `npm run test:integration`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { resolveCallerAuthz } from "../../src/authz";
import { requireSeveraUserRole, normalizeRoleName } from "../../src/severa/user-resolver";
import type { Env } from "../../src/env";
import type { SessionProps } from "../../src/auth/session";

function loadDevVars(): Record<string, string> {
  try {
    const text = readFileSync(resolve(process.cwd(), ".dev.vars"), "utf8");
    return Object.fromEntries(
      text
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => {
          const eq = l.indexOf("=");
          const raw = l.slice(eq + 1).trim();
          const unquoted =
            (raw.startsWith('"') && raw.endsWith('"')) ||
            (raw.startsWith("'") && raw.endsWith("'"))
              ? raw.slice(1, -1)
              : raw;
          return [l.slice(0, eq).trim(), unquoted];
        }),
    );
  } catch {
    return {};
  }
}

function makeMemoryKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const v = store.get(key);
      if (!v) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function parseList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

const vars = loadDevVars();

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    CACHE_KV: makeMemoryKV(),
    OAUTH_KV: makeMemoryKV(),
    SEVERA_CLIENT_ID: vars.SEVERA_CLIENT_ID ?? "",
    SEVERA_CLIENT_SECRET: vars.SEVERA_CLIENT_SECRET ?? "",
    SEVERA_ENV: (vars.SEVERA_ENV ?? "prod") as "stag" | "prod",
    SEVERA_API_BASE_STAG:
      vars.SEVERA_API_BASE_STAG ?? "https://api.severa.stag.visma.com/rest-api",
    SEVERA_API_BASE_PROD:
      vars.SEVERA_API_BASE_PROD ?? "https://api.severa.visma.com/rest-api",
    SEVERA_EMAIL_MAP: vars.SEVERA_EMAIL_MAP,
    ENABLE_WRITE_TOOLS: "false",
    ...overrides,
  } as unknown as Env;
}

const testProps: SessionProps = {
  email: vars.SEVERA_USER_EMAIL ?? "",
  name: "integration-test",
  googleSub: "integration-test",
};

describe.skipIf(!vars.SEVERA_CLIENT_ID || !vars.SEVERA_USER_EMAIL)(
  "Role-derived permission scoping (live integration)",
  () => {
    it("resolves a real permissionProfile.name for the configured test user via /v1/users", async () => {
      // This is the single biggest assumption the whole feature rests on:
      // that Severa's real API actually returns permissionProfile inline on
      // /v1/users, in the shape src/severa/types.ts now declares.
      const env = baseEnv();
      const { guid, role } = await requireSeveraUserRole(env, testProps.email);
      expect(guid).toMatch(/^[0-9a-f-]{36}$/i);
      expect(typeof role).toBe("string");
    });

    it("is a no-op (full access) against the real API when no role-list env vars are set", async () => {
      const env = baseEnv();
      const authz = await resolveCallerAuthz(env, testProps);
      expect(authz).toEqual({
        isFullAccess: true,
        rowScope: "all",
        selfGuid: null,
        blockedToolKeys: new Set(),
        canUseQuery: true,
      });
    });

    // Only runs if this repo's .dev.vars already configures the same
    // SEVERA_*_ROLES vars used in production/staging (see wrangler.toml) —
    // cross-checks resolveCallerAuthz's real classification of the
    // configured test user against which configured list their real,
    // normalized profile name actually falls into.
    const hasRoleConfig =
      vars.SEVERA_FULL_ACCESS_ROLES || vars.SEVERA_BUSINESS_ONLY_ROLES || vars.SEVERA_SELF_ONLY_ROLES;

    it.skipIf(!hasRoleConfig)(
      "classifies the configured test user into the tier matching their real Severa role",
      async () => {
        const roleOverrides: Partial<Env> = {};
        if (vars.SEVERA_FULL_ACCESS_ROLES) roleOverrides.SEVERA_FULL_ACCESS_ROLES = vars.SEVERA_FULL_ACCESS_ROLES;
        if (vars.SEVERA_BUSINESS_ONLY_ROLES)
          roleOverrides.SEVERA_BUSINESS_ONLY_ROLES = vars.SEVERA_BUSINESS_ONLY_ROLES;
        if (vars.SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS)
          roleOverrides.SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS = vars.SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS;
        if (vars.SEVERA_SELF_ONLY_ROLES) roleOverrides.SEVERA_SELF_ONLY_ROLES = vars.SEVERA_SELF_ONLY_ROLES;
        const env = baseEnv(roleOverrides);

        const { role } = await requireSeveraUserRole(env, testProps.email);
        const normalized = normalizeRoleName(role).toLowerCase();
        const fullRoles = parseList(vars.SEVERA_FULL_ACCESS_ROLES);
        const businessRoles = parseList(vars.SEVERA_BUSINESS_ONLY_ROLES);
        const selfRoles = parseList(vars.SEVERA_SELF_ONLY_ROLES);

        const authz = await resolveCallerAuthz(env, testProps);

        if (fullRoles.has(normalized)) {
          expect(authz.isFullAccess).toBe(true);
          expect(authz.canUseQuery).toBe(true);
        } else if (businessRoles.has(normalized)) {
          expect(authz.isFullAccess).toBe(false);
          expect(authz.rowScope).toBe("all");
          expect(authz.canUseQuery).toBe(false);
        } else if (selfRoles.has(normalized)) {
          expect(authz.isFullAccess).toBe(false);
          expect(authz.rowScope).toBe("self");
          expect(authz.selfGuid).toBeTruthy();
        } else {
          // Configured test user's real role isn't in any list — this repo's
          // resolveCallerAuthz must fail closed (reject), not fall through.
          await expect(resolveCallerAuthz(env, testProps)).rejects.toThrow();
        }
      },
    );
  },
);
