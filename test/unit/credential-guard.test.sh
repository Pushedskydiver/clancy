#!/usr/bin/env bash
# Unit tests for clancy-credential-guard.js PreToolUse hook
# Tests credential detection patterns and allowed-path exemptions
#
# NOTE: Credential values are constructed at runtime (prefix + suffix) to avoid
# triggering GitHub push protection's secret scanner on the test file itself.
set -euo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../hooks" && pwd)/clancy-credential-guard.js"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; echo "        expected: $2"; echo "        got:      $3"; FAIL=$((FAIL + 1)); }

# Run the hook with a JSON arg and return the decision field
run_guard() {
  node "$HOOK" "$1" 2>/dev/null | jq -r '.decision'
}

# Run the hook and return the full JSON output
run_guard_full() {
  node "$HOOK" "$1" 2>/dev/null
}

# Build a fake credential by concatenating prefix + suffix at runtime
# so the literal string never appears in this file for GitHub's scanner
fake_cred() {
  echo "${1}${2}"
}

echo ""
echo "Credential guard tests"
echo "──────────────────────"

# ─── Non-file-writing tools (should always approve) ──────────────────────────
echo ""
echo "non-file-writing tools:"

RESULT=$(run_guard '{"tool_name":"Read","tool_input":{"file_path":"src/config.js"}}')
if [ "$RESULT" = "approve" ]; then pass "Read tool approved"; else fail "Read tool approved" "approve" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Bash","tool_input":{"command":"ls"}}')
if [ "$RESULT" = "approve" ]; then pass "Bash tool approved"; else fail "Bash tool approved" "approve" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Glob","tool_input":{"pattern":"**/*.js"}}')
if [ "$RESULT" = "approve" ]; then pass "Glob tool approved"; else fail "Glob tool approved" "approve" "$RESULT"; fi

# ─── Allowed paths (should approve even with credentials) ────────────────────
echo ""
echo "allowed paths:"

GHP=$(fake_cred "ghp_" "AAAAABBBBBCCCCCDDDDDEEEEEFFFFF123456")
RESULT=$(run_guard "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"/project/.clancy/.env\",\"content\":\"GITHUB_TOKEN=${GHP}\"}}")
if [ "$RESULT" = "approve" ]; then pass ".clancy/.env approved"; else fail ".clancy/.env approved" "approve" "$RESULT"; fi

RESULT=$(run_guard "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"/project/.env.example\",\"content\":\"GITHUB_TOKEN=${GHP}\"}}")
if [ "$RESULT" = "approve" ]; then pass ".env.example approved"; else fail ".env.example approved" "approve" "$RESULT"; fi

SK_LIVE=$(fake_cred "sk_live" "_AAAAABBBBBCCCCCDDDDDEEEEE")
RESULT=$(run_guard "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"/project/.env.local\",\"content\":\"api_key=${SK_LIVE}\"}}")
if [ "$RESULT" = "approve" ]; then pass ".env.local approved"; else fail ".env.local approved" "approve" "$RESULT"; fi

RESULT=$(run_guard "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"/project/.env.development\",\"content\":\"api_key=${SK_LIVE}\"}}")
if [ "$RESULT" = "approve" ]; then pass ".env.development approved"; else fail ".env.development approved" "approve" "$RESULT"; fi

RESULT=$(run_guard "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"/project/.env.test\",\"content\":\"api_key=${SK_LIVE}\"}}")
if [ "$RESULT" = "approve" ]; then pass ".env.test approved"; else fail ".env.test approved" "approve" "$RESULT"; fi

# ─── Clean content (should approve) ──────────────────────────────────────────
echo ""
echo "clean content:"

RESULT=$(run_guard '{"tool_name":"Write","tool_input":{"file_path":"src/app.js","content":"const x = 42;\nconsole.log(x);"}}')
if [ "$RESULT" = "approve" ]; then pass "clean JS approved"; else fail "clean JS approved" "approve" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Edit","tool_input":{"file_path":"src/app.js","new_string":"function hello() { return true; }"}}')
if [ "$RESULT" = "approve" ]; then pass "clean Edit approved"; else fail "clean Edit approved" "approve" "$RESULT"; fi

# ─── Credential detection — Write tool ───────────────────────────────────────
echo ""
echo "credential detection (Write):"

RESULT=$(run_guard "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"src/config.js\",\"content\":\"const token = ${GHP};\"}}")
if [ "$RESULT" = "block" ]; then pass "GitHub PAT (classic) blocked"; else fail "GitHub PAT (classic) blocked" "block" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Write","tool_input":{"file_path":"src/config.js","content":"const key = AKIAIOSFODNN7EXAMPLE;"}}')
if [ "$RESULT" = "block" ]; then pass "AWS Access Key blocked"; else fail "AWS Access Key blocked" "block" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Write","tool_input":{"file_path":"src/config.js","content":"aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY1234"}}')
if [ "$RESULT" = "block" ]; then pass "AWS Secret Key blocked"; else fail "AWS Secret Key blocked" "block" "$RESULT"; fi

RESULT=$(run_guard "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"src/config.js\",\"content\":\"const key = ${SK_LIVE};\"}}")
if [ "$RESULT" = "block" ]; then pass "Stripe secret key blocked"; else fail "Stripe secret key blocked" "block" "$RESULT"; fi

PK_TEST=$(fake_cred "pk_test" "_AAAAABBBBBCCCCCDDDDDEEEEE")
RESULT=$(run_guard "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"src/config.js\",\"content\":\"const key = ${PK_TEST};\"}}")
if [ "$RESULT" = "block" ]; then pass "Stripe publishable key blocked"; else fail "Stripe publishable key blocked" "block" "$RESULT"; fi

SLACK=$(fake_cred "xoxb-0000000000" "-AAAAABBBBBCCCCC")
RESULT=$(run_guard "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"src/config.js\",\"content\":\"const token = ${SLACK};\"}}")
if [ "$RESULT" = "block" ]; then pass "Slack token blocked"; else fail "Slack token blocked" "block" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Write","tool_input":{"file_path":"src/config.js","content":"-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK..."}}')
if [ "$RESULT" = "block" ]; then pass "RSA private key blocked"; else fail "RSA private key blocked" "block" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Write","tool_input":{"file_path":"src/config.js","content":"-----BEGIN PRIVATE KEY-----\nMIIEvgIBADA..."}}')
if [ "$RESULT" = "block" ]; then pass "generic private key blocked"; else fail "generic private key blocked" "block" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Write","tool_input":{"file_path":"src/config.js","content":"const url = \"mongodb://admin:secretpassword@localhost:27017/mydb\";"}}')
if [ "$RESULT" = "block" ]; then pass "MongoDB connection string blocked"; else fail "MongoDB connection string blocked" "block" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Write","tool_input":{"file_path":"src/config.js","content":"const url = \"postgres://user:pass1234@db.example.com:5432/prod\";"}}')
if [ "$RESULT" = "block" ]; then pass "Postgres connection string blocked"; else fail "Postgres connection string blocked" "block" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Write","tool_input":{"file_path":"src/config.js","content":"api_key = \"sk-proj-abcdefghijklmnopqrst\""}}')
if [ "$RESULT" = "block" ]; then pass "generic API key blocked"; else fail "generic API key blocked" "block" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Write","tool_input":{"file_path":"src/config.js","content":"auth_token = \"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdef\""}}')
if [ "$RESULT" = "block" ]; then pass "generic auth token blocked"; else fail "generic auth token blocked" "block" "$RESULT"; fi

LIN=$(fake_cred "lin_api_" "AAAAABBBBBCCCCCDDDDDEEEEEFFFFF0123456789")
RESULT=$(run_guard "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"src/config.js\",\"content\":\"const key = ${LIN};\"}}")
if [ "$RESULT" = "block" ]; then pass "Linear API key blocked"; else fail "Linear API key blocked" "block" "$RESULT"; fi

# ─── Credential detection — Edit tool ────────────────────────────────────────
echo ""
echo "credential detection (Edit):"

RESULT=$(run_guard "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"src/config.js\",\"new_string\":\"const token = ${GHP};\"}}")
if [ "$RESULT" = "block" ]; then pass "Edit with GitHub PAT blocked"; else fail "Edit with GitHub PAT blocked" "block" "$RESULT"; fi

# ─── Credential detection — MultiEdit tool ───────────────────────────────────
echo ""
echo "credential detection (MultiEdit):"

RESULT=$(run_guard '{"tool_name":"MultiEdit","tool_input":{"file_path":"src/config.js","edits":[{"new_string":"const x = 1;"},{"new_string":"const key = AKIAIOSFODNN7EXAMPLE;"}]}}')
if [ "$RESULT" = "block" ]; then pass "MultiEdit with AWS key blocked"; else fail "MultiEdit with AWS key blocked" "block" "$RESULT"; fi

# ─── Block reason includes file path ─────────────────────────────────────────
echo ""
echo "block reason:"

FULL=$(run_guard_full "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"src/config.js\",\"content\":\"const token = ${GHP};\"}}")
REASON=$(echo "$FULL" | jq -r '.reason')
if echo "$REASON" | grep -q "src/config.js"; then
  pass "reason includes file path"
else
  fail "reason includes file path" "(contains src/config.js)" "$REASON"
fi
if echo "$REASON" | grep -q "GitHub PAT"; then
  pass "reason includes credential type"
else
  fail "reason includes credential type" "(contains GitHub PAT)" "$REASON"
fi

# ─── Error resilience (best-effort, never crash) ─────────────────────────────
echo ""
echo "error resilience:"

RESULT=$(run_guard '{}')
if [ "$RESULT" = "approve" ]; then pass "empty input approved"; else fail "empty input approved" "approve" "$RESULT"; fi

RESULT=$(run_guard '')
if [ "$RESULT" = "approve" ]; then pass "no input approved"; else fail "no input approved" "approve" "$RESULT"; fi

RESULT=$(run_guard 'not json')
if [ "$RESULT" = "approve" ]; then pass "invalid JSON approved"; else fail "invalid JSON approved" "approve" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Write","tool_input":{}}')
if [ "$RESULT" = "approve" ]; then pass "missing file_path approved"; else fail "missing file_path approved" "approve" "$RESULT"; fi

RESULT=$(run_guard '{"tool_name":"Write","tool_input":{"file_path":"src/app.js"}}')
if [ "$RESULT" = "approve" ]; then pass "missing content approved"; else fail "missing content approved" "approve" "$RESULT"; fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "FAILED"
  exit 1
fi
echo ""
echo "OK"
