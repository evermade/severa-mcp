// Tier-2 list tools: work_hours, time_entries, workdays, resource/role
// allocations, project fees, project travel expenses, travel reimbursements.
import { describe, it, expect, beforeEach } from "vitest";
import workHoursFx from "../../__fixtures__/severa/workhours.april.json";
import timeEntriesFx from "../../__fixtures__/severa/timeentries.week.json";
import workdaysFx from "../../__fixtures__/severa/workdays.week.json";
import resourceAllocationsFx from "../../__fixtures__/severa/resource-allocations.json";
import roleAllocationsFx from "../../__fixtures__/severa/role-allocations.json";
import projectFeesFx from "../../__fixtures__/severa/project-fees.json";
import projectTravelExpensesFx from "../../__fixtures__/severa/project-travel-expenses.json";
import travelReimbursementsFx from "../../__fixtures__/severa/travel-reimbursements.json";
import { callTool, listTools, mockSeveraFetch } from "../../test/harness";
import { registerHoursTools } from "./hours";
import { registerResourceAllocationTools } from "./resource-allocations";
import { registerFeeTools } from "./fees";
import { registerTravelTools } from "./travels";

const registerHoursRead = (
  s: Parameters<typeof registerHoursTools>[0],
  e: Parameters<typeof registerHoursTools>[1],
  p: Parameters<typeof registerHoursTools>[2],
) => registerHoursTools(s, e, p, { enableWrites: false });

describe("severa_list_work_hours", () => {
  let calls: ReturnType<typeof mockSeveraFetch>["calls"];
  beforeEach(() => {
    ({ calls } = mockSeveraFetch({
      routes: [{ path: "/v1/workhours", response: workHoursFx }],
    }));
  });

  it("lists work-hour entries and totals quantity", async () => {
    const { text } = await callTool("severa_list_work_hours", {}, [registerHoursRead]);
    expect(text).toMatch(/2 entries.*total 6\.50h/);
  });

  it("passes eventDateStart / eventDateEnd + billableStatus verbatim", async () => {
    await callTool(
      "severa_list_work_hours",
      {
        eventDateStart: "2026-04-01",
        eventDateEnd: "2026-04-30",
        billableStatus: "Billable",
      },
      [registerHoursRead],
    );
    const c = calls.find((x) => x.url.includes("/v1/workhours"));
    expect(c?.url).toContain("eventDateStart=2026-04-01");
    expect(c?.url).toContain("eventDateEnd=2026-04-30");
    expect(c?.url).toContain("billableStatus=Billable");
  });

  it("filters by userGuid client-side", async () => {
    const { text } = await callTool(
      "severa_list_work_hours",
      { userGuid: "cccccccc-cccc-cccc-cccc-cccccccccccd" },
      [registerHoursRead],
    );
    expect(text).toContain("Sam Sample");
    expect(text).not.toContain("Tiia Tester");
  });
});

describe("severa_list_time_entries", () => {
  beforeEach(() => {
    mockSeveraFetch({
      routes: [{ path: "/v1/timeentries", response: timeEntriesFx }],
    });
  });

  it("lists time entries", async () => {
    const { text } = await callTool("severa_list_time_entries", {}, [registerHoursRead]);
    expect(text).toContain("Focused time");
    expect(text).toContain("Acme - Website renewal");
  });
});

