#!/usr/bin/env bash
# Unit tests for Linear response parsing logic
# Tests the jq expressions used in clancy-once-linear.sh against fixture files
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
echo "Linear parsing tests"
echo "────────────────────"

# ─── Happy path ───────────────────────────────────────────────────────────────
echo ""
echo "happy path:"
FIXTURE="$FIXTURES_DIR/linear-happy-path.json"

NODE_COUNT=$(jq '.data.viewer.assignedIssues.nodes | length' "$FIXTURE")
assert_eq "node count is 1" "1" "$NODE_COUNT"

IDENTIFIER=$(jq -r '.data.viewer.assignedIssues.nodes[0].identifier' "$FIXTURE")
assert_eq "identifier is ENG-42" "ENG-42" "$IDENTIFIER"

TITLE=$(jq -r '.data.viewer.assignedIssues.nodes[0].title' "$FIXTURE")
assert_eq "title parsed" "Add user avatar to profile header" "$TITLE"

PARENT_ID=$(jq -r '.data.viewer.assignedIssues.nodes[0].parent.identifier // "none"' "$FIXTURE")
assert_eq "parent identifier" "ENG-10" "$PARENT_ID"

PARENT_TITLE=$(jq -r '.data.viewer.assignedIssues.nodes[0].parent.title // ""' "$FIXTURE")
assert_eq "parent title" "User Profile Epic" "$PARENT_TITLE"

# Branch name derived from identifier
TICKET_BRANCH="feature/$(echo "$IDENTIFIER" | tr '[:upper:]' '[:lower:]')"
assert_eq "branch name from identifier" "feature/eng-42" "$TICKET_BRANCH"

# ─── Empty ────────────────────────────────────────────────────────────────────
echo ""
echo "empty queue:"
FIXTURE="$FIXTURES_DIR/linear-empty.json"

NODE_COUNT=$(jq '.data.viewer.assignedIssues.nodes | length' "$FIXTURE")
assert_eq "node count is 0" "0" "$NODE_COUNT"

# ─── Auth failure ─────────────────────────────────────────────────────────────
echo ""
echo "auth failure:"
FIXTURE="$FIXTURES_DIR/linear-auth-failure.json"

HAS_ERRORS=$(jq 'has("errors")' "$FIXTURE")
assert_eq "errors field present" "true" "$HAS_ERRORS"

ERROR_MSG=$(jq -r '.errors[0].message' "$FIXTURE")
assert_eq "error message" "Authentication required" "$ERROR_MSG"

# Verify viewer.id extraction would fail (no .data.viewer.id)
if jq -e '.data.viewer.id' "$FIXTURE" >/dev/null 2>&1; then
  fail "viewer.id not present in auth failure" "jq exit 1" "jq exit 0"
else
  pass "viewer.id not present in auth failure"
fi

# ─── No parent (no epic) ──────────────────────────────────────────────────────
echo ""
echo "no parent (epic is none):"
FIXTURE="$FIXTURES_DIR/linear-empty.json"
# Simulate a node with no parent
NO_PARENT_JSON='{"data":{"viewer":{"assignedIssues":{"nodes":[{"id":"xyz","identifier":"ENG-99","title":"Standalone task","description":"No parent","parent":null}]}}}}'

PARENT_ID=$(echo "$NO_PARENT_JSON" | jq -r '.data.viewer.assignedIssues.nodes[0].parent.identifier // "none"')
assert_eq "parent is none when null" "none" "$PARENT_ID"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────"
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
