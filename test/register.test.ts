// Connect-time resilience: registerSeveraServer (shared by the worker's
// McpAgent.init and local.ts) must never throw on a Severa/KV failure —
// a throwing init fails the MCP connection on claude.ai and leaves the
// Durable Object with zero tools until evicted.
import { describe, it, expect, afterEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerSeveraServer } from "../src/mcp/register";
import { resolveCallerAuthz } from "../src/authz";
import { setLogSink } from "../src/log";
import { makeTestEnv, mockSeveraFetch, testProps } from "../src/test/harness";
import type { Env } from "../src/env";

const ROLE_ENV = {
  SEVERA_FULL_ACCESS_ROLES: "Pääkäyttäjä",
  SEVERA_BUSINESS_ONLY_ROLES: "Account Director",
  SEVERA_SELF_ONLY_ROLES: "Employee",
};

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  setLogSink((_level, line) => lines.push(JSON.parse(line)));
  return lines;
}

async function connect(env: Env) {
  const server = new McpServer({ name: "severa-mcp-test", version: "0.0.0" });
  await registerSeveraServer(server, env, testProps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function userRoute(profileName: string) {
  return {
    path: "/v1/users",
    response: [
      {
        guid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        email: testProps.email,
        permissionProfile: { guid: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", name: profileName },
      },
    ],
  };
}

afterEach(() => {
  setLogSink(() => {});
  vi.unstubAllGlobals();
});

describe("registerSeveraServer", () => {
  it("registers tools instead of throwing when the role lookup fails", async () => {
    const logs = captureLogs();
    mockSeveraFetch({ routes: [{ path: "/v1/users", status: 403, response: { message: "nope" } }] });
    const client = await connect(makeTestEnv(ROLE_ENV));

    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("severa_list_work_hours");
    expect(names).toContain("severa_query");
    expect(names).not.toContain("severa_access_denied");
    expect(logs).toContainEqual(
      expect.objectContaining({ event: "mcp.init", outcome: "fallback", severaStatus: 403 }),
    );
  });

  it("survives a network-level fetch failure during the role lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const client = await connect(makeTestEnv(ROLE_ENV));
    expect((await client.listTools()).tools.length).toBeGreaterThan(1);
  });

  it("keeps handlers fail-closed in a fallback session", async () => {
    const logs = captureLogs();
    mockSeveraFetch({ routes: [{ path: "/v1/users", status: 403, response: { message: "nope" } }] });
    const client = await connect(makeTestEnv(ROLE_ENV));

    const result = await client.callTool({ name: "severa_query", arguments: { path: "/v1/users" } });
    expect(result.isError).toBe(true);
    expect(logs).toContainEqual(
      expect.objectContaining({ event: "tool.call", tool: "severa_query", outcome: "error" }),
    );
  });

  it("still registers only the access-denied tool for an unlisted role", async () => {
    mockSeveraFetch({ routes: [userRoute("Intern")] });
    const client = await connect(makeTestEnv(ROLE_ENV));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(["severa_access_denied"]);
  });

  it("logs tool.call with outcome ok on success", async () => {
    const logs = captureLogs();
    mockSeveraFetch({ routes: [userRoute("Pääkäyttäjä")] });
    const client = await connect(makeTestEnv(ROLE_ENV));

    const result = await client.callTool({ name: "severa_query", arguments: { path: "/v1/users" } });
    expect(result.isError).toBeFalsy();
    expect(logs).toContainEqual(expect.objectContaining({ event: "mcp.init", outcome: "ok", tier: "full" }));
    expect(logs).toContainEqual(
      expect.objectContaining({ event: "tool.call", tool: "severa_query", outcome: "ok", user: testProps.email }),
    );
  });
});

describe("role cache", () => {
  it("serves repeat lookups from KV without calling Severa again", async () => {
    const { calls } = mockSeveraFetch({ routes: [userRoute("Pääkäyttäjä")] });
    const env = makeTestEnv(ROLE_ENV);
    await resolveCallerAuthz(env, testProps);
    await resolveCallerAuthz(env, testProps);
    expect(calls.filter((c) => c.url.includes("/v1/users"))).toHaveLength(1);
  });

  it("collapses concurrent cache-miss lookups into one Severa call", async () => {
    const { calls } = mockSeveraFetch({ routes: [userRoute("Pääkäyttäjä")] });
    const env = makeTestEnv(ROLE_ENV);
    await Promise.all([1, 2, 3].map(() => resolveCallerAuthz(env, testProps)));
    expect(calls.filter((c) => c.url.includes("/v1/users"))).toHaveLength(1);
  });
});
