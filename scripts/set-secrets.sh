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
echo "Note: role-derived permission scoping (src/authz.ts) is NOT set here —"
echo "SEVERA_FULL_ACCESS_ROLES / SEVERA_BUSINESS_ONLY_ROLES /"
echo "SEVERA_BUSINESS_ONLY_BLOCKED_TOOLS / SEVERA_SELF_ONLY_ROLES are plain"
echo "[vars] in wrangler.toml (not secrets — the role names aren't sensitive),"
echo "so edit them directly there instead."
echo
echo "Next: npm run deploy:${ENV_NAME}"
