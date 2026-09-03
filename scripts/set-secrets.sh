#!/usr/bin/env bash
# Walk through every secret the Worker needs for a given environment.
# Each `wrangler secret put` prompts interactively so nothing is echoed to
# disk or shell history.
#
# Usage:  bash scripts/set-secrets.sh staging
#         bash scripts/set-secrets.sh production

set -euo pipefail

ENV_NAME="${1:-}"
if [[ -z "$ENV_NAME" ]]; then
  echo "usage: $0 <staging|production>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SECRETS=(
  "SEVERA_CLIENT_ID:Severa REST API client_id (from Severa UI)"
  "SEVERA_CLIENT_SECRET:Severa REST API client_secret"
  "GOOGLE_OAUTH_CLIENT_ID:Google OAuth 2.0 Client ID (GCP → Credentials)"
  "GOOGLE_OAUTH_CLIENT_SECRET:Google OAuth 2.0 Client secret"
  "COOKIE_ENCRYPTION_KEY:32-byte hex (generate with: openssl rand -hex 32)"
)

echo "Setting secrets for --env ${ENV_NAME}. wrangler will prompt for each value."
echo

for entry in "${SECRETS[@]}"; do
  name="${entry%%:*}"
  hint="${entry#*:}"
  echo "→ ${name}"
  echo "    ${hint}"
  npx wrangler secret put "$name" --env "$ENV_NAME"
  echo
done

echo "All secrets set for --env ${ENV_NAME}."
echo

OPTIONAL_SECRETS=(
  "SEVERA_FULL_ACCESS_ROLES:Comma-separated Severa permissionProfile names that get full, unrestricted access (role-derived scoping — leave blank to skip)"
  "SEVERA_BUSINESS_ONLY_ROLES:Comma-separated profile names for the business-only tier (sees everyone, but a blocked-tools subset)"
  "SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS:Comma-separated tool-file basenames blocked for the business-only tier, e.g. travels,overtimes"
  "SEVERA_SELF_ONLY_ROLES:Comma-separated profile names for the self-only tier (every tool available, but scoped to the caller's own rows)"
)

echo "Optional: role-derived permission scoping (src/authz.ts). If you skip all"
echo "four, every caller keeps today's unrestricted access — this is safe to"
echo "leave blank for now and configure later."
echo
echo "IMPORTANT: for these four to survive a CI deploy (gh workflow run"
echo "deploy.yml), the SAME values must also be added as GitHub Environment"
echo "secrets (repo Settings → Environments → ${ENV_NAME}) — that workflow"
echo "re-applies them from there on every run, the same way it already does"
echo "for SEVERA_EMAIL_MAP. A value set only here, locally, won't be undone"
echo "by a later deploy, but it also won't be what a fresh CI deploy uses —"
echo "see LAUNCH.md's Day-2 operations section."
echo

for entry in "${OPTIONAL_SECRETS[@]}"; do
  name="${entry%%:*}"
  hint="${entry#*:}"
  echo "→ ${name} (optional)"
  echo "    ${hint}"
  read -r -p "  Set this now? [y/N] " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    npx wrangler secret put "$name" --env "$ENV_NAME"
  else
    echo "  Skipped."
  fi
  echo
done

echo "Done for --env ${ENV_NAME}."
echo "Next: npm run deploy:${ENV_NAME}"
