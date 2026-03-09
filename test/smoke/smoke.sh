#!/usr/bin/env bash
# Smoke tests — hit real APIs with real credentials
# MANUAL ONLY — requires valid credentials in .env
# Run from the root of a configured project: bash test/smoke/smoke.sh
set -euo pipefail

[ -f .env ] || {
  echo "✗ .env not found. Run from a configured project root."
  exit 1
}
# shellcheck source=/dev/null
source .env

PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

echo ""
echo "Clancy smoke tests (live API calls)"
echo "────────────────────────────────────"
echo ""

# ─── Jira ─────────────────────────────────────────────────────────────────────
if [ -n "${JIRA_BASE_URL:-}" ]; then
  echo "Jira:"

  HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    -u "$JIRA_USER:$JIRA_API_TOKEN" \
    "$JIRA_BASE_URL/rest/api/3/project/$JIRA_PROJECT_KEY")

  if [ "$HTTP" = "200" ]; then
    pass "project reachable ($JIRA_PROJECT_KEY)"
  else
    fail "project check" "HTTP $HTTP"
  fi

  # Test the search endpoint
  SEARCH_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    -u "$JIRA_USER:$JIRA_API_TOKEN" \
    -X POST \
    -H "Content-Type: application/json" \
    "$JIRA_BASE_URL/rest/api/3/search/jql" \
    -d "{\"jql\": \"project=$JIRA_PROJECT_KEY ORDER BY created DESC\", \"maxResults\": 1}")

  if [ "$SEARCH_HTTP" = "200" ]; then
    pass "search/jql endpoint reachable"
  else
    fail "search/jql endpoint" "HTTP $SEARCH_HTTP"
  fi
fi

# ─── GitHub ───────────────────────────────────────────────────────────────────
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo ""
  echo "GitHub:"

  HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/$GITHUB_REPO")

  if [ "$HTTP" = "200" ]; then
    pass "repo reachable ($GITHUB_REPO)"
  else
    fail "repo check" "HTTP $HTTP"
  fi

  ISSUES_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/$GITHUB_REPO/issues?state=open&per_page=1")

  if [ "$ISSUES_HTTP" = "200" ]; then
    pass "issues endpoint reachable"
  else
    fail "issues endpoint" "HTTP $ISSUES_HTTP"
  fi
fi

# ─── Linear ───────────────────────────────────────────────────────────────────
if [ -n "${LINEAR_API_KEY:-}" ]; then
  echo ""
  echo "Linear:"

  # Note: personal API keys do NOT use Bearer prefix
  PING_BODY=$(curl -s -X POST https://api.linear.app/graphql \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    -d '{"query": "{ viewer { id name } }"}')

  VIEWER_ID=$(echo "$PING_BODY" | jq -r '.data.viewer.id // empty' 2>/dev/null || echo "")

  if [ -n "$VIEWER_ID" ]; then
    VIEWER_NAME=$(echo "$PING_BODY" | jq -r '.data.viewer.name')
    pass "authenticated as $VIEWER_NAME"
  else
    fail "viewer query" "$(echo "$PING_BODY" | jq -r '.errors[0].message // "unknown error"')"
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
