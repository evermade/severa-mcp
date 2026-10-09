import type { OAuthTokenResponse } from "./types";
import { log, errorMessage } from "../log";

const EXPIRY_BUFFER_SECONDS = 300;
const TOKEN_PATH = "/v1/token";

async function kvKey(env: TokenManagerEnv): Promise<string> {
  const scopes = requestedScopes(env);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scopes));
  const hex = Array.from(new Uint8Array(buf).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `severa:token:${hex}`;
}

export async function clearStoredToken(env: TokenManagerEnv): Promise<void> {
  await env.CACHE_KV.delete(await kvKey(env));
}

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface TokenManagerEnv {
  CACHE_KV: KVNamespace;
  SEVERA_CLIENT_ID: string;
  SEVERA_CLIENT_SECRET: string;
  SEVERA_API_BASE_STAG: string;
  SEVERA_API_BASE_PROD: string;
  SEVERA_ENV: "stag" | "prod";
  ENABLE_WRITE_TOOLS?: string;
  SEVERA_EMAIL_MAP?: string;
}

export function severaBaseUrl(env: TokenManagerEnv): string {
  return env.SEVERA_ENV === "prod" ? env.SEVERA_API_BASE_PROD : env.SEVERA_API_BASE_STAG;
}

const READ_SCOPES = [
  "customers:read",
  "projects:read",
  "users:read",
  "hours:read",
  "invoices:read",
  "activities:read",
  "settings:read",
  "fees:read",
  "travels:read",
  "resourceallocations:read",
  "organization:read",
  "files:read",
];

const WRITE_SCOPES = ["hours:write", "projects:write"];

export function requestedScopes(env: TokenManagerEnv): string {
  const writeEnabled = env.ENABLE_WRITE_TOOLS === "true";
  return [...READ_SCOPES, ...(writeEnabled ? WRITE_SCOPES : [])].join(" ");
}

let inFlight: Promise<string> | null = null;

export async function getAccessToken(env: TokenManagerEnv): Promise<string> {
  const key = await kvKey(env);
  const cached = await readStored(env.CACHE_KV, key);
  if (cached && cached.expiresAt - EXPIRY_BUFFER_SECONDS > nowSeconds()) {
    return cached.accessToken;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const started = Date.now();
      let grant = cached?.refreshToken ? "refresh" : "issue";
      let fresh: StoredToken;
      try {
        fresh = cached?.refreshToken
          ? await refreshToken(env, cached.refreshToken).catch((err) => {
              log("severa.token", { grant: "refresh", outcome: "failed", error: errorMessage(err) }, "warn");
              grant = "issue";
              return issueToken(env);
            })
          : await issueToken(env);
      } catch (err) {
        log("severa.token", { grant, outcome: "failed", error: errorMessage(err) }, "error");
        throw err;
      }
      // Frequent `issue` events across isolates point at KV propagation lag
      // (each colo minting its own token) — worth watching.
      log("severa.token", { grant, outcome: "ok", durationMs: Date.now() - started });
      await writeStored(env.CACHE_KV, key, fresh);
      return fresh.accessToken;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function issueToken(env: TokenManagerEnv): Promise<StoredToken> {
  const res = await fetch(`${severaBaseUrl(env)}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_Id: env.SEVERA_CLIENT_ID,
      client_Secret: env.SEVERA_CLIENT_SECRET,
      scope: requestedScopes(env),
    }),
  });
  if (!res.ok) throw new Error(`Severa token request failed ${res.status}: ${await safeText(res)}`);
  const body = (await res.json()) as OAuthTokenResponse;
  return toStored(body);
}

async function refreshToken(env: TokenManagerEnv, refresh: string): Promise<StoredToken> {
  const res = await fetch(`${severaBaseUrl(env)}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_Id: env.SEVERA_CLIENT_ID,
      client_Secret: env.SEVERA_CLIENT_SECRET,
      refresh_token: refresh,
    }),
  });
  if (!res.ok) throw new Error(`Severa token refresh failed ${res.status}`);
  const body = (await res.json()) as OAuthTokenResponse;
  return toStored(body);
}

function toStored(body: OAuthTokenResponse): StoredToken {
  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    expiresAt: nowSeconds() + body.access_token_expires_in,
  };
}

async function readStored(kv: KVNamespace, key: string): Promise<StoredToken | null> {
  return (await kv.get(key, "json")) as StoredToken | null;
}

async function writeStored(
  kv: KVNamespace,
  key: string,
  token: StoredToken,
): Promise<void> {
  await kv.put(key, JSON.stringify(token), {
    expirationTtl: Math.max(60, token.expiresAt - nowSeconds() + 60),
  });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
