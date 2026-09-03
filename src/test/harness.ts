// Test harness for MCP tool handlers.
//
// Provides:
// - makeMemoryKV(): in-memory KVNamespace stub
// - makeTestEnv(): a minimal Env suitable for tool handlers
// - mockSeveraFetch(routes): installs a global fetch that serves fixtures
//   keyed by request path (+ optional query predicate).
// - callTool(name, args, registerFn): spins up an McpServer, registers the
//   tool set, invokes one tool via the MCP client over InMemoryTransport,
//   and returns the text content of the first result block.
// - listTools(registerFn): returns the tool list as advertised to clients.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { vi } from "vitest";
import type { Env } from "../env";
import type { SessionProps } from "../auth/session";

export function makeMemoryKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true };
    },
  } as unknown as KVNamespace;
}

export function makeTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    CACHE_KV: makeMemoryKV(),
    OAUTH_KV: makeMemoryKV(),
    SEVERA_CLIENT_ID: "test-client-id",
    SEVERA_CLIENT_SECRET: "test-client-secret",
    SEVERA_ENV: "prod",
    SEVERA_API_BASE_STAG: "https://api.severa.stag.visma.com/rest-api",
    SEVERA_API_BASE_PROD: "https://api.severa.visma.com/rest-api",
    GOOGLE_OAUTH_CLIENT_ID: "test",
    GOOGLE_OAUTH_CLIENT_SECRET: "test",
    GOOGLE_HOSTED_DOMAIN: "genero.fi",
    COOKIE_ENCRYPTION_KEY: "00".repeat(32),
    ENABLE_WRITE_TOOLS: "false",
    ...overrides,
  } as unknown as Env;
}

export const testProps: SessionProps = {
  email: "test@genero.fi",
  name: "Test User",
  googleSub: "test-sub",
};

export interface Route {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  path: string; // exact pathname match on the Severa API (e.g. "/rest-api/v1/customers")
  // Optional query-param predicate; if provided, all listed params must match exactly.
  query?: Record<string, string | string[]>;
  status?: number;
  response: unknown;
}

export interface MockSeveraOpts {
  routes: Route[];
  // Optional token override. Defaults to a valid-for-1h stub.
  token?: string;
}

export function mockSeveraFetch(opts: MockSeveraOpts) {
  const { routes, token = "test-access-token" } = opts;
  const calls: { url: string; method: string; body?: unknown }[] = [];

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      url: url.toString(),
      method,
      body: init?.body ? tryParseJson(init.body) : undefined,
    });

    // OAuth token endpoint — always respond with a valid-for-1h token
    if (url.pathname.endsWith("/v1/token")) {
      return json(200, {
        access_token: token,
        access_token_type: "Bearer",
        access_token_expires_in: 3600,
      });
    }

    const match = routes.find(
      (r) =>
        url.pathname.endsWith(r.path) &&
        (r.method ?? "GET") === method &&
        queryMatches(url.searchParams, r.query),
    );
    if (!match) {
      throw new Error(
        `mockSeveraFetch: no route matched ${method} ${url.pathname}${url.search}. Registered routes: ${routes
          .map((r) => `${r.method ?? "GET"} ${r.path}${r.query ? " " + JSON.stringify(r.query) : ""}`)
          .join(", ")}`,
      );
    }
    return json(match.status ?? 200, match.response);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function queryMatches(
  actual: URLSearchParams,
  expected?: Record<string, string | string[]>,
): boolean {
  if (!expected) return true;
  for (const [k, v] of Object.entries(expected)) {
    const got = actual.getAll(k);
    const want = Array.isArray(v) ? v : [v];
    if (got.length !== want.length) return false;
    for (const w of want) {
      if (!got.includes(w)) return false;
    }
  }
  return true;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tryParseJson(body: BodyInit): unknown {
  try {
    if (typeof body === "string") return JSON.parse(body);
  } catch {
    /* ignore */
  }
  return body;
}

export type RegisterFn = (
  server: McpServer,
  env: Env,
  props: SessionProps,
) => void;

export interface McpTestHandle {
  client: Client;
  server: McpServer;
  env: Env;
  close: () => Promise<void>;
}

export async function withMcpServer(
  registerFns: RegisterFn[],
  opts: { env?: Env; props?: SessionProps } = {},
): Promise<McpTestHandle> {
  const env = opts.env ?? makeTestEnv();
  const props = opts.props ?? testProps;
  const server = new McpServer({ name: "severa-mcp-test", version: "0.0.0" });
  for (const fn of registerFns) fn(server, env, props);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  return {
    client,
    server,
    env,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  registerFns: RegisterFn[],
  opts: { env?: Env; props?: SessionProps } = {},
): Promise<{ text: string; raw: unknown }> {
  const handle = await withMcpServer(registerFns, opts);
  try {
    const result = await handle.client.callTool({ name, arguments: args });
    const blocks = (result.content ?? []) as Array<{ type: string; text?: string }>;
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
    return { text, raw: result };
  } finally {
    await handle.close();
  }
}

export interface ToolEntry {
  name: string;
  description?: string;
}

export async function listTools(
  registerFns: RegisterFn[],
  opts: { env?: Env; props?: SessionProps } = {},
): Promise<ToolEntry[]> {
  const handle = await withMcpServer(registerFns, opts);
  try {
    const res = await handle.client.listTools();
    return res.tools.map((t): ToolEntry => {
      const entry: ToolEntry = { name: t.name };
      if (t.description !== undefined) entry.description = t.description;
      return entry;
    });
  } finally {
    await handle.close();
  }
}
