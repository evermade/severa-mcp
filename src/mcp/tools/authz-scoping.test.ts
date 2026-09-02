// Cross-tool tests for the authz-driven row scoping (self-only tier) and the
// employment-field redaction on phase members (gated on isFullAccess-or-self,
// independent of the caller's row-visibility scope).
import { describe, it, expect } from "vitest";
import { callTool, mockSeveraFetch, testAuthz, testProps } from "../../test/harness";
import type { CallerAuthz } from "../../authz";
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

const selfOnlyAuthz: CallerAuthz = {
  isFullAccess: false,
  rowScope: "self",
  selfGuid: SELF_GUID,
  blockedToolKeys: new Set(),
  canUseQuery: false,
};

const businessOnlyAuthz: CallerAuthz = {
  isFullAccess: false,
  rowScope: "all",
  selfGuid: SELF_GUID,
  blockedToolKeys: new Set(["travels", "overtimes"]),
  canUseQuery: false,
};

const registerHoursSelfOnly = (
  s: Parameters<typeof registerHoursTools>[0],
  e: Parameters<typeof registerHoursTools>[1],
  p: Parameters<typeof registerHoursTools>[2],
) => registerHoursTools(s, e, p, { enableWrites: false, authz: selfOnlyAuthz });

describe("self-only tier hides other users' rows", () => {
  it("severa_list_work_hours only shows the caller's own entries", async () => {
    mockSeveraFetch({
      routes: [
        {
          path: "/v1/workhours",
          response: [
            { guid: "1", user: { guid: SELF_GUID, firstName: "Tiia", lastName: "Tester" }, quantity: 2, eventDate: "2026-04-10" },
            { guid: "2", user: { guid: OTHER_GUID, firstName: "Sam", lastName: "Sample" }, quantity: 3, eventDate: "2026-04-11" },
          ],
        },
      ],
    });
    const { text } = await callTool("severa_list_work_hours", {}, [registerHoursSelfOnly]);
    expect(text).toContain("Tiia Tester");
    expect(text).not.toContain("Sam Sample");
    expect(text).toMatch(/1 entry/);
  });

  it("severa_list_resource_allocations only shows the caller's own allocation", async () => {
    mockSeveraFetch({
      routes: [
        {
          path: "/v1/resourceallocations",
          response: [
            { guid: "1", user: { guid: SELF_GUID, firstName: "Tiia", lastName: "Tester" }, hoursAllocated: 80 },
            { guid: "2", user: { guid: OTHER_GUID, firstName: "Sam", lastName: "Sample" }, hoursAllocated: 40 },
          ],
        },
      ],
    });
    const registerResourceAllocationsSelfOnly = (
      s: Parameters<typeof registerResourceAllocationTools>[0],
      e: Parameters<typeof registerResourceAllocationTools>[1],
    ) => registerResourceAllocationTools(s, e, selfOnlyAuthz);
    const { text } = await callTool("severa_list_resource_allocations", {}, [
      registerResourceAllocationsSelfOnly,
    ]);
    expect(text).toContain("Tiia Tester");
    expect(text).not.toContain("Sam Sample");
  });

  it("severa_list_activities defaults userGuids to the caller's own GUID server-side", async () => {
    const { calls } = mockSeveraFetch({
      routes: [{ path: "/v1/activities", response: [] }],
    });
    const registerActivitiesSelfOnly = (
      s: Parameters<typeof registerActivityTools>[0],
      e: Parameters<typeof registerActivityTools>[1],
      p: Parameters<typeof registerActivityTools>[2],
    ) => registerActivityTools(s, e, p, selfOnlyAuthz);
    await callTool("severa_list_activities", {}, [registerActivitiesSelfOnly], {
      props: { ...testProps },
    });
    const c = calls.find((x) => x.url.includes("/v1/activities"));
    expect(c?.url).toContain(`userGuids=${SELF_GUID}`);
  });

  it("severa_list_activities returns no results (not everyone's) when asked for someone outside scope", async () => {
    mockSeveraFetch({ routes: [{ path: "/v1/activities", response: [] }] });
    const registerActivitiesSelfOnly = (
      s: Parameters<typeof registerActivityTools>[0],
      e: Parameters<typeof registerActivityTools>[1],
      p: Parameters<typeof registerActivityTools>[2],
    ) => registerActivityTools(s, e, p, selfOnlyAuthz);
    const { text } = await callTool(
      "severa_list_activities",
      { userGuids: [OTHER_GUID] },
      [registerActivitiesSelfOnly],
    );
    expect(text).toBe("No activities match those filters.");
  });
});

describe("employment-field redaction on phase members", () => {
  const registerPhaseMembersSelfOnly = (
    s: Parameters<typeof registerPhaseMemberTools>[0],
    e: Parameters<typeof registerPhaseMemberTools>[1],
  ) => registerPhaseMemberTools(s, e, selfOnlyAuthz);
  const registerPhaseMembersBusinessOnly = (
    s: Parameters<typeof registerPhaseMemberTools>[0],
    e: Parameters<typeof registerPhaseMemberTools>[1],
  ) => registerPhaseMemberTools(s, e, businessOnlyAuthz);

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
    mockSeveraFetch({ routes: [{ path: "/v1/phasemembers", response: fixture }] });
    const { text } = await callTool("severa_list_phase_members", {}, [registerPhaseMembersSelfOnly]);
    expect(text).toContain("Senior Consultant");
    expect(text).not.toContain("— Consultant");
    expect(text).toContain("(restricted)");
  });

  it("still redacts others' contract titles even with broad row visibility (business-only tier)", async () => {
    mockSeveraFetch({ routes: [{ path: "/v1/phasemembers", response: fixture }] });
    const { text } = await callTool("severa_list_phase_members", {}, [
      registerPhaseMembersBusinessOnly,
    ]);
    // Both members appear (broad row visibility for resourcing purposes)...
    expect(text).toContain("Tiia Tester");
    expect(text).toContain("Sam Sample");
    // ...but only the caller's own contract title is visible.
    expect(text).toContain("Senior Consultant");
    expect(text).toContain("(restricted)");
    expect(text).not.toContain("— Consultant");
  });
});

