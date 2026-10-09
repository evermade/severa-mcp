// Cross-tool tests for the authz-driven row scoping (self-only tier) and the
// employment-field redaction on phase members (gated on isFullAccess-or-self,
// independent of the caller's row-visibility scope).
//
// Since authz is now resolved fresh per call (src/authz.ts's
// resolveCallerAuthz/requireCategoryAccess), tests simulate a tier by
// configuring env role-list vars *and* mocking the /v1/users role lookup
// that resolveCallerAuthz makes internally — not by injecting a CallerAuthz
// object directly (there's no such injection point left).
import { describe, it, expect } from "vitest";
import { callTool, makeTestEnv, mockSeveraFetch, testProps, type Route } from "../../test/harness";
import { registerHoursTools } from "./hours";
import { registerActivityTools } from "./activities";
import { registerResourceAllocationTools } from "./resource-allocations";
import { registerPhaseMemberTools } from "./phase-members";
import { registerUserTools } from "./users";
import { registerLookupTools } from "./lookup";

// Version/variant nibbles (4/8) kept valid so these also pass as tool
// *arguments* through Zod's strict `.uuid()` schema, not just as fixture data.
const SELF_GUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // Tiia Tester
const OTHER_GUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccd"; // Sam Sample

// Matches the /v1/users?email=<caller> call resolveCallerAuthz makes
// internally — must come before any broader, unfiltered /v1/users route in
// the same mockSeveraFetch call (queryMatches requires an exact-value match
// on `email`, so it won't misfire against the caller's own lookup).
function roleRoute(role: string): Route {
  return {
    path: "/v1/users",
    query: { email: testProps.email },
    response: [{ guid: SELF_GUID, email: testProps.email, permissionProfile: { name: role } }],
  };
}

function selfOnlyEnv() {
  return makeTestEnv({ SEVERA_SELF_ONLY_ROLES: "Employee" });
}

function businessOnlyEnv() {
  return makeTestEnv({
    SEVERA_BUSINESS_ONLY_ROLES: "Account Director",
    SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS: "travels,overtimes",
  });
}

const registerHoursNoWrites = (
  s: Parameters<typeof registerHoursTools>[0],
  e: Parameters<typeof registerHoursTools>[1],
  p: Parameters<typeof registerHoursTools>[2],
) => registerHoursTools(s, e, p, { enableWrites: false });

describe("self-only tier hides other users' rows", () => {
  it("severa_list_work_hours only shows the caller's own entries", async () => {
    const env = selfOnlyEnv();
    mockSeveraFetch({
      routes: [
        roleRoute("Employee"),
        {
          path: "/v1/workhours",
          response: [
            { guid: "1", user: { guid: SELF_GUID, firstName: "Tiia", lastName: "Tester" }, quantity: 2, eventDate: "2026-04-10" },
            { guid: "2", user: { guid: OTHER_GUID, firstName: "Sam", lastName: "Sample" }, quantity: 3, eventDate: "2026-04-11" },
          ],
        },
      ],
    });
    const { text } = await callTool("severa_list_work_hours", {}, [registerHoursNoWrites], { env });
    expect(text).toContain("Tiia Tester");
    expect(text).not.toContain("Sam Sample");
    expect(text).toMatch(/1 entry/);
  });

  it("severa_list_resource_allocations only shows the caller's own allocation", async () => {
    const env = selfOnlyEnv();
    mockSeveraFetch({
      routes: [
        roleRoute("Employee"),
        {
          path: "/v1/resourceallocations",
          response: [
            { guid: "1", user: { guid: SELF_GUID, firstName: "Tiia", lastName: "Tester" }, hoursAllocated: 80 },
            { guid: "2", user: { guid: OTHER_GUID, firstName: "Sam", lastName: "Sample" }, hoursAllocated: 40 },
          ],
        },
      ],
    });
    const { text } = await callTool("severa_list_resource_allocations", {}, [registerResourceAllocationTools], {
      env,
    });
    expect(text).toContain("Tiia Tester");
    expect(text).not.toContain("Sam Sample");
  });

  it("severa_list_activities defaults userGuids to the caller's own GUID server-side", async () => {
    const env = selfOnlyEnv();
    const { calls } = mockSeveraFetch({
      routes: [roleRoute("Employee"), { path: "/v1/activities", response: [] }],
    });
    await callTool("severa_list_activities", {}, [registerActivityTools], { env });
    const c = calls.find((x) => x.url.includes("/v1/activities"));
    expect(c?.url).toContain(`userGuids=${SELF_GUID}`);
  });

  it("severa_list_activities gives a clear permission-denied message (not an ambiguous empty result) when asked for someone outside scope", async () => {
    const env = selfOnlyEnv();
    mockSeveraFetch({ routes: [roleRoute("Employee"), { path: "/v1/activities", response: [] }] });
    const { text } = await callTool(
      "severa_list_activities",
      { userGuids: [OTHER_GUID] },
      [registerActivityTools],
      { env },
    );
    expect(text).toMatch(/you can only view activities for yourself/i);
  });
});

