import { severaPaginate } from "./client";
import type { SeveraEnv } from "./client";
import type { Guid, UserOutputModel } from "./types";

// Backs role-derived permission scoping (src/authz.ts), which is resolved on
// every tool call — so this TTL sets both Severa load and how long a role
// change takes to apply. A 60s TTL hit Severa's rate limits; a day is fine
// because revoking access entirely happens upstream (the Google Workspace
// account is closed, so OAuth stops passing), not via the Severa role.
const CACHE_TTL_SECONDS = 24 * 60 * 60;

// Collapses concurrent cache-miss lookups for the same email within one
// isolate (e.g. parallel tool calls right after the cache entry expires).
const inFlight = new Map<string, Promise<CachedUser | null>>();

interface CachedUser {
  guid: Guid;
  role: string;
}

function resolveEmail(env: SeveraEnv, email: string): string {
  if (!env.SEVERA_EMAIL_MAP) return email;
  try {
    const map = JSON.parse(env.SEVERA_EMAIL_MAP) as Record<string, string>;
    return map[email.toLowerCase()] ?? email;
  } catch {
    return email;
  }
}

// Severa profile names follow a "Base Role - Team" convention (e.g.
// "Account Director - Kärsä"); strip the team-specific suffix so config only
// needs to list the base role once.
export function normalizeRoleName(name: string): string {
  return (name.split(" - ")[0] ?? name).trim();
}

async function resolveSeveraUser(env: SeveraEnv, email: string): Promise<CachedUser | null> {
  const key = cacheKey(email);
  const cached = await env.CACHE_KV.get(key, "json");
  if (cached) return cached as CachedUser;

  const pending = inFlight.get(key);
  if (pending) return pending;
  const lookup = fetchSeveraUser(env, email, key).finally(() => inFlight.delete(key));
  inFlight.set(key, lookup);
  return lookup;
}

async function fetchSeveraUser(
  env: SeveraEnv,
  email: string,
  key: string,
): Promise<CachedUser | null> {
  const severaEmail = resolveEmail(env, email);

  const users = await severaPaginate<UserOutputModel>(env, "/v1/users", {
    query: { email: severaEmail, rowCount: 25 },
  });
  const match = users.find((u) => u.email?.toLowerCase() === severaEmail.toLowerCase());
  if (!match) return null;

  const result: CachedUser = {
    guid: match.guid,
    role: match.permissionProfile?.name ? normalizeRoleName(match.permissionProfile.name) : "",
  };
  await env.CACHE_KV.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
  return result;
}

export async function resolveSeveraUserGuid(
  env: SeveraEnv,
  email: string,
): Promise<Guid | null> {
  const user = await resolveSeveraUser(env, email);
  return user?.guid ?? null;
}

export async function requireSeveraUserGuid(env: SeveraEnv, email: string): Promise<Guid> {
  const guid = await resolveSeveraUserGuid(env, email);
  if (!guid) {
    throw new Error(
      `No Severa user found for email ${email}. Ask an admin to add you to Severa or confirm the email on your user record.`,
    );
  }
  return guid;
}

export async function requireSeveraUserRole(
  env: SeveraEnv,
  email: string,
): Promise<{ guid: Guid; role: string }> {
  const user = await resolveSeveraUser(env, email);
  if (!user) {
    throw new Error(
      `No Severa user found for email ${email}. Ask an admin to add you to Severa or confirm the email on your user record.`,
    );
  }
  return user;
}

function cacheKey(email: string): string {
  return `severa:user:v2:${email.trim().toLowerCase()}`;
}
