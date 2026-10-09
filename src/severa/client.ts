import {
  clearStoredToken,
  getAccessToken,
  severaBaseUrl,
  type TokenManagerEnv,
} from "./token-manager";
import { acquireRateLimit } from "./rate-limit";
import type { SeveraError } from "./types";
import { log } from "../log";

const MAX_RETRIES = 4;
const SLOW_REQUEST_MS = 5000;

export type SeveraEnv = TokenManagerEnv;

type QueryValue = string | number | boolean | null | undefined | string[];

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface SeveraResponse<T> {
  data: T;
  nextPageToken: string | null;
}

export async function severaFetch<T>(
  env: SeveraEnv,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { data } = await severaFetchRaw<T>(env, path, opts);
  return data;
}

export async function severaFetchRaw<T>(
  env: SeveraEnv,
  path: string,
  opts: RequestOptions = {},
): Promise<SeveraResponse<T>> {
  const url = buildUrl(severaBaseUrl(env), path, opts.query);
  const method = opts.method ?? "GET";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await acquireRateLimit();
    const token = await getAccessToken(env);
    const started = Date.now();
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...opts.headers,
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });

    const durationMs = Date.now() - started;
    // Only anomalies are logged — successful requests are covered by the
    // per-tool `tool.call` line and would just add volume.
    const logRequest = (outcome: string, extra: Record<string, unknown> = {}) =>
      log(
        "severa.request",
        { method, path, status: res.status, attempt, outcome, durationMs, ...extra },
        outcome === "failed" ? "error" : "warn",
      );

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt === MAX_RETRIES) {
        logRequest("failed");
        throw await toError(res, url);
      }
      const retryAfterMs = parseRetryAfter(res) ?? 2 ** attempt * 250;
      logRequest("retry", { retryAfterMs });
      await sleep(retryAfterMs);
      continue;
    }

    if (res.status === 401 && attempt === 0) {
      logRequest("token_cleared");
      await clearStoredToken(env);
      continue;
    }

    if (!res.ok) {
      logRequest("failed");
      throw await toError(res, url);
    }
    if (durationMs > SLOW_REQUEST_MS) logRequest("slow");
    const nextPageToken = res.headers.get("NextPageToken") ?? null;
    if (res.status === 204) return { data: undefined as unknown as T, nextPageToken };
    const data = (await res.json()) as T;
    return { data, nextPageToken };
  }

  throw new Error(`severaFetch exhausted retries: ${method} ${url}`);
}

export async function severaPaginate<T>(
  env: SeveraEnv,
  path: string,
  opts: RequestOptions = {},
  maxItems = 2000,
): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | null = null;
  do {
    const query: RequestOptions["query"] = {
      ...opts.query,
      ...(pageToken ? { pageToken } : {}),
    };
    const page: SeveraResponse<T[]> = await severaFetchRaw<T[]>(env, path, {
      ...opts,
      query,
    });
    const { data, nextPageToken } = page;
    if (!Array.isArray(data)) break;
    items.push(...data);
    pageToken = nextPageToken;
    if (items.length >= maxItems) break;
  } while (pageToken);
  return items.slice(0, maxItems);
}

function buildUrl(base: string, path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(path.startsWith("/") ? `${base}${path}` : `${base}/${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, item);
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

function parseRetryAfter(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const seconds = Number(h);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

async function toError(res: Response, url: string): Promise<Error> {
  let detail: SeveraError | string | undefined;
  try {
    detail = (await res.json()) as SeveraError;
  } catch {
    detail = await res.text().catch(() => undefined);
  }
  const msg =
    typeof detail === "object" && detail !== null && "message" in detail
      ? detail.message
      : typeof detail === "string"
        ? detail
        : "<no body>";
  const err = new Error(`Severa ${res.status} ${url}: ${msg}`);
  (err as { status?: number }).status = res.status;
  return err;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