describe("explicit out-of-scope requests get a clear permission-denied message, not an ambiguous empty result", () => {
  it("severa_list_work_hours denies an explicit request for someone else's GUID", async () => {
    const env = selfOnlyEnv();
    mockSeveraFetch({ routes: [roleRoute("Employee"), { path: "/v1/workhours", response: [] }] });
    const { text } = await callTool("severa_list_work_hours", { userGuid: OTHER_GUID }, [registerHoursNoWrites], {
      env,
    });
    expect(text).toMatch(/you can only view work hours for yourself/i);
  });

  it("severa_list_time_entries denies an explicit request for someone else's GUID", async () => {
    const env = selfOnlyEnv();
    mockSeveraFetch({ routes: [roleRoute("Employee"), { path: "/v1/timeentries", response: [] }] });
    const { text } = await callTool("severa_list_time_entries", { userGuid: OTHER_GUID }, [registerHoursNoWrites], {
      env,
    });
    expect(text).toMatch(/you can only view time entries for yourself/i);
  });

  it("severa_list_workdays denies an explicit request for someone else's GUID", async () => {
    const env = selfOnlyEnv();
    mockSeveraFetch({ routes: [roleRoute("Employee"), { path: "/v1/workdays", response: [] }] });
    const { text } = await callTool("severa_list_workdays", { userGuid: OTHER_GUID }, [registerHoursNoWrites], {
      env,
    });
    expect(text).toMatch(/you can only view workdays for yourself/i);
  });

  it("severa_list_resource_allocations denies an explicit request for someone else's GUID", async () => {
    const env = selfOnlyEnv();
    mockSeveraFetch({ routes: [roleRoute("Employee"), { path: "/v1/resourceallocations", response: [] }] });
    const { text } = await callTool(
      "severa_list_resource_allocations",
      { userGuid: OTHER_GUID },
      [registerResourceAllocationTools],
      { env },
    );
    expect(text).toMatch(/you can only view resource allocations for yourself/i);
  });

  it("business-only tier can freely request another user's GUID (broad visibility, no denial)", async () => {
    const env = businessOnlyEnv();
    mockSeveraFetch({
      routes: [
        roleRoute("Account Director"),
        {
          path: "/v1/resourceallocations",
          response: [
            { guid: "1", user: { guid: OTHER_GUID, firstName: "Sam", lastName: "Sample" }, hoursAllocated: 40 },
          ],
        },
      ],
    });
    const { text } = await callTool(
      "severa_list_resource_allocations",
      { userGuid: OTHER_GUID },
      [registerResourceAllocationTools],
      { env },
    );
    expect(text).toContain("Sam Sample");
    expect(text).not.toMatch(/you can only/i);
  });
});

