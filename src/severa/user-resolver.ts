import { severaPaginate } from "./client";
import type { SeveraEnv } from "./client";
import type { Guid, UserOutputModel } from "./types";

const CACHE_TTL_SECONDS = 24 * 60 * 60;

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
  const severaEmail = resolveEmail(env, email);
  const key = cacheKey(email);
  const cached = await env.CACHE_KV.get(key, "json");
  if (cached) return cached as CachedUser;

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
