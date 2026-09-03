import { describe, it, expect, beforeEach, afterEach } from "vitest";
import customersActive from "../../__fixtures__/severa/customers.active.json";
import projectsWonNb from "../../__fixtures__/severa/projects.won-nb-april.json";
import { callTool, listTools, mockSeveraFetch } from "../../test/harness";
import { registerLookupTools } from "./lookup";

describe("severa_list_customers", () => {
  let calls: ReturnType<typeof mockSeveraFetch>["calls"];

  beforeEach(() => {
    ({ calls } = mockSeveraFetch({
      routes: [
        { path: "/v1/customers", query: { isActive: "true" }, response: customersActive },
      ],
    }));
  });

  afterEach(() => calls.splice(0));

  it("lists customers with isActive=true", async () => {
    const { text } = await callTool(
      "severa_list_customers",
      { isActive: true },
      [registerLookupTools],
    );
    expect(text).toMatch(/3 customer\(s\)/);
    expect(text).toContain("Acme Oy");
    expect(text).toContain("Beta Industries");
    expect(text).toContain("Gamma Ltd");
  });

  it("passes isActive=true to the Severa API", async () => {
    await callTool(
      "severa_list_customers",
      { isActive: true },
      [registerLookupTools],
    );
    const customersCall = calls.find((c) => c.url.includes("/v1/customers"));
    expect(customersCall?.url).toContain("isActive=true");
  });

  it("applies client-side nameContains filter", async () => {
    const { text } = await callTool(
      "severa_list_customers",
      { isActive: true, nameContains: "Beta" },
      [registerLookupTools],
    );
    expect(text).toContain("Beta Industries");
    expect(text).not.toContain("Acme Oy");
    expect(text).not.toContain("Gamma Ltd");
    expect(text).toMatch(/1 customer\(s\)/);
  });
});

describe("severa_list_projects", () => {
  beforeEach(() => {
    mockSeveraFetch({
      routes: [
        {
          path: "/v1/projects",
          query: { salesStatusTypeGuids: "39f9432a-a141-fcab-9142-8045bf8ed54a" },
          response: projectsWonNb,
        },
      ],
    });
  });

  it("lists Won/NB projects and totals their expected value", async () => {
    const { text } = await callTool(
      "severa_list_projects",
      { salesStatusTypeGuids: ["39f9432a-a141-fcab-9142-8045bf8ed54a"] },
      [registerLookupTools],
    );
    expect(text).toMatch(/2 project\(s\)/);
    expect(text).toContain("Acme - Website renewal");
    expect(text).toContain("Beta - Care contract 2026");
    expect(text).toMatch(/total\s+30\s+500\s+EUR/); // 27000 + 3500, sv-FI uses NBSP
  });

  it("narrows by expectedOrderFrom/To client-side", async () => {
    const { text } = await callTool(
      "severa_list_projects",
      {
        salesStatusTypeGuids: ["39f9432a-a141-fcab-9142-8045bf8ed54a"],
        expectedOrderFrom: "2026-04-14",
        expectedOrderTo: "2026-04-14",
      },
      [registerLookupTools],
    );
    expect(text).toMatch(/1 project\(s\)/);
    expect(text).toContain("Beta - Care contract 2026");
    expect(text).not.toContain("Acme - Website renewal");
  });
});

describe("severa_list_projects isWon server-side resolution", () => {
  // Regression: the salesStatus sub-model on /v1/projects does NOT include
  // `isWon`, so a client-side check always fails. The fix resolves isWon
  // to salesStatusTypeGuids by querying /v1/salesstatustypes?salesState=Won.
  it("isWon:true queries /v1/salesstatustypes?salesState=Won and injects GUIDs", async () => {
    const { calls } = mockSeveraFetch({
      routes: [
        {
          path: "/v1/salesstatustypes",
          query: { salesState: "Won", active: "true" },
          response: [
            { guid: "won-guid-1", name: "Order / NB", salesState: "Won" },
            { guid: "won-guid-2", name: "Order / EB", salesState: "Won" },
          ],
        },
        {
          path: "/v1/projects",
          query: { salesStatusTypeGuids: ["won-guid-1", "won-guid-2"] },
          response: projectsWonNb,
        },
      ],
    });
    const { text } = await callTool(
      "severa_list_projects",
      { isWon: true },
      [registerLookupTools],
    );
    expect(text).toMatch(/2 project\(s\)/);
    // Confirm the status-types endpoint was hit
    const statusCall = calls.find((c) => c.url.includes("/v1/salesstatustypes"));
    expect(statusCall).toBeTruthy();
    // And projects was called with the resolved Won GUIDs
    const projCall = calls.find((c) => c.url.includes("/v1/projects?"));
    expect(projCall?.url).toContain("salesStatusTypeGuids=won-guid-1");
    expect(projCall?.url).toContain("salesStatusTypeGuids=won-guid-2");
  });

  it("explicit salesStatusTypeGuids wins over isWon (no status-type lookup)", async () => {
    const { calls } = mockSeveraFetch({
      routes: [
        {
          path: "/v1/projects",
          query: { salesStatusTypeGuids: "39f9432a-a141-fcab-9142-8045bf8ed54a" },
          response: projectsWonNb,
        },
      ],
    });
    await callTool(
      "severa_list_projects",
      {
        isWon: true,
        salesStatusTypeGuids: ["39f9432a-a141-fcab-9142-8045bf8ed54a"],
      },
      [registerLookupTools],
    );
    // No status-types fetch when explicit GUIDs are supplied
    expect(calls.find((c) => c.url.includes("/v1/salesstatustypes"))).toBeUndefined();
  });
});

describe("tool registration", () => {
  it("advertises every lookup tool with a non-empty description", async () => {
    const tools = await listTools([registerLookupTools]);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "severa_find_customer",
      "severa_find_project",
      "severa_find_user",
      "severa_get_customer",
      "severa_get_project",
      "severa_list_customers",
      "severa_list_projects",
    ]);
    for (const t of tools) {
      expect(t.description, `tool ${t.name} has no description`).toBeTruthy();
      expect(t.description!.length).toBeGreaterThan(20);
    }
  });
});
