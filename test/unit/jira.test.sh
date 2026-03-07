#!/usr/bin/env bash
# Unit tests for Jira response parsing logic
# Tests the jq expressions used in clancy-once.sh against fixture files
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
echo "Jira parsing tests"
echo "──────────────────"

# ─── Happy path ───────────────────────────────────────────────────────────────
echo ""
echo "happy path:"
FIXTURE="$FIXTURES_DIR/jira-happy-path.json"

ISSUE_COUNT=$(jq '.issues | length' "$FIXTURE")
assert_eq "issue count is 1" "1" "$ISSUE_COUNT"

TICKET_KEY=$(jq -r '.issues[0].key' "$FIXTURE")
assert_eq "ticket key is PROJ-42" "PROJ-42" "$TICKET_KEY"

SUMMARY=$(jq -r '.issues[0].fields.summary' "$FIXTURE")
assert_eq "summary parsed" "Add user avatar to profile header" "$SUMMARY"

EPIC=$(jq -r '.issues[0].fields.parent.key // .issues[0].fields.customfield_10014 // "none"' "$FIXTURE")
assert_eq "epic from parent.key" "PROJ-10" "$EPIC"

DESCRIPTION=$(jq -r '
  .issues[0].fields.description
  | .. | strings
  | select(length > 0)
  | . + "\n"
' "$FIXTURE" 2>/dev/null)
EXPECTED_TEXT="Add a user avatar to the profile header component."
if echo "$DESCRIPTION" | grep -qF "$EXPECTED_TEXT"; then
  pass "description contains expected text"
else
  fail "description contains expected text" "$EXPECTED_TEXT" "(not found in output)"
fi

BLOCKERS=$(jq -r '
  [.issues[0].fields.issuelinks[]?
    | select(.type.name == "Blocks" and .inwardIssue?)
    | .inwardIssue.key]
  | if length > 0 then "Blocked by: " + join(", ") else "None" end
' "$FIXTURE" 2>/dev/null)
assert_eq "no blockers" "None" "$BLOCKERS"

# ─── Empty queue ──────────────────────────────────────────────────────────────
echo ""
echo "empty queue:"
FIXTURE="$FIXTURES_DIR/jira-empty-queue.json"

ISSUE_COUNT=$(jq '.issues | length' "$FIXTURE")
assert_eq "issue count is 0" "0" "$ISSUE_COUNT"

# ─── No epic ──────────────────────────────────────────────────────────────────
echo ""
echo "no epic:"
FIXTURE="$FIXTURES_DIR/jira-no-epic.json"

EPIC=$(jq -r '.issues[0].fields.parent.key // .issues[0].fields.customfield_10014 // "none"' "$FIXTURE")
assert_eq "epic is none when both null" "none" "$EPIC"

# ─── Complex ADF ──────────────────────────────────────────────────────────────
echo ""
echo "complex ADF:"
FIXTURE="$FIXTURES_DIR/jira-adf-complex.json"

TICKET_KEY=$(jq -r '.issues[0].key' "$FIXTURE")
assert_eq "ticket key from complex fixture" "PROJ-99" "$TICKET_KEY"

BLOCKERS=$(jq -r '
  [.issues[0].fields.issuelinks[]?
    | select(.type.name == "Blocks" and .inwardIssue?)
    | .inwardIssue.key]
  | if length > 0 then "Blocked by: " + join(", ") else "None" end
' "$FIXTURE" 2>/dev/null)
assert_eq "blocker extracted from issuelinks" "Blocked by: PROJ-88" "$BLOCKERS"

# ─── Auth failure ─────────────────────────────────────────────────────────────
echo ""
echo "auth failure:"
FIXTURE="$FIXTURES_DIR/jira-auth-failure.json"

ISSUE_COUNT=$(jq '.issues | length // 0' "$FIXTURE")
assert_eq "no issues in auth failure response" "0" "$ISSUE_COUNT"

HAS_ERRORS=$(jq 'has("errorMessages")' "$FIXTURE")
assert_eq "errorMessages field present" "true" "$HAS_ERRORS"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "──────────────────"
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