describe("employment-field redaction on phase members", () => {
  const fixture = [
    {
      guid: "m1",
      user: { guid: SELF_GUID, firstName: "Tiia", lastName: "Tester" },
      phase: { guid: "p1", name: "Discovery" },
      currentWorkContractTitle: "Senior Consultant",
    },
    {
      guid: "m2",
      user: { guid: OTHER_GUID, firstName: "Sam", lastName: "Sample" },
      phase: { guid: "p1", name: "Discovery" },
      currentWorkContractTitle: "Consultant",
    },
  ];

  it("shows the caller's own contract title but redacts everyone else's (self-only tier)", async () => {
    const env = selfOnlyEnv();
    mockSeveraFetch({ routes: [roleRoute("Employee"), { path: "/v1/phasemembers", response: fixture }] });
    const { text } = await callTool("severa_list_phase_members", {}, [registerPhaseMemberTools], { env });
    expect(text).toContain("Senior Consultant");
    expect(text).not.toContain("— Consultant");
    expect(text).toContain("(restricted)");
  });

  it("still redacts others' contract titles even with broad row visibility (business-only tier)", async () => {
    const env = businessOnlyEnv();
    mockSeveraFetch({ routes: [roleRoute("Account Director"), { path: "/v1/phasemembers", response: fixture }] });
    const { text } = await callTool("severa_list_phase_members", {}, [registerPhaseMemberTools], { env });
    // Both members appear (broad row visibility for resourcing purposes)...
    expect(text).toContain("Tiia Tester");
    expect(text).toContain("Sam Sample");
    // ...but only the caller's own contract title is visible.
    expect(text).toContain("Senior Consultant");
    expect(text).toContain("(restricted)");
    expect(text).not.toContain("— Consultant");
  });
});

describe("role changes take effect on the next call once the cached role is gone (no reconnect needed)", () => {
  it("severa_list_work_hours reflects a demotion from full-access to self-only without re-registering anything", async () => {
    const env = makeTestEnv({
      SEVERA_FULL_ACCESS_ROLES: "Pääkäyttäjä",
      SEVERA_SELF_ONLY_ROLES: "Employee",
    });
    const rows = [
      { guid: "1", user: { guid: SELF_GUID, firstName: "Tiia", lastName: "Tester" }, quantity: 2, eventDate: "2026-04-10" },
      { guid: "2", user: { guid: OTHER_GUID, firstName: "Sam", lastName: "Sample" }, quantity: 3, eventDate: "2026-04-11" },
    ];

    // Call 1: still full-access — sees everyone's hours.
    mockSeveraFetch({ routes: [roleRoute("Pääkäyttäjä"), { path: "/v1/workhours", response: rows }] });
    const first = await callTool("severa_list_work_hours", {}, [registerHoursNoWrites], { env });
    expect(first.text).toContain("Sam Sample");

    // Simulate the role-cache TTL (src/severa/user-resolver.ts) having
    // elapsed — this harness's in-memory KV mock doesn't implement expiry,
    // so evict the entry directly rather than fake-advance time. Key format
    // mirrors that file's private cacheKey().
    await env.CACHE_KV.delete(`severa:user:v2:${testProps.email}`);

    // Call 2 — same env/KV, same registered handler, no reconnect and no
    // re-registration — but the caller's real Severa role has since changed
    // to Employee. A fresh resolveCallerAuthz() inside the handler picks it
    // up immediately.
    mockSeveraFetch({ routes: [roleRoute("Employee"), { path: "/v1/workhours", response: rows }] });
    const second = await callTool("severa_list_work_hours", {}, [registerHoursNoWrites], { env });
    expect(second.text).toContain("Tiia Tester");
    expect(second.text).not.toContain("Sam Sample");
  });
});