describe("severa_list_workdays", () => {
  let calls: ReturnType<typeof mockSeveraFetch>["calls"];
  beforeEach(() => {
    ({ calls } = mockSeveraFetch({
      routes: [{ path: "/v1/workdays", response: workdaysFx }],
    }));
  });

  it("totals workday hours", async () => {
    const { text } = await callTool(
      "severa_list_workdays",
      { startDate: "2026-04-20", endDate: "2026-04-21" },
      [registerHoursRead],
    );
    expect(text).toMatch(/2 workday\(s\).*total\s*15\.50h/s);
  });

  it("merges singular userGuid into userGuids array", async () => {
    await callTool(
      "severa_list_workdays",
      { userGuid: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
      [registerHoursRead],
    );
    const c = calls.find((x) => x.url.includes("/v1/workdays"));
    expect(c?.url).toContain("userGuids=cccccccc-cccc-cccc-cccc-cccccccccccc");
  });
});

describe("severa_list_resource_allocations", () => {
  beforeEach(() => {
    mockSeveraFetch({
      routes: [{ path: "/v1/resourceallocations", response: resourceAllocationsFx }],
    });
  });

  it("returns allocations and honors projectGuid client-side filter", async () => {
    const { text } = await callTool(
      "severa_list_resource_allocations",
      { projectGuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1" },
      [registerResourceAllocationTools],
    );
    expect(text).toContain("Acme - Website renewal");
    expect(text).toContain("Tiia Tester");
    expect(text).toContain("80h");
  });
});

describe("severa_list_role_allocations", () => {
  let calls: ReturnType<typeof mockSeveraFetch>["calls"];
  beforeEach(() => {
    ({ calls } = mockSeveraFetch({
      routes: [{ path: "/v1/roleallocations", response: roleAllocationsFx }],
    }));
  });

  it("passes startDate/endDate and roleGuids server-side", async () => {
    await callTool(
      "severa_list_role_allocations",
      {
        startDate: "2026-05-01",
        endDate: "2026-06-30",
        roleGuids: ["88aa88aa-88aa-88aa-88aa-88aa88aa88a1"],
      },
      [registerResourceAllocationTools],
    );
    const c = calls.find((x) => x.url.includes("/v1/roleallocations"));
    expect(c?.url).toContain("startDate=2026-05-01");
    expect(c?.url).toContain("endDate=2026-06-30");
    expect(c?.url).toContain("roleGuids=88aa88aa-88aa-88aa-88aa-88aa88aa88a1");
  });

  it("renders role allocations", async () => {
    const { text } = await callTool(
      "severa_list_role_allocations",
      { startDate: "2026-05-01", endDate: "2026-06-30" },
      [registerResourceAllocationTools],
    );
    expect(text).toContain("Senior Developer");
    expect(text).toContain("Acme - Website renewal");
    expect(text).toContain("120h");
  });
});

describe("severa_list_project_fees", () => {
  beforeEach(() => {
    mockSeveraFetch({
      routes: [{ path: "/v1/projectfees", response: projectFeesFx }],
    });
  });

  it("lists fees and totals them", async () => {
    const { text } = await callTool("severa_list_project_fees", {}, [registerFeeTools]);
    expect(text).toMatch(/1 fee\(s\).*total\s+150/s);
    expect(text).toContain("Stock photo license");
  });
});

describe("severa_list_project_travel_expenses", () => {
  beforeEach(() => {
    mockSeveraFetch({
      routes: [{ path: "/v1/projecttravelexpenses", response: projectTravelExpensesFx }],
    });
  });

  it("lists expenses and totals them", async () => {
    const { text } = await callTool(
      "severa_list_project_travel_expenses",
      {},
      [registerTravelTools],
    );
    expect(text).toMatch(/1 expense\(s\).*total\s+86/s);
    expect(text).toContain("Helsinki to Turku");
  });
});

describe("severa_list_travel_reimbursements", () => {
  beforeEach(() => {
    mockSeveraFetch({
      routes: [{ path: "/v1/travelreimbursements", response: travelReimbursementsFx }],
    });
  });

  it("lists reimbursements with destination/purpose", async () => {
    const { text } = await callTool(
      "severa_list_travel_reimbursements",
      {},
      [registerTravelTools],
    );
    expect(text).toContain("Stockholm");
    expect(text).toContain("Client workshop");
    expect(text).toContain("Submitted");
  });
});

describe("tier-2 tool registration", () => {
  it("all tier-2 tools register with ≥40-char descriptions", async () => {
    const tools = await listTools([
      registerHoursRead,
      registerResourceAllocationTools,
      registerFeeTools,
      registerTravelTools,
    ]);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "severa_get_my_hours",
      "severa_get_unbilled_hours",
      "severa_list_flat_rates",
      "severa_list_project_fees",
      "severa_list_project_recurring_fees",
      "severa_list_project_travel_expenses",
      "severa_list_resource_allocations",
      "severa_list_role_allocations",
      "severa_list_time_entries",
      "severa_list_travel_reimbursements",
      "severa_list_work_hours",
      "severa_list_workdays",
    ]);
    for (const t of tools) {
      expect(t.description).toBeTruthy();
      expect(t.description!.length).toBeGreaterThanOrEqual(40);
    }
  });
});
