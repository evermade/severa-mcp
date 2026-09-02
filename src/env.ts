import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  OAUTH_KV: KVNamespace;
  CACHE_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
  OAUTH_PROVIDER: OAuthHelpers;

  SEVERA_ENV: "stag" | "prod";
  SEVERA_EMAIL_MAP?: string;
  SEVERA_API_BASE_STAG: string;
  SEVERA_API_BASE_PROD: string;
  SEVERA_CLIENT_ID: string;
  SEVERA_CLIENT_SECRET: string;

  // Role-derived permission scoping (src/authz.ts). Comma-separated lists of
  // normalized Severa `permissionProfile.name` values (team-specific suffixes
  // like " - Kärsä" are stripped before matching, case-insensitive). If all
  // three role-list vars below are unset, the whole mechanism is a no-op —
  // every caller gets full, unrestricted access (today's behavior).
  SEVERA_FULL_ACCESS_ROLES?: string;
  SEVERA_BUSINESS_ONLY_ROLES?: string;
  SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS?: string;
  SEVERA_SELF_ONLY_ROLES?: string;

  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_HOSTED_DOMAIN: string;

  COOKIE_ENCRYPTION_KEY: string;

  ENABLE_WRITE_TOOLS: string;
}