describe("inactive users are hidden from anyone who isn't full-access", () => {
  const usersFixture = [
    { guid: "active-1", firstName: "Tiia", lastName: "Tester", email: "tiia@example.com", isActive: true },
    { guid: "inactive-1", firstName: "Bygone", lastName: "Bob", email: "bob@example.com", isActive: false },
  ];

  const registerUsersBusinessOnly = (
    s: Parameters<typeof registerUserTools>[0],
    e: Parameters<typeof registerUserTools>[1],
  ) => registerUserTools(s, e, businessOnlyAuthz);
  const registerUsersFullAccess = (
    s: Parameters<typeof registerUserTools>[0],
    e: Parameters<typeof registerUserTools>[1],
  ) => registerUserTools(s, e, testAuthz);

  const registerLookupBusinessOnly = (
    s: Parameters<typeof registerLookupTools>[0],
    e: Parameters<typeof registerLookupTools>[1],
    p: Parameters<typeof registerLookupTools>[2],
  ) => registerLookupTools(s, e, p, businessOnlyAuthz);
  const registerLookupFullAccess = (
    s: Parameters<typeof registerLookupTools>[0],
    e: Parameters<typeof registerLookupTools>[1],
    p: Parameters<typeof registerLookupTools>[2],
  ) => registerLookupTools(s, e, p, testAuthz);

  it("severa_list_users never shows an inactive user to a non-full-access caller", async () => {
    mockSeveraFetch({ routes: [{ path: "/v1/users", response: usersFixture }] });
    const { text } = await callTool("severa_list_users", {}, [registerUsersBusinessOnly]);
    expect(text).toContain("Tiia Tester");
    expect(text).not.toContain("Bygone Bob");
  });

  it("severa_list_users ignores an explicit isActive:false request from a non-full-access caller", async () => {
    // Route returns both regardless of query, so this exercises the
    // client-side defense-in-depth filter, not just the server-side param.
    mockSeveraFetch({ routes: [{ path: "/v1/users", response: usersFixture }] });
    const { text } = await callTool("severa_list_users", { isActive: false }, [
      registerUsersBusinessOnly,
    ]);
    expect(text).not.toContain("Bygone Bob");
  });

  it("severa_list_users still shows inactive users to a full-access caller (no over-restriction)", async () => {
    mockSeveraFetch({ routes: [{ path: "/v1/users", response: usersFixture }] });
    const { text } = await callTool("severa_list_users", {}, [registerUsersFullAccess]);
    expect(text).toContain("Tiia Tester");
    expect(text).toContain("Bygone Bob");
  });

  it("severa_find_user (exact email) never returns an inactive user to a non-full-access caller", async () => {
    mockSeveraFetch({
      routes: [{ path: "/v1/users", response: [usersFixture[1]] }], // matches the inactive user's email
    });
    const { text } = await callTool(
      "severa_find_user",
      { email: "bob@example.com" },
      [registerLookupBusinessOnly],
    );
    expect(text).toBe("No users matched.");
  });

  it("severa_find_user (exact email) still returns an inactive user to a full-access caller", async () => {
    mockSeveraFetch({
      routes: [{ path: "/v1/users", response: [usersFixture[1]] }],
    });
    const { text } = await callTool(
      "severa_find_user",
      { email: "bob@example.com" },
      [registerLookupFullAccess],
    );
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
    mockSeveraFetch({ routes: [{ path: "/v1/phasemembers", response: phaseMembersFixture }] });
    const registerPhaseMembersBusinessOnly = (
      s: Parameters<typeof registerPhaseMemberTools>[0],
      e: Parameters<typeof registerPhaseMemberTools>[1],
    ) => registerPhaseMemberTools(s, e, businessOnlyAuthz);
    const { text } = await callTool("severa_list_phase_members", {}, [
      registerPhaseMembersBusinessOnly,
    ]);
    expect(text).toContain("Tiia Tester");
    expect(text).not.toContain("Bygone Bob");
    expect(text).not.toContain("(inactive)");
  });

  it("severa_list_phase_members still shows inactive members (labeled) to a full-access caller", async () => {
    mockSeveraFetch({ routes: [{ path: "/v1/phasemembers", response: phaseMembersFixture }] });
    const registerPhaseMembersFullAccess = (
      s: Parameters<typeof registerPhaseMemberTools>[0],
      e: Parameters<typeof registerPhaseMemberTools>[1],
    ) => registerPhaseMemberTools(s, e, testAuthz);
    const { text } = await callTool("severa_list_phase_members", {}, [
      registerPhaseMembersFullAccess,
    ]);
    expect(text).toContain("Tiia Tester");
    expect(text).toContain("Bygone Bob");
    expect(text).toContain("(inactive)");
  });
});
