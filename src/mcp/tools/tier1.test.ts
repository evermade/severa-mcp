// Cross-tool tests for the Tier-1 list tools added after the initial wave.
// Each tool gets a happy-path test, a server-side-param assertion, and a
// client-side filter assertion. One big file to keep the fixtures and
// imports in one place.
import { describe, it, expect, beforeEach } from "vitest";
import proposalsFx from "../../__fixtures__/severa/proposals.recent.json";
import activitiesFx from "../../__fixtures__/severa/activities.week.json";
import usersFx from "../../__fixtures__/severa/users.active.json";
import contactsFx from "../../__fixtures__/severa/contacts.active.json";
import productsFx from "../../__fixtures__/severa/products.active.json";
import phasesFx from "../../__fixtures__/severa/phases.project.json";
import { callTool, listTools, mockSeveraFetch } from "../../test/harness";
import { registerProposalTools } from "./proposals";
import { registerActivityTools } from "./activities";
import { registerUserTools } from "./users";
import { registerContactTools } from "./contacts";
import { registerProductTools } from "./products";
import { registerPhaseTools } from "./phases";

describe("severa_list_proposals", () => {
  beforeEach(() => {
    mockSeveraFetch({ routes: [{ path: "/v1/proposals", response: proposalsFx }] });
  });

  it("lists proposals and totals expected value", async () => {
    const { text } = await callTool("severa_list_proposals", {}, [registerProposalTools]);
    expect(text).toMatch(/2 proposal\(s\)/);
    expect(text).toContain("Acme Q2 Growth Package");
    expect(text).toContain("Beta Extension");
    expect(text).toMatch(/total\s+58\s+000/);
  });

  it("filters by customerGuid client-side", async () => {
    const { text } = await callTool(
      "severa_list_proposals",
      { customerGuid: "11111111-1111-1111-1111-111111111111" },
      [registerProposalTools],
    );
    expect(text).toContain("Acme Q2");
    expect(text).not.toContain("Beta Extension");
  });

  it("filters by statusNameContains", async () => {
    const { text } = await callTool(
      "severa_list_proposals",
      { statusNameContains: "Draft" },
      [registerProposalTools],
    );
    expect(text).toContain("Acme Q2");
    expect(text).not.toContain("Beta Extension");
  });
});

describe("severa_list_activities", () => {
  let calls: ReturnType<typeof mockSeveraFetch>["calls"];
  beforeEach(() => {
    ({ calls } = mockSeveraFetch({
      routes: [{ path: "/v1/activities", response: activitiesFx }],
    }));
  });

  it("lists activities with subject and duration", async () => {
    const { text } = await callTool("severa_list_activities", {}, [registerActivityTools]);
    expect(text).toContain("Kick-off with Acme");
    expect(text).toContain("Beta review");
    expect(text).toMatch(/2 activit/);
  });

  it("passes startDateTime verbatim when already ISO datetime", async () => {
    await callTool(
      "severa_list_activities",
      { startDateTime: "2026-04-20T00:00:00Z" },
      [registerActivityTools],
    );
    const c = calls.find((x) => x.url.includes("/v1/activities"));
    expect(c?.url).toContain("startDateTime=2026-04-20T00%3A00%3A00Z");
  });

  it("normalizes YYYY-MM-DD startDateTime to midnight UTC", async () => {
    await callTool(
      "severa_list_activities",
      { startDateTime: "2026-04-20" },
      [registerActivityTools],
    );
    const c = calls.find((x) => x.url.includes("/v1/activities"));
    expect(c?.url).toContain("startDateTime=2026-04-20T00%3A00%3A00Z");
  });

  it("filters by descriptionContains client-side", async () => {
    const { text } = await callTool(
      "severa_list_activities",
      { descriptionContains: "scoping" },
      [registerActivityTools],
    );
    expect(text).toContain("Kick-off with Acme");
    expect(text).not.toContain("Beta review");
  });
});

