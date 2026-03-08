#!/usr/bin/env bash
# Strict mode: exit on error (-e), undefined variables (-u), pipe failures (-o pipefail).
# This means any command that fails will stop the script immediately rather than silently continuing.
set -euo pipefail

# ─── WHAT THIS SCRIPT DOES ─────────────────────────────────────────────────────
#
# Loop runner for Clancy. Calls clancy-once.sh repeatedly until:
#   - No more tickets are found ("No tickets found", "All done", etc.)
#   - A preflight check fails (output line starting with ✗)
#   - MAX_ITERATIONS is reached
#   - The user presses Ctrl+C
#
# This script does not know about boards. All board logic lives in clancy-once.sh,
# which is always the runtime filename regardless of which board is configured.
# /clancy:init copies the correct board variant as clancy-once.sh during setup.
#
# ───────────────────────────────────────────────────────────────────────────────

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

MAX_ITERATIONS=${MAX_ITERATIONS:-5}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# clancy-once.sh is always the runtime filename regardless of board.
# /clancy:init copies the correct board variant as clancy-once.sh.
ONCE_SCRIPT="$SCRIPT_DIR/clancy-once.sh"

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

  # Run clancy-once.sh and stream its output live via tee.
  # tee writes to both stdout (visible to user) and a temp file (for stop-condition checks).
  # Without tee, output would be buffered in a variable and hidden during implementation.
  TMPFILE=$(mktemp)
  bash "$ONCE_SCRIPT" 2>&1 | tee "$TMPFILE"
  OUTPUT=$(cat "$TMPFILE")
  rm -f "$TMPFILE"

  # Stop if no tickets remain
  if echo "$OUTPUT" | grep -qE "No tickets found|No issues found|All done"; then
    echo ""
    echo "✓ Clancy finished — no more tickets."
    exit 0
  fi

  # Stop if Claude skipped the ticket (not implementable from the codebase).
  # Re-running would just fetch and skip the same ticket again — stop and let
  # the user update the ticket or remove it from the queue before continuing.
  if echo "$OUTPUT" | grep -q "Ticket skipped"; then
    echo ""
    echo "⚠ Clancy stopped — ticket was skipped (not implementable from the codebase)."
    echo "  Update the ticket to focus on codebase work, then re-run."
    exit 0
  fi

  # Stop if a preflight check failed (lines starting with ✗)
  if echo "$OUTPUT" | grep -qE "^✗ "; then
    echo ""
    echo "✗ Clancy stopped — preflight check failed. See output above."
    exit 0
  fi

  sleep 2
done

echo ""
echo "Reached max iterations ($MAX_ITERATIONS). Run clancy-afk.sh again to continue."
