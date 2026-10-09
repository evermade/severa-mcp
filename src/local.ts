// Local stdio MCP server — no Cloudflare required.
// Usage: npm run local
// Requires SEVERA_CLIENT_ID, SEVERA_CLIENT_SECRET, SEVERA_USER_EMAIL in .dev.vars

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerSeveraServer } from "./mcp/register.js";
import { setLogSink } from "./log.js";
import type { Env } from "./env.js";
import type { SessionProps } from "./auth/session.js";

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

function makeMemoryKV() {
  const store = new Map<string, { value: string; expires?: number }>();
  return {
    async get(key: string, type?: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expires && Date.now() > entry.expires) {
        store.delete(key);
        return null;
      }
      return type === "json" ? JSON.parse(entry.value) : entry.value;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      const entry: { value: string; expires?: number } = { value };
      if (opts?.expirationTtl) entry.expires = Date.now() + opts.expirationTtl * 1000;
      store.set(key, entry);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

// stdout is the MCP transport here — keep structured logs on stderr.
setLogSink((_level, line) => process.stderr.write(line + "\n"));

const vars = { ...loadDevVars(), ...process.env };

const email = vars.SEVERA_USER_EMAIL;
if (!email) {
  process.stderr.write("Error: SEVERA_USER_EMAIL is required in .dev.vars for local mode\n");
  process.exit(1);
}

const kv = makeMemoryKV() as unknown as KVNamespace;

const env = {
  CACHE_KV: kv,
  OAUTH_KV: kv,
  SEVERA_CLIENT_ID: vars.SEVERA_CLIENT_ID ?? "",
  SEVERA_CLIENT_SECRET: vars.SEVERA_CLIENT_SECRET ?? "",
  SEVERA_ENV: (vars.SEVERA_ENV ?? "prod") as "stag" | "prod",
  SEVERA_API_BASE_STAG:
    vars.SEVERA_API_BASE_STAG ?? "https://api.severa.stag.visma.com/rest-api",
  SEVERA_API_BASE_PROD: vars.SEVERA_API_BASE_PROD ?? "https://api.severa.visma.com/rest-api",
  SEVERA_EMAIL_MAP: vars.SEVERA_EMAIL_MAP ?? "",
  SEVERA_FULL_ACCESS_ROLES: vars.SEVERA_FULL_ACCESS_ROLES ?? "",
  SEVERA_BUSINESS_ONLY_ROLES: vars.SEVERA_BUSINESS_ONLY_ROLES ?? "",
  SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS: vars.SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS ?? "",
  SEVERA_SELF_ONLY_ROLES: vars.SEVERA_SELF_ONLY_ROLES ?? "",
  ENABLE_WRITE_TOOLS: vars.ENABLE_WRITE_TOOLS ?? "false",
  GOOGLE_OAUTH_CLIENT_ID: "",
  GOOGLE_OAUTH_CLIENT_SECRET: "",
  GOOGLE_HOSTED_DOMAIN: "",
  COOKIE_ENCRYPTION_KEY: "",
} as unknown as Env;

const props: SessionProps = {
  email,
  name: email.split("@")[0] ?? email,
  googleSub: "local",
};

const server = new McpServer({ name: "severa-mcp", version: "0.1.0" });

await registerSeveraServer(server, env, props);

const transport = new StdioServerTransport();
await server.connect(transport);