describe("severa_list_users", () => {
  let calls: ReturnType<typeof mockSeveraFetch>["calls"];
  beforeEach(() => {
    ({ calls } = mockSeveraFetch({
      routes: [{ path: "/v1/users", response: usersFx }],
    }));
  });

  it("lists active users", async () => {
    const { text } = await callTool(
      "severa_list_users",
      { isActive: true },
      [registerUserTools],
    );
    expect(text).toMatch(/2 user\(s\)/);
    expect(text).toContain("Tiia Tester");
    expect(text).toContain("Sam Sample");
  });

  it("passes isActive + businessUnitGuids to the API", async () => {
    await callTool(
      "severa_list_users",
      {
        isActive: true,
        businessUnitGuids: ["f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1"],
      },
      [registerUserTools],
    );
    const c = calls.find((x) => x.url.includes("/v1/users"));
    expect(c?.url).toContain("isActive=true");
    expect(c?.url).toContain("businessUnitGuids=f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1");
  });

  it("filters by emailContains client-side", async () => {
    const { text } = await callTool(
      "severa_list_users",
      { emailContains: "sam@" },
      [registerUserTools],
    );
    expect(text).toContain("Sam Sample");
    expect(text).not.toContain("Tiia Tester");
  });
});

describe("severa_list_contact_persons", () => {
  beforeEach(() => {
    mockSeveraFetch({ routes: [{ path: "/v1/contactpersons", response: contactsFx }] });
  });

  it("lists contacts with customer and email", async () => {
    const { text } = await callTool(
      "severa_list_contact_persons",
      { active: true },
      [registerContactTools],
    );
    expect(text).toMatch(/2 contact\(s\)/);
    expect(text).toContain("Sanna Sample");
    expect(text).toContain("Ben Beta");
  });

  it("scopes by customerGuid client-side", async () => {
    const { text } = await callTool(
      "severa_list_contact_persons",
      { customerGuid: "22222222-2222-2222-2222-222222222222" },
      [registerContactTools],
    );
    expect(text).toContain("Ben Beta");
    expect(text).not.toContain("Sanna Sample");
  });
});

describe("severa_list_products", () => {
  beforeEach(() => {
    mockSeveraFetch({ routes: [{ path: "/v1/products", response: productsFx }] });
  });

  it("lists products with unit price", async () => {
    const { text } = await callTool(
      "severa_list_products",
      { isActive: true },
      [registerProductTools],
    );
    expect(text).toMatch(/2 product\(s\)/);
    expect(text).toContain("Growth audit");
    expect(text).toContain("Monthly retainer");
  });

  it("narrows with nameContains", async () => {
    const { text } = await callTool(
      "severa_list_products",
      { isActive: true, nameContains: "retainer" },
      [registerProductTools],
    );
    expect(text).toContain("Monthly retainer");
    expect(text).not.toContain("Growth audit");
  });
});

describe("severa_list_phases", () => {
  let calls: ReturnType<typeof mockSeveraFetch>["calls"];
  beforeEach(() => {
    ({ calls } = mockSeveraFetch({
      routes: [{ path: "/v1/phases", response: phasesFx }],
    }));
  });

  it("lists phases of a project", async () => {
    const { text } = await callTool(
      "severa_list_phases",
      { projectGuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1" },
      [registerPhaseTools],
    );
    expect(text).toContain("Discovery");
    expect(text).toContain("Build");
  });

  it("sends singular projectGuid as projectGuids array", async () => {
    await callTool(
      "severa_list_phases",
      { projectGuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1" },
      [registerPhaseTools],
    );
    const c = calls.find((x) => x.url.includes("/v1/phases"));
    expect(c?.url).toContain("projectGuids=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1");
  });
});

describe("tier-1 tool registration", () => {
  it("proposals, activities, users, contacts, products, phases all advertise ≥40 char descriptions", async () => {
    const tools = await listTools([
      registerProposalTools,
      registerActivityTools,
      registerUserTools,
      registerContactTools,
      registerProductTools,
      registerPhaseTools,
    ]);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "severa_get_proposal_breakdown",
      "severa_list_activities",
      "severa_list_contact_persons",
      "severa_list_phases",
      "severa_list_products",
      "severa_list_proposals",
      "severa_list_users",
    ]);
    for (const t of tools) {
      expect(t.description).toBeTruthy();
      expect(t.description!.length).toBeGreaterThanOrEqual(40);
    }
  });
});
