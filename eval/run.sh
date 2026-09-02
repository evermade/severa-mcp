#!/usr/bin/env bash
# LLM-in-the-loop eval — run a prompt through Claude Code against the
# local stdio MCP server, print which tools got called, and assert the
# expected ones appeared.
#
# Catches the class of bugs unit + integration tests can't:
# - Does Claude pick the right tool given the prompt?
# - Does it pass sensible args (dates, GUIDs it just discovered)?
# - Does the final response surface the data that actually matters?
#
# Requires: claude CLI, jq, a valid .dev.vars (for the stdio server's
# Severa credentials), and an active Claude Code login.
#
# Usage:
#   ./eval/run.sh                      # run all cases
#   ./eval/run.sh "pipeline"           # run cases whose name matches
#   PROMPT="..." EXPECT="tool1,tool2" ./eval/run.sh -        # ad-hoc one-off
#
# Testing role-derived permission scoping (src/authz.ts): the stdio server's
# identity/role for a run is fixed by .dev.vars' SEVERA_USER_EMAIL plus
# whatever SEVERA_*_ROLES vars are set (see wrangler.toml's comment block).
# This harness only asserts "an expected tool was called" (loose, by
# design) — it can't assert a tool is *absent*, so verifying the
# business-only/self-only tiers actually withhold tools (e.g. no
# severa_query, no travel/overtime tools for a business-only test user) is
# a manual check: point SEVERA_USER_EMAIL at a real user in the tier you
# want to exercise, set the matching SEVERA_*_ROLES vars, run a case like
# "colleague_hours" below, and inspect the full tool list Claude was
# offered (visible in --verbose output) rather than just the pass/fail line.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v claude >/dev/null; then
  echo "claude CLI not found — install Claude Code first" >&2
  exit 1
fi
if [ ! -f .dev.vars ]; then
  echo ".dev.vars missing — needed for the stdio server's Severa credentials" >&2
  exit 1
fi

# Cases: NAME | PROMPT | EXPECTED_TOOLS (comma-separated, any-of)
# The assertion is "at least one expected tool was called". Loose on
# purpose — the point is to catch *no-op runs* and tool-selection
# regressions, not to pin exact call graphs.
CASES=(
  "pipeline|Give me a quick pipeline summary — counts and weighted value by status.|severa_pipeline_summary"
  "won_ytd|How many sales cases did we win since the start of this year? List the top 5 by expected value.|severa_list_projects,severa_query"
  "forecast_gap|Which active projects have no billing forecast in the next 90 days?|severa_projects_missing_billing_forecast"
  "my_hours|How many hours did I log last week?|severa_get_my_hours"
  "customer_search|Find the customer Kesko and show me their open projects.|severa_find_customer,severa_list_projects"
  "colleague_hours|How many hours did my colleague log last week? Look up any active user and check their hours.|severa_list_users,severa_find_user,severa_list_work_hours,severa_query"
)

FILTER="${1:-}"
FAILED=0
TOTAL=0

run_case() {
  local name="$1" prompt="$2" expected="$3"
  TOTAL=$((TOTAL + 1))
  echo
  echo "── $name ──────────────────────────────────────────"
  echo "prompt: $prompt"
  echo "expect: $expected"

  local out
  out=$(claude -p "$prompt" \
    --mcp-config eval/mcp.json \
    --allowedTools "mcp__severa__*" \
    --permission-mode bypassPermissions \
    --output-format stream-json \
    --include-partial-messages \
    --verbose \
    --max-budget-usd 0.50 2>&1) || {
    echo "FAIL: claude exited non-zero"
    echo "$out" | tail -20
    FAILED=$((FAILED + 1))
    return
  }

  # Extract unique tool names from tool_use blocks in the stream
  local tools
  tools=$(echo "$out" \
    | jq -rs '.[] | select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name' 2>/dev/null \
    | sort -u \
    | tr '\n' ',' \
    | sed 's/,$//')

  echo "called: ${tools:-<none>}"

  # Pass if any expected tool appears in the called set. Match on suffix
  # so `severa_pipeline_summary` matches the client-namespaced
  # `mcp__severa__severa_pipeline_summary` it appears under in practice.
  local ok=0
  IFS=',' read -ra want <<<"$expected"
  for w in "${want[@]}"; do
    if echo ",$tools," | grep -qE ",[^,]*${w}(,|$)"; then ok=1; break; fi
  done

  if [ "$ok" = 1 ]; then
    echo "PASS"
  else
    echo "FAIL: none of [$expected] were called"
    # On failure, surface the final assistant text for debugging
    echo "$out" | jq -rs 'last(.[] | select(.type=="result") | .result // empty)' 2>/dev/null | head -10
    FAILED=$((FAILED + 1))
  fi
}

# Ad-hoc one-off: run with `-` and env vars
if [ "$FILTER" = "-" ]; then
  run_case "ad-hoc" "${PROMPT:?PROMPT env var required}" "${EXPECT:?EXPECT env var required}"
else
  for case in "${CASES[@]}"; do
    IFS='|' read -r name prompt expected <<<"$case"
    if [ -n "$FILTER" ] && ! echo "$name" | grep -q "$FILTER"; then continue; fi
    run_case "$name" "$prompt" "$expected"
  done
fi

echo
echo "══════════════════════════════════════════════════════"
echo "$((TOTAL - FAILED))/$TOTAL passed"
exit $FAILED
