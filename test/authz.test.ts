// Unit tests for the role-derived permission scoping mechanism (src/authz.ts).
// Covers all three config-driven tiers, the unlisted-role rejection, and the
// fully-unconfigured no-op path.
import { describe, it, expect } from "vitest";
import { resolveCallerAuthz, AccessDeniedError } from "../src/authz";
import { makeTestEnv, mockSeveraFetch, testProps } from "../src/test/harness";

function mockUser(permissionProfileName: string) {
  mockSeveraFetch({
    routes: [
      {
        path: "/v1/users",
        response: [
          {
            guid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
            email: testProps.email,
            permissionProfile: { guid: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", name: permissionProfileName },
          },
        ],
      },
    ],
  });
}

describe("resolveCallerAuthz", () => {
  it("is a no-op (full access, no Severa call) when no role-list env vars are set", async () => {
    const env = makeTestEnv(); // no SEVERA_*_ROLES set — fetch is intentionally left unmocked
    const authz = await resolveCallerAuthz(env, testProps);
    expect(authz).toEqual({
      isFullAccess: true,
      rowScope: "all",
      selfGuid: null,
      blockedToolKeys: new Set(),
      canUseQuery: true,
    });
  });

  it("grants full access for a role in SEVERA_FULL_ACCESS_ROLES", async () => {
    mockUser("Pääkäyttäjä");
    const env = makeTestEnv({ SEVERA_FULL_ACCESS_ROLES: "Pääkäyttäjä" });
    const authz = await resolveCallerAuthz(env, testProps);
    expect(authz.isFullAccess).toBe(true);
    expect(authz.rowScope).toBe("all");
    expect(authz.canUseQuery).toBe(true);
    expect(authz.blockedToolKeys.size).toBe(0);
  });

  it("normalizes a team-suffixed profile name for the business-only tier", async () => {
    mockUser("Account Director - Kärsä");
    const env = makeTestEnv({
      SEVERA_BUSINESS_ONLY_ROLES: "Account Director,Project Manager",
      SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS: "travels,overtimes",
    });
    const authz = await resolveCallerAuthz(env, testProps);
    expect(authz.isFullAccess).toBe(false);
    expect(authz.rowScope).toBe("all");
    expect(authz.canUseQuery).toBe(false);
    expect(authz.selfGuid).toBe("dddddddd-dddd-dddd-dddd-dddddddddddd");
    expect([...authz.blockedToolKeys].sort()).toEqual(["overtimes", "travels"]);
  });

  it("also normalizes a Project Manager team suffix to the same business-only tier", async () => {
    mockUser("Project Manager - KP");
    const env = makeTestEnv({
      SEVERA_BUSINESS_ONLY_ROLES: "Account Director,Project Manager",
      SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS: "travels,overtimes",
    });
    const authz = await resolveCallerAuthz(env, testProps);
    expect(authz.rowScope).toBe("all");
    expect(authz.canUseQuery).toBe(false);
  });

  it("scopes the self-only tier to just the caller's own GUID", async () => {
    mockUser("Employee");
    const env = makeTestEnv({ SEVERA_SELF_ONLY_ROLES: "Employee" });
    const authz = await resolveCallerAuthz(env, testProps);
    expect(authz.isFullAccess).toBe(false);
    expect(authz.rowScope).toBe("self");
    expect(authz.canUseQuery).toBe(false);
    expect(authz.selfGuid).toBe("dddddddd-dddd-dddd-dddd-dddddddddddd");
    expect(authz.blockedToolKeys.size).toBe(0);
  });

  it("rejects a role not listed in any tier", async () => {
    mockUser("Freelancer");
    const env = makeTestEnv({
      SEVERA_FULL_ACCESS_ROLES: "Pääkäyttäjä",
      SEVERA_BUSINESS_ONLY_ROLES: "Account Director,Project Manager",
      SEVERA_SELF_ONLY_ROLES: "Employee",
    });
    await expect(resolveCallerAuthz(env, testProps)).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
