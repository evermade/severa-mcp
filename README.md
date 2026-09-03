# severa-mcp

Remote MCP server that wraps the [Severa REST API](https://api.severa.visma.com/rest-api/doc/index.html) so Genero staff can query the PSA from **Claude Desktop / mobile / gds-assistant**. Runs on Cloudflare Workers with OAuth 2.1 fronted by Google Workspace SSO.

## Tool surface

All tools carry MCP tool annotations. **Writes are disabled by default** (`ENABLE_WRITE_TOOLS="false"`) — only the read-only set is registered, and the OAuth token the Worker requests from Severa has read-only scopes only. Flip `ENABLE_WRITE_TOOLS="true"` to register the write tools and request write scopes during OAuth.

Before flipping the flag, a Genero admin must grant the corresponding scopes on the Severa API client — the code is ready; the scopes are not:
- `hours:write` — enables `severa_log_hours`, `severa_update_hours`, `severa_delete_hours`, `severa_close_workday`
- `projects:write` — enables `severa_create_project`, `severa_update_project` (both also work for sales cases, since a sales case is just a project with `salesStatus`)

If only a subset of scopes is granted, Severa will either refuse the token or issue a partial token; tools whose scope is missing will 403 at call time.

**Read-only (always on)**
- `severa_find_customer`, `severa_find_project`, `severa_find_user`, `severa_get_project`, `severa_get_customer`
- `severa_find_case`, `severa_get_case`, `severa_list_my_cases`, `severa_pipeline_summary`
- `severa_get_billing_forecast`, `severa_projects_missing_billing_forecast`, `severa_cases_missing_billing_forecast`
- `severa_get_my_hours`, `severa_get_unbilled_hours`

**Mutable (gated behind `ENABLE_WRITE_TOOLS=true`)**
- Hours: `severa_log_hours`, `severa_update_hours`, `severa_delete_hours`, `severa_close_workday`
- Projects / sales cases: `severa_create_project`, `severa_update_project`

All "my" queries resolve the authenticated email → Severa user GUID automatically; callers do not pass user IDs.

In Severa's data model, a "sales case" is a project with an open sales status (same entity, different lifecycle phase). `severa_find_case` / `severa_get_case` / `severa_list_my_cases` all hit `/v1/salescases`, returning projects with `probability`, `expectedValue`, `salesStatus`, `salesPerson` populated.

## Architecture

```
Claude Desktop/Mobile ──(remote MCP + OAuth 2.1)──┐
gds-assistant (McpToolProvider, bearer) ──────────┤
                                                  ▼
          ┌──────────── severa-mcp Worker ────────────┐
          │  OAuth AS (Google IDP, hd=genero.fi)      │
          │  MCP server over SSE/streamable HTTP      │
          │  Severa client + client_credentials token │
          │  KV: sessions, user→GUID, reference data  │
          └────────────────────┬──────────────────────┘
                               │ Bearer (app-level)
                               ▼
              api.severa.visma.com/rest-api/v1.0
```

## Prerequisites

1. **Severa REST API credentials** — in Severa: *Settings → Integrations → REST API → Create client credentials*.
   - Read-only (default deploy):
     ```
     customers:read projects:read users:read hours:read invoices:read activities:read
     ```
     `projects:read` covers phases, sales cases, and project forecasts (they are all under the projects scope in Severa).
   - If you want to enable `severa_log_hours`, additionally grant `hours:write` and set `ENABLE_WRITE_TOOLS="true"` in `wrangler.toml`.
   - Create one set for `stag` (dev) and one for `prod`.

2. **Google OAuth 2.0 client** — in GCP console for `genero.fi` workspace:
   - Authorized redirect URI: `https://<your-worker-domain>/callback`
   - Also add `http://localhost:8787/callback` for local dev.

3. **Cloudflare account** with `wrangler` logged in.

## Local dev

```bash
npm install
cp .dev.vars.example .dev.vars
# fill in SEVERA_CLIENT_ID / SECRET (stag), GOOGLE_OAUTH_CLIENT_ID / SECRET,
# and generate COOKIE_ENCRYPTION_KEY via `openssl rand -hex 32`

npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create CACHE_KV
# paste the returned IDs into wrangler.toml

npm run dev        # wrangler dev on http://localhost:8787
```

Test directly with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector http://localhost:8787/sse
```

It'll open a browser, send you through the Google sign-in, and then let you call every tool from a UI.

## Tests

Three layers — **run all three before claiming a non-trivial fix works**. Unit tests have previously passed on behaviour that diverged from the real API; the deeper layers exist because of those misses.

```bash
npm test                  # unit + schema, mocked fetch, ~5s
npm run test:integration  # real Severa API + real stdio MCP, ~10s, needs .dev.vars
./eval/run.sh             # Claude Code runs prompts against the stdio server (LLM-in-the-loop)
```

- **Unit / schema** (`npm test`) — tool handlers, pagination, null-tolerance (`test/null-tolerance.test.ts`), MCP registration (`test/mcp-registration.test.ts`), and JSON-Schema `$ref` avoidance (`test/schema-no-refs.test.ts` — claude.ai's client silently drops values on `$ref`-unions).
- **Integration / e2e** (`npm run test:integration`) — spawns `src/local.ts` under a real stdio MCP client, runs live queries against Severa; auto-skips if `.dev.vars` lacks `SEVERA_CLIENT_ID`. Catches OAuth scope gaps, query-param drift, registration differences between worker and stdio entry points.
- **LLM eval** (`./eval/run.sh`) — runs prompts through `claude -p` against the stdio MCP server and asserts at least one expected tool got invoked. Catches vague tool descriptions, Claude picking the wrong tool, or schema shapes that the real claude.ai transport mishandles. Filter by case name: `./eval/run.sh pipeline`. Ad-hoc: `PROMPT="..." EXPECT="severa_*" ./eval/run.sh -`. Requires an active Claude Code login.
- **For schema / transport changes specifically**: after deploy, verify on claude.ai too — its MCP client has historically handled JSON-Schema shapes differently from the SDK's `InMemoryTransport` (that's the bug `schema-no-refs.test.ts` guards against).

## Deploy

```bash
# staging
npx wrangler kv namespace create OAUTH_KV --env staging
npx wrangler kv namespace create CACHE_KV --env staging
npx wrangler secret put SEVERA_CLIENT_ID --env staging
npx wrangler secret put SEVERA_CLIENT_SECRET --env staging
npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --env staging
npx wrangler secret put COOKIE_ENCRYPTION_KEY --env staging
npm run deploy:staging

# production — repeat with --env production and prod Severa creds
npm run deploy:production
```

## Adding as a Claude connector

**Claude Desktop / Claude mobile** → Settings → Connectors → *Add custom connector* → paste:

```
https://severa-mcp.<your-cloudflare-subdomain>.workers.dev/sse
```

Claude runs you through the OAuth flow (Google sign-in, genero.fi gate) and stores the tokens.

## Wiring from gds-assistant

Register the deployed URL via the WP filter:

```php
add_filter('gds-assistant/mcp_servers', function ($servers) {
    $servers['severa'] = [
        'url' => 'https://severa-mcp.genero.fi/sse',
        'auth' => ['type' => 'oauth'], // or bearer token if you provision one
    ];
    return $servers;
});
```

Tools appear as `mcp_severa__*` in the assistant UI.

## Auth flow in one picture

```
Claude  ──── GET /sse (no token) ──────►  Worker  ──── 401 + OAuth metadata ───►  Claude
Claude  ──── GET /authorize ───────────►  Worker  ──── 302 to accounts.google ──►  Browser
Browser ──── Google sign-in ───────────►  Google  ──── 302 back to /callback ───►  Worker
Worker  ──── verify hd=genero.fi,  ────►  OAuthProvider.completeAuthorization
             email_verified=true
Worker  ──── 302 to redirect_uri ──────►  Claude   (exchanges code for Worker tokens)
Claude  ──── GET /sse + Bearer ────────►  Worker  ──── serves MCP ─────────────►
```

Multi-user by construction: every user does their own OAuth dance, and each session record in KV carries their `{ email, googleSub }`. Severa data itself is fetched with one shared `client_credentials` token, not a per-user one — Severa's own per-user permission model doesn't apply to what a given caller can see through this MCP by default.

**Role-derived permission scoping** (`src/authz.ts`, opt-in via env vars — see `wrangler.toml`'s comment block) closes that gap without per-user Severa OAuth: on each connection, the caller's email is resolved to their real Severa user record, and their `permissionProfile.name` (team-specific suffixes like " - Kärsä" stripped) is matched against three configurable role lists:
- `SEVERA_FULL_ACCESS_ROLES` — sees every tool and everyone's data, including the raw `severa_query` escape hatch.
- `SEVERA_BUSINESS_ONLY_ROLES` — sees everyone's data, but entire tool categories (`SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS`) aren't registered at all — no `severa_query` either.
- `SEVERA_SELF_ONLY_ROLES` — every tool is registered, but personal-data tools (hours, activities, resource allocations, workdays) only ever return the caller's own rows.

A role matching none of the three is rejected outright. If all three env vars are unset, the mechanism is a complete no-op — every caller gets today's unrestricted access, so this is safe to leave off until configured. Project/customer/invoice/CRM data is always broadly visible regardless of tier — only personal/employment-relationship data (e.g. `currentWorkContractTitle` on phase members) is gated, and that gate is independent of a tier's general row-visibility (a business-only caller sees everyone's phase roster for resourcing, but never anyone else's contract title).

## Status / known TODOs

- **Endpoints verified against the real OpenAPI spec** (`/psapublicrest/openapidocs/v1.0/doc.json`). `projectforecasts`, `salescases`, `/v1/users/{guid}/workhours`, `/v1/projects/{guid}/workhours`, `workType` on POST, `NextPageToken` response header — all matching current code.
- **Custom domain**: deploy under `severa-mcp.genero.fi` once staging passes.
