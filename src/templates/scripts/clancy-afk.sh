#!/usr/bin/env bash
set -euo pipefail

# ─── PREFLIGHT ─────────────────────────────────────────────────────────────────

command -v claude >/dev/null 2>&1 || {
  echo "✗ claude CLI not found."
  echo "  Install it: https://claude.ai/code"
  exit 0
}
command -v jq >/dev/null 2>&1 || {
  echo "✗ jq not found."
  echo "  Install: brew install jq  (mac) | apt install jq  (linux)"
  exit 0
}
command -v curl >/dev/null 2>&1 || {
  echo "✗ curl not found. Install curl for your OS."
  exit 0
}

[ -f .clancy/.env ] || {
  echo "✗ .clancy/.env not found."
  echo "  Copy .clancy/.env.example to .clancy/.env and fill in your credentials."
  exit 0
}
# shellcheck source=/dev/null
source .clancy/.env

git rev-parse --git-dir >/dev/null 2>&1 || {
  echo "✗ Not a git repository."
  echo "  Clancy must be run from the root of a git project."
  exit 0
}

# ─── END PREFLIGHT ─────────────────────────────────────────────────────────────

MAX_ITERATIONS=${MAX_ITERATIONS:-20}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect which once script to use based on .env credentials
if [ -n "${JIRA_BASE_URL:-}" ]; then
  ONCE_SCRIPT="$SCRIPT_DIR/clancy-once.sh"
elif [ -n "${GITHUB_TOKEN:-}" ]; then
  ONCE_SCRIPT="$SCRIPT_DIR/clancy-once-github.sh"
elif [ -n "${LINEAR_API_KEY:-}" ]; then
  ONCE_SCRIPT="$SCRIPT_DIR/clancy-once-linear.sh"
else
  echo "✗ No board credentials found in .clancy/.env."
  echo "  Set JIRA_BASE_URL, GITHUB_TOKEN, or LINEAR_API_KEY."
  exit 0
fi

if [ ! -f "$ONCE_SCRIPT" ]; then
  echo "✗ Script not found: $ONCE_SCRIPT"
  echo "  Run /clancy:init to scaffold scripts."
  exit 0
fi

echo "Starting Clancy — will process up to $MAX_ITERATIONS ticket(s). Ctrl+C to stop early."
echo ""

i=0
while [ "$i" -lt "$MAX_ITERATIONS" ]; do
  i=$((i + 1))
  echo ""
  echo "=== Iteration $i of $MAX_ITERATIONS ==="

  OUTPUT=$(bash "$ONCE_SCRIPT" 2>&1)
  echo "$OUTPUT"

  # Stop if no tickets found
  if echo "$OUTPUT" | grep -qE "No tickets found|No issues found|All done"; then
    echo ""
    echo "✓ Clancy finished — no more tickets."
    exit 0
  fi

  sleep 2
done

echo ""
echo "Reached max iterations ($MAX_ITERATIONS). Run clancy-afk.sh again to continue."
