import type {
  OAuthHelpers,
  AuthRequest,
} from "@cloudflare/workers-oauth-provider";
import type { SessionProps } from "./session";
import { encryptCookie, decryptCookie } from "./cookie-crypto";
import { log } from "../log";

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const OAUTH_REQ_COOKIE = "severa_mcp_oauth_req";

export interface GoogleEnv {
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_HOSTED_DOMAIN: string;
  COOKIE_ENCRYPTION_KEY: string;
  OAUTH_PROVIDER: OAuthHelpers;
}

export async function handleOAuthRequest(request: Request, env: GoogleEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/authorize") return startAuthorize(request, env);
  if (url.pathname === "/callback") return handleCallback(request, env);
  if (url.pathname === "/" || url.pathname === "/healthz") {
    return new Response("severa-mcp OK", { headers: { "content-type": "text/plain" } });
  }
  return new Response("Not Found", { status: 404 });
}

async function startAuthorize(request: Request, env: GoogleEnv): Promise<Response> {
  const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);

  // H2: only allow HTTPS origins to prevent open-redirect via Host spoofing
  const origin = new URL(request.url).origin;
  if (!origin.startsWith("https://")) {
    return new Response("HTTPS required", { status: 400 });
  }
  const redirectUri = `${origin}/callback`;

  const state = crypto.randomUUID();

  // C1: encrypt cookie payload instead of plain Base64
  const cookiePayload = await encryptCookie(
    JSON.stringify({ state, oauthReq }),
    env.COOKIE_ENCRYPTION_KEY,
  );

  const googleUrl = new URL(GOOGLE_AUTHORIZE);
  googleUrl.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID);
  googleUrl.searchParams.set("redirect_uri", redirectUri);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("access_type", "online");
  googleUrl.searchParams.set("prompt", "select_account");
  googleUrl.searchParams.set("hd", env.GOOGLE_HOSTED_DOMAIN);
  googleUrl.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      location: googleUrl.toString(),
      "set-cookie": cookie(OAUTH_REQ_COOKIE, cookiePayload),
    },
  });
}

async function handleCallback(request: Request, env: GoogleEnv): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return new Response("Missing code/state", { status: 400 });

  const stored = readCookie(request, OAUTH_REQ_COOKIE);
  if (!stored) {
    log("oauth.callback", { outcome: "state_cookie_missing" }, "warn");
    return new Response("OAuth state missing; please retry.", { status: 400 });
  }

  // C1: decrypt cookie
  const decrypted = await decryptCookie(stored, env.COOKIE_ENCRYPTION_KEY);
  if (!decrypted) return new Response("OAuth state corrupted.", { status: 400 });

  let parsed: { state: string; oauthReq: AuthRequest };
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    return new Response("OAuth state corrupted.", { status: 400 });
  }
  if (parsed.state !== state) return new Response("State mismatch.", { status: 400 });

  // H2: same HTTPS-only redirect URI construction as in startAuthorize
  const origin = new URL(request.url).origin;
  if (!origin.startsWith("https://")) {
    return new Response("HTTPS required", { status: 400 });
  }
  const redirectUri = `${origin}/callback`;

  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    // C2: log full error server-side, return generic message to client
    log(
      "oauth.callback",
      { outcome: "google_token_failed", status: tokenRes.status, body: await tokenRes.text() },
      "error",
    );
    return new Response("Authentication failed. Please retry.", { status: 502 });
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const uiRes = await fetch(GOOGLE_USERINFO, {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!uiRes.ok) {
    log("oauth.callback", { outcome: "google_userinfo_failed", status: uiRes.status }, "error");
    return new Response("Authentication failed. Please retry.", { status: 502 });
  }
  const info = (await uiRes.json()) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    hd?: string;
    name?: string;
  };

  if (
    !info.email ||
    !info.email_verified ||
    info.hd !== env.GOOGLE_HOSTED_DOMAIN ||
    !info.email.toLowerCase().endsWith(`@${env.GOOGLE_HOSTED_DOMAIN.toLowerCase()}`)
  ) {
    // H1: generic message — don't confirm which email was attempted
    log("oauth.callback", { outcome: "domain_rejected", user: info.email, hd: info.hd }, "warn");
    return new Response(
      `Access restricted to @${env.GOOGLE_HOSTED_DOMAIN} accounts.`,
      { status: 403 },
    );
  }

  const props: SessionProps = {
    email: info.email.toLowerCase(),
    name: info.name ?? info.email,
    googleSub: info.sub,
  };

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: parsed.oauthReq,
    userId: info.sub,
    metadata: { email: props.email, name: props.name },
    scope: parsed.oauthReq.scope,
    props,
  });

  log("oauth.callback", { outcome: "ok", user: props.email });
  return new Response(null, {
    status: 302,
    headers: {
      location: redirectTo,
      "set-cookie": clearCookie(OAUTH_REQ_COOKIE),
    },
  });
}

function cookie(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1800`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}
