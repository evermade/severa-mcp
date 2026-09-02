// Cross-tool tests for the authz-driven row scoping (self-only tier) and the
// employment-field redaction on phase members (gated on isFullAccess-or-self,
// independent of the caller's row-visibility scope).
import { describe, it, expect } from "vitest";
import { callTool, mockSeveraFetch, testProps } from "../../test/harness";
import type { CallerAuthz } from "../../authz";
import { registerHoursTools } from "./hours";
import { registerActivityTools } from "./activities";
import { registerResourceAllocationTools } from "./resource-allocations";
import { registerPhaseMemberTools } from "./phase-members";

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
