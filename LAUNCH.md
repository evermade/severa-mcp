# Launch runbook

End-to-end checklist to go from this repo → a live MCP connector in Claude Desktop / mobile.
CLI-first where possible; UI steps call out *exactly* which buttons to click.

**Legend**: 🖥️ = run in terminal · 🌐 = click in a web UI

Work through the two environments independently:
- **staging** → your sandbox; use Severa *stag* + a test GCP OAuth client
- **production** → real Severa tenant + hardened OAuth consent screen

The commands below default to `--env staging`. Swap for `production` once staging is green.

---

## 0. One-time local setup

🖥️ Install deps + log in to Cloudflare:

```bash
cd ~/Projects/Genero/severa-mcp
npm install
npx wrangler login          # opens a browser tab
```

Sanity-check the typecheck:

```bash
npm run typecheck
```

---

## 1. Create a Google OAuth 2.0 client  🌐

You need one per environment (staging + production), or one shared client with both redirect URIs — either works.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → pick or create a GCP project owned by `genero.fi`.
2. *APIs & Services* → *OAuth consent screen*:
   - User type: **Internal** (restricts to genero.fi Workspace accounts — no app verification, no DNS TXT, instant).
   - App name: `Severa MCP`. Support email: your genero.fi address.
   - Scopes: just the defaults (`openid`, `email`, `profile`). Save.
