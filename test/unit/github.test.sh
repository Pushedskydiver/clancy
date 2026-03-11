#!/usr/bin/env bash
# Unit tests for GitHub Issues response parsing logic
# Tests the jq expressions used in clancy-once-github.sh against fixture files
set -euo pipefail

FIXTURES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../fixtures" && pwd)"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; echo "        expected: $2"; echo "        got:      $3"; FAIL=$((FAIL + 1)); }

assert_eq() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$description"
  else
    fail "$description" "$expected" "$actual"
  fi
}

echo ""
echo "GitHub parsing tests"
echo "────────────────────"

# ─── Happy path ───────────────────────────────────────────────────────────────
echo ""
echo "happy path:"
FIXTURE="$FIXTURES_DIR/github-happy-path.json"

ISSUE=$(jq 'map(select(has("pull_request") | not)) | .[0]' "$FIXTURE")
assert_eq "issue is not null" '"object"' "$(echo "$ISSUE" | jq 'type')"

ISSUE_NUMBER=$(echo "$ISSUE" | jq -r '.number')
assert_eq "issue number is 42" "42" "$ISSUE_NUMBER"

TITLE=$(echo "$ISSUE" | jq -r '.title')
assert_eq "title parsed" "Add dark mode toggle to settings page" "$TITLE"

MILESTONE=$(echo "$ISSUE" | jq -r '.milestone.title // "none"')
assert_eq "milestone parsed" "v1.2 — User Preferences" "$MILESTONE"

# ─── PR first — should be filtered ────────────────────────────────────────────
echo ""
echo "PR first (should skip PR, pick issue):"
FIXTURE="$FIXTURES_DIR/github-pr-first.json"

ISSUE=$(jq 'map(select(has("pull_request") | not)) | .[0]' "$FIXTURE")
ISSUE_NUMBER=$(echo "$ISSUE" | jq -r '.number')
assert_eq "PR is filtered, real issue #42 selected" "42" "$ISSUE_NUMBER"

PR_COUNT=$(jq 'map(select(has("pull_request"))) | length' "$FIXTURE")
assert_eq "one PR in fixture" "1" "$PR_COUNT"

REAL_ISSUE_COUNT=$(jq 'map(select(has("pull_request") | not)) | length' "$FIXTURE")
assert_eq "one real issue after filtering" "1" "$REAL_ISSUE_COUNT"

# ─── Empty ────────────────────────────────────────────────────────────────────
echo ""
echo "empty queue:"
FIXTURE="$FIXTURES_DIR/github-empty.json"

ISSUE=$(jq 'map(select(has("pull_request") | not)) | .[0]' "$FIXTURE")
assert_eq "issue is null for empty response" '"null"' "$(echo "$ISSUE" | jq 'type')"

# ─── Auth failure ─────────────────────────────────────────────────────────────
echo ""
echo "auth failure:"
FIXTURE="$FIXTURES_DIR/github-auth-failure.json"

HAS_MESSAGE=$(jq 'has("message")' "$FIXTURE")
assert_eq "message field present" "true" "$HAS_MESSAGE"

ERROR_MSG=$(jq -r '.message' "$FIXTURE")
assert_eq "error message is Bad credentials" "Bad credentials" "$ERROR_MSG"

# ─── Null body ────────────────────────────────────────────────────────────────
echo ""
echo "null body:"
FIXTURE="$FIXTURES_DIR/github-null-body.json"

ISSUE=$(jq 'map(select(has("pull_request") | not)) | .[0]' "$FIXTURE")
BODY=$(echo "$ISSUE" | jq -r '.body // "No description"')
assert_eq "null body defaults to No description" "No description" "$BODY"

MILESTONE=$(echo "$ISSUE" | jq -r '.milestone.title // "none"')
assert_eq "null milestone defaults to none" "none" "$MILESTONE"

# ─── All PRs — no real issues ─────────────────────────────────────────────────
echo ""
echo "all PRs (no real issues after filtering):"
FIXTURE="$FIXTURES_DIR/github-all-prs.json"

ALL_COUNT=$(jq 'length' "$FIXTURE")
assert_eq "fixture has 3 results" "3" "$ALL_COUNT"

PR_COUNT=$(jq 'map(select(has("pull_request"))) | length' "$FIXTURE")
assert_eq "all 3 results are PRs" "3" "$PR_COUNT"

ISSUE=$(jq 'map(select(has("pull_request") | not)) | .[0]' "$FIXTURE")
assert_eq "no real issue found (null)" '"null"' "$(echo "$ISSUE" | jq 'type')"

REAL_ISSUE_COUNT=$(jq 'map(select(has("pull_request") | not)) | length' "$FIXTURE")
assert_eq "zero real issues after PR filter" "0" "$REAL_ISSUE_COUNT"

# ─── Branch naming ────────────────────────────────────────────────────────────
echo ""
echo "branch naming:"
ISSUE_NUMBER="42"
TICKET_BRANCH="feature/issue-${ISSUE_NUMBER}"
assert_eq "branch name format" "feature/issue-42" "$TICKET_BRANCH"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────"
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