describe("inactive users are hidden from anyone who isn't full-access", () => {
  const usersFixture = [
    { guid: "active-1", firstName: "Tiia", lastName: "Tester", email: "tiia@example.com", isActive: true },
    { guid: "inactive-1", firstName: "Bygone", lastName: "Bob", email: "bob@example.com", isActive: false },
  ];

  it("severa_list_users never shows an inactive user to a non-full-access caller", async () => {
    const env = businessOnlyEnv();
    mockSeveraFetch({
      routes: [roleRoute("Account Director"), { path: "/v1/users", response: usersFixture }],
    });
    const { text } = await callTool("severa_list_users", {}, [registerUserTools], { env });
    expect(text).toContain("Tiia Tester");
    expect(text).not.toContain("Bygone Bob");
  });

  it("severa_list_users ignores an explicit isActive:false request from a non-full-access caller", async () => {
    const env = businessOnlyEnv();
    // Route returns both regardless of query, so this exercises the
    // client-side defense-in-depth filter, not just the server-side param.
    mockSeveraFetch({
      routes: [roleRoute("Account Director"), { path: "/v1/users", response: usersFixture }],
    });
    const { text } = await callTool("severa_list_users", { isActive: false }, [registerUserTools], { env });
    expect(text).not.toContain("Bygone Bob");
  });

  it("severa_list_users still shows inactive users to a full-access caller (no over-restriction)", async () => {
    mockSeveraFetch({ routes: [{ path: "/v1/users", response: usersFixture }] });
    const { text } = await callTool("severa_list_users", {}, [registerUserTools]);
    expect(text).toContain("Tiia Tester");
    expect(text).toContain("Bygone Bob");
  });

  it("severa_find_user (exact email) never returns an inactive user to a non-full-access caller", async () => {
    const env = businessOnlyEnv();
    mockSeveraFetch({
      routes: [
        roleRoute("Account Director"),
        { path: "/v1/users", query: { email: "bob@example.com" }, response: [usersFixture[1]] },
      ],
    });
    const { text } = await callTool("severa_find_user", { email: "bob@example.com" }, [registerLookupTools], {
      env,
    });
    expect(text).toBe("No users matched.");
  });

  it("severa_find_user (exact email) still returns an inactive user to a full-access caller", async () => {
    mockSeveraFetch({
      routes: [{ path: "/v1/users", query: { email: "bob@example.com" }, response: [usersFixture[1]] }],
    });
    const { text } = await callTool("severa_find_user", { email: "bob@example.com" }, [registerLookupTools]);
    expect(text).toContain("Bygone Bob");
  });

  const phaseMembersFixture = [
    {
      guid: "pm1",
      user: { guid: "active-1", firstName: "Tiia", lastName: "Tester" },
      phase: { guid: "p1", name: "Discovery" },
      isActive: true,
    },
    {
      guid: "pm2",
      user: { guid: "inactive-1", firstName: "Bygone", lastName: "Bob" },
      phase: { guid: "p1", name: "Discovery" },
      isActive: false,
    },
  ];

  it("severa_list_phase_members hides inactive members from a non-full-access caller entirely (not just labeled)", async () => {
    const env = businessOnlyEnv();
    mockSeveraFetch({
      routes: [roleRoute("Account Director"), { path: "/v1/phasemembers", response: phaseMembersFixture }],
    });
    const { text } = await callTool("severa_list_phase_members", {}, [registerPhaseMemberTools], { env });
    expect(text).toContain("Tiia Tester");
    expect(text).not.toContain("Bygone Bob");
    expect(text).not.toContain("(inactive)");
  });

  it("severa_list_phase_members still shows inactive members (labeled) to a full-access caller", async () => {
    mockSeveraFetch({ routes: [{ path: "/v1/phasemembers", response: phaseMembersFixture }] });
    const { text } = await callTool("severa_list_phase_members", {}, [registerPhaseMemberTools]);
    expect(text).toContain("Tiia Tester");
    expect(text).toContain("Bygone Bob");
    expect(text).toContain("(inactive)");
  });
});