3. *APIs & Services* → *Credentials* → *Create credentials* → *OAuth client ID*:
   - Application type: **Web application**.
   - Name: `severa-mcp-staging` (or `-production`).
   - **Authorized redirect URIs** — add both:
     - `http://localhost:8787/callback`
     - `https://severa-mcp-staging.<your-cf-subdomain>.workers.dev/callback`
       *(you'll know the exact Worker domain after the first deploy; come back and add it. For now, localhost is enough to start.)*
   - Create → copy the **Client ID** and **Client secret** somewhere — you'll paste them in step 3.
4. If your Workspace admin has enabled *App Access Control* (Admin console → Security → API controls), they must mark this OAuth client as *Trusted*. If a user sees a "blocked by admin" page on first sign-in, that's the fix.

---

## 2. Create Severa REST API credentials  🌐

One per environment — **staging first** against the Severa *stag* tenant.

1. Open Severa (stag) → *Settings* → *Integrations* → *REST API* → *Create client credentials*.
2. Target system: `Severa MCP (staging)`. Purpose: `Internal Claude assistant`.
3. **Scopes** — read-only set (default deploy):
   - `customers:read`
   - `projects:read`  *(this covers phases, sales cases, and project forecasts)*
   - `users:read`
   - `hours:read`
   - `invoices:read`
   - `activities:read`
4. Optional — if you later want `severa_log_hours` working, add `hours:write` and flip `ENABLE_WRITE_TOOLS="true"` in `wrangler.toml` before re-deploying.
5. Save → copy the **client_id** and **client_secret**.

Repeat for the production tenant once staging works.

---

## 3. Bootstrap Cloudflare — KV namespaces  🖥️

Run the helper script; it creates all four namespaces and prints the `wrangler.toml` blocks to paste in.

```bash
bash scripts/bootstrap-kv.sh
```

Take the output and replace the `REPLACE_ME_…` placeholders in `wrangler.toml`:

- top-level `[kv_namespaces]` → one pair (used by `npx wrangler dev`)
- `[env.staging] kv_namespaces` → staging pair
- `[env.production] kv_namespaces` → production pair

(You can also do it manually with `npx wrangler kv namespace create OAUTH_KV --env staging`, etc. The script just chains the four calls.)

---

## 4. Set secrets  🖥️

Run the helper — prompts for each value in sequence:

```bash
bash scripts/set-secrets.sh staging
# and later, for prod:
bash scripts/set-secrets.sh production
```

What it asks for:

| Secret                          | From where                                    |
|---------------------------------|-----------------------------------------------|
| `SEVERA_CLIENT_ID`              | Severa UI (step 2)                            |
| `SEVERA_CLIENT_SECRET`          | Severa UI (step 2)                            |
| `GOOGLE_OAUTH_CLIENT_ID`        | GCP Credentials page (step 1)                 |
| `GOOGLE_OAUTH_CLIENT_SECRET`    | GCP Credentials page (step 1)                 |
| `COOKIE_ENCRYPTION_KEY`         | `openssl rand -hex 32` (generate fresh) |

For local dev (`wrangler dev`), put the same values in `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars with the same values as above
```

---

## 5. Deploy  🖥️

```bash
npm run deploy:staging
```

wrangler prints the Worker URL (e.g. `https://severa-mcp-staging.<your-cf-subdomain>.workers.dev`). **Copy it.**

🌐 Go back to step 1 → add `https://<that-url>/callback` to the Google OAuth client's *Authorized redirect URIs*. Save.

---

## 6. Smoke-test with MCP Inspector  🖥️

```bash
npx @modelcontextprotocol/inspector https://severa-mcp-staging.<your-cf-subdomain>.workers.dev/sse
```

It opens a browser tab:
1. Click *Connect* → you'll be bounced to Google sign-in.
2. Sign in with your `@genero.fi` account.
3. Tool list should load. Try:
   - `severa_find_customer` with `{ "text": "Genero" }` (or whatever is in your stag tenant)
   - `severa_list_my_cases` (no args — uses your email)
   - `severa_pipeline_summary` with `{ "onlyMine": true }`

Tail logs in a separate terminal while testing:

```bash
npx wrangler tail --env staging
```

If something's wrong, you'll see the exact `fetch` error + which Severa endpoint blew up.

---

## 7. Connect Claude Desktop  🌐

1. Claude Desktop → *Settings* → *Connectors* → *Add custom connector*.
2. Name: `Severa`. URL: `https://severa-mcp-staging.<your-cf-subdomain>.workers.dev/sse`.
3. Click *Connect* → same Google sign-in → ✅.
4. In a new chat, try *"What's my sales pipeline grouped by stage?"* — Claude should call `severa_pipeline_summary`.

---

## 8. Connect Claude mobile (iOS / Android)  🌐

Exact same URL. *Settings* → *Connectors* → *Add custom connector* → paste → Google sign-in. Mobile works because the Worker speaks OAuth 2.1; no relay needed.

---

## 9. (Optional) Custom domain  🖥️🌐

Once staging is solid:

1. 🌐 Cloudflare dashboard → your zone `genero.fi` → *Workers Routes* or *Custom Domains* → add `severa-mcp.genero.fi` → Worker `severa-mcp-staging` (or `severa-mcp` for prod).
2. 🌐 GCP OAuth client → add `https://severa-mcp.genero.fi/callback` to redirect URIs.
3. 🖥️ Update README / Claude connector URLs to the pretty domain.

---

## 10. Production cut-over

1. Repeat steps 1–4 with `--env production`, prod Severa creds, prod GCP OAuth client.
2. `npm run deploy:production`.
3. Add the production Worker domain to the GCP client's redirect URIs.
4. Share the connector URL with the team.

---

## Day-2 operations

**Rotate Severa creds**

```bash
npx wrangler secret put SEVERA_CLIENT_ID --env production
npx wrangler secret put SEVERA_CLIENT_SECRET --env production
# Drop the cached bearer:
npx wrangler kv key delete --binding CACHE_KV "severa:token" --env production
```

**Enable hour-logging**

1. Add `hours:write` scope to the Severa client credential.
2. Edit `wrangler.toml` → `[env.production.vars] ENABLE_WRITE_TOOLS = "true"`.
3. `npm run deploy:production`. `severa_log_hours` becomes visible; read-only tools unchanged.

**Role-derived permission scoping** (`src/authz.ts`) — `SEVERA_FULL_ACCESS_ROLES` / `SEVERA_BUSINESS_ONLY_ROLES` / `SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS` / `SEVERA_SELF_ONLY_ROLES` are plain `[vars]` in `wrangler.toml` (base, `env.staging.vars`, and `env.production.vars`), not secrets — the role names aren't sensitive, so they're checked into git like `GOOGLE_HOSTED_DOMAIN` or `ENABLE_WRITE_TOOLS` and get set from source on every deploy. To change a role tier, edit `wrangler.toml` directly and redeploy.

If any of the four were previously set via a one-off `wrangler secret put` (from before this was a plain var), delete that secret first — Cloudflare rejects a deploy where a `[vars]` name collides with an existing secret of the same name:

```bash
npx wrangler secret delete SEVERA_FULL_ACCESS_ROLES --env staging
npx wrangler secret delete SEVERA_BUSINESS_ONLY_ROLES --env staging
npx wrangler secret delete SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS --env staging
npx wrangler secret delete SEVERA_SELF_ONLY_ROLES --env staging
# repeat with --env production
```

**Clear reference cache** (after Severa data reshape / bad response cached):

```bash
npx wrangler kv key list --binding CACHE_KV --env production --prefix "severa:ref:"
# then delete each key, or just wait 15 min for TTL
```

**Watch logs**

```bash
npx wrangler tail --env production --format pretty
```
