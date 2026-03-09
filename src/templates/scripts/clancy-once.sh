#!/usr/bin/env bash
# Strict mode: exit on error (-e), undefined variables (-u), pipe failures (-o pipefail).
# This means any command that fails will stop the script immediately rather than silently continuing.
set -euo pipefail

# ─── WHAT THIS SCRIPT DOES ─────────────────────────────────────────────────────
#
# Board: Jira
#
# 1. Preflight — checks all required tools, credentials, and board reachability
# 2. Fetch    — pulls the next assigned "To Do" ticket from Jira (maxResults: 1)
# 3. Branch   — creates a feature branch from the ticket's epic branch (or base branch)
# 4. Implement — passes the ticket to Claude Code, which reads .clancy/docs/ and implements it
# 5. Merge    — squash-merges the feature branch back into the target branch
# 6. Log      — appends a completion entry to .clancy/progress.txt
#
# This script is run once per ticket. The loop is handled by clancy-afk.sh.
#
# NOTE: This file has no -jira suffix by design. /clancy:init copies the correct
# board variant into the user's .clancy/ directory as clancy-once.sh regardless
# of board. The board is determined by which template was copied, not the filename.
#
# NOTE: Failures use exit 0, not exit 1. This is intentional — clancy-afk.sh
# detects stop conditions by reading script output rather than exit codes, so a
# non-zero exit would be treated as an unexpected crash rather than a clean stop.
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
  echo "  Then run: /clancy:init"
  exit 0
}
# shellcheck source=/dev/null
source .clancy/.env

git rev-parse --git-dir >/dev/null 2>&1 || {
  echo "✗ Not a git repository."
  echo "  Clancy must be run from the root of a git project."
  exit 0
}

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "⚠ Working directory has uncommitted changes."
  echo "  Consider stashing or committing first to avoid confusion."
fi

[ -n "${JIRA_BASE_URL:-}"    ] || { echo "✗ JIRA_BASE_URL is not set in .clancy/.env";    exit 0; }
[ -n "${JIRA_USER:-}"        ] || { echo "✗ JIRA_USER is not set in .clancy/.env";        exit 0; }
[ -n "${JIRA_API_TOKEN:-}"   ] || { echo "✗ JIRA_API_TOKEN is not set in .clancy/.env";   exit 0; }
[ -n "${JIRA_PROJECT_KEY:-}" ] || { echo "✗ JIRA_PROJECT_KEY is not set in .clancy/.env"; exit 0; }
if ! echo "$JIRA_PROJECT_KEY" | grep -qE '^[A-Z][A-Z0-9]+$'; then
  echo "✗ JIRA_PROJECT_KEY format is invalid. Expected uppercase letters and numbers only (e.g. PROJ, ENG2). Check JIRA_PROJECT_KEY in .clancy/.env."
  exit 0
fi

PING=$(curl -s -o /dev/null -w "%{http_code}" \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  "$JIRA_BASE_URL/rest/api/3/project/$JIRA_PROJECT_KEY")

case "$PING" in
  200) ;;
  401) echo "✗ Jira authentication failed. Check JIRA_USER and JIRA_API_TOKEN in .clancy/.env."; exit 0 ;;
  403) echo "✗ Jira access denied. Your token may lack Browse Projects permission."; exit 0 ;;
  404) echo "✗ Jira project '$JIRA_PROJECT_KEY' not found. Check JIRA_PROJECT_KEY in .clancy/.env."; exit 0 ;;
  000) echo "✗ Could not reach Jira at $JIRA_BASE_URL. Check JIRA_BASE_URL and your network."; exit 0 ;;
  *)   echo "✗ Jira returned unexpected status $PING. Check your config."; exit 0 ;;
esac

if [ "${PLAYWRIGHT_ENABLED:-}" = "true" ]; then
  if lsof -ti:"${PLAYWRIGHT_DEV_PORT:-5173}" >/dev/null 2>&1; then
    echo "⚠ Port ${PLAYWRIGHT_DEV_PORT:-5173} is already in use."
    echo "  Clancy will attempt to start the dev server on this port."
    echo "  If visual checks fail, stop whatever is using the port first."
  fi
fi

echo "✓ Preflight passed. Starting Clancy..."

# ─── END PREFLIGHT ─────────────────────────────────────────────────────────────

# ─── FETCH TICKET ──────────────────────────────────────────────────────────────

# Validate user-controlled values to prevent JQL injection.
# JQL does not support parameterised queries, so we restrict to safe characters.
if [ -n "${CLANCY_LABEL:-}" ] && ! echo "$CLANCY_LABEL" | grep -qE '^[a-zA-Z0-9 _-]+$'; then
  echo "✗ CLANCY_LABEL contains invalid characters. Use only letters, numbers, spaces, hyphens, and underscores."
  exit 0
fi
if ! echo "${CLANCY_JQL_STATUS:-To Do}" | grep -qE '^[a-zA-Z0-9 _-]+$'; then
  echo "✗ CLANCY_JQL_STATUS contains invalid characters. Use only letters, numbers, spaces, hyphens, and underscores."
  exit 0
fi

# Build JQL — sprint filter is optional (requires Jira Software license).
# Uses the /rest/api/3/search/jql POST endpoint — the old GET /search was removed Aug 2025.
# maxResults:1 is intentional — pick one ticket per run, never paginate.
if [ -n "${CLANCY_JQL_SPRINT:-}" ]; then
  SPRINT_CLAUSE="AND sprint in openSprints()"
else
  SPRINT_CLAUSE=""
fi

# Optional label filter — set CLANCY_LABEL in .env to only pick up tickets with that label.
# Useful for mixed backlogs where not every ticket is suitable for autonomous implementation.
if [ -n "${CLANCY_LABEL:-}" ]; then
  LABEL_CLAUSE="AND labels = \"$CLANCY_LABEL\""
else
  LABEL_CLAUSE=""
fi

RESPONSE=$(curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/search/jql" \
  -d "{
    \"jql\": \"project=$JIRA_PROJECT_KEY $SPRINT_CLAUSE $LABEL_CLAUSE AND assignee=currentUser() AND status=\\\"${CLANCY_JQL_STATUS:-To Do}\\\" ORDER BY priority ASC\",
    \"maxResults\": 1,
    \"fields\": [\"summary\", \"description\", \"issuelinks\", \"parent\", \"customfield_10014\"]
  }")

# New endpoint returns { "issues": [...], "isLast": bool } — no .total field
ISSUE_COUNT=$(echo "$RESPONSE" | jq '.issues | length')
if [ "$ISSUE_COUNT" -eq 0 ]; then
  echo "No tickets found. All done!"
  exit 0
fi

TICKET_KEY=$(echo "$RESPONSE" | jq -r '.issues[0].key')
SUMMARY=$(echo "$RESPONSE" | jq -r '.issues[0].fields.summary')

# Extract description via recursive ADF walk
DESCRIPTION=$(echo "$RESPONSE" | jq -r '
  .issues[0].fields.description
  | .. | strings
  | select(length > 0)
  | . + "\n"
' 2>/dev/null || echo "No description")

# Extract epic — try parent first (next-gen), fall back to customfield_10014 (classic)
EPIC_INFO=$(echo "$RESPONSE" | jq -r '
  .issues[0].fields.parent.key // .issues[0].fields.customfield_10014 // "none"
')

# Extract blocking issue links
BLOCKERS=$(echo "$RESPONSE" | jq -r '
  [.issues[0].fields.issuelinks[]?
    | select(.type.name == "Blocks" and .inwardIssue?)
    | .inwardIssue.key]
  | if length > 0 then "Blocked by: " + join(", ") else "None" end
' 2>/dev/null || echo "None")

BASE_BRANCH="${CLANCY_BASE_BRANCH:-main}"
TICKET_BRANCH="feature/$(echo "$TICKET_KEY" | tr '[:upper:]' '[:lower:]')"

# Auto-detect target branch from ticket's parent epic.
# If the ticket has a parent epic, branch from epic/{epic-key} (creating it from
# BASE_BRANCH if it doesn't exist yet). Otherwise branch from BASE_BRANCH directly.
if [ "$EPIC_INFO" != "none" ]; then
  TARGET_BRANCH="epic/$(echo "$EPIC_INFO" | tr '[:upper:]' '[:lower:]')"
  git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH" \
    || git checkout -b "$TARGET_BRANCH" "$BASE_BRANCH"
else
  TARGET_BRANCH="$BASE_BRANCH"
fi

# ─── IMPLEMENT ─────────────────────────────────────────────────────────────────

echo "Picking up: [$TICKET_KEY] $SUMMARY"
echo "Epic: $EPIC_INFO | Target branch: $TARGET_BRANCH | Blockers: $BLOCKERS"

git checkout "$TARGET_BRANCH"
# -B creates the branch if it doesn't exist, or resets it to HEAD if it does.
# This handles retries cleanly without failing on an already-existing branch.
git checkout -B "$TICKET_BRANCH"

PROMPT="You are implementing Jira ticket $TICKET_KEY.

Summary: $SUMMARY
Epic: $EPIC_INFO
Blockers: $BLOCKERS

Description:
$DESCRIPTION

Step 0 — Executability check (do this before any git or file operation):
Read the ticket summary and description above. Can this ticket be implemented entirely
as a code change committed to this repo? Consult the 'Executability check' section of
CLAUDE.md for the full list of skip conditions.

If you must SKIP this ticket:
1. Output: ⚠ Skipping [$TICKET_KEY]: {one-line reason}
2. Output: Ticket skipped — update it to be codebase-only work, then re-run.
3. Append to .clancy/progress.txt: YYYY-MM-DD HH:MM | $TICKET_KEY | SKIPPED | {reason}
4. Stop — no branches, no file changes, no git operations.

If the ticket IS implementable, continue:
1. Read core docs in .clancy/docs/: STACK.md, ARCHITECTURE.md, CONVENTIONS.md, GIT.md, DEFINITION-OF-DONE.md, CONCERNS.md
   Also read if relevant to this ticket: INTEGRATIONS.md (external APIs/services/auth), TESTING.md (tests/specs/coverage), DESIGN-SYSTEM.md (UI/components/styles), ACCESSIBILITY.md (accessibility/ARIA/WCAG)
2. Follow the conventions in GIT.md exactly
3. Implement the ticket fully
4. Commit your work following the conventions in GIT.md
5. When done, confirm you are finished."

CLAUDE_ARGS=(--dangerously-skip-permissions)
[ -n "${CLANCY_MODEL:-}" ] && CLAUDE_ARGS+=(--model "$CLANCY_MODEL")
echo "$PROMPT" | claude "${CLAUDE_ARGS[@]}"

# ─── MERGE & LOG ───────────────────────────────────────────────────────────────

# Squash all commits from the feature branch into a single commit on the target branch.
git checkout "$TARGET_BRANCH"
git merge --squash "$TICKET_BRANCH"
if git diff --cached --quiet; then
  echo "⚠ No changes staged after squash merge. Claude may not have committed any work."
else
  git commit -m "feat($TICKET_KEY): $SUMMARY"
fi

# Delete ticket branch locally (never push deletes)
git branch -d "$TICKET_BRANCH"

# Log progress
echo "$(date '+%Y-%m-%d %H:%M') | $TICKET_KEY | $SUMMARY | DONE" >> .clancy/progress.txt

echo "✓ $TICKET_KEY complete."

# Send completion notification if webhook is configured
if [ -n "${CLANCY_NOTIFY_WEBHOOK:-}" ]; then
  NOTIFY_MSG="✓ Clancy completed [$TICKET_KEY] $SUMMARY"
  if echo "$CLANCY_NOTIFY_WEBHOOK" | grep -q "hooks.slack.com"; then
    curl -s -X POST "$CLANCY_NOTIFY_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg text "$NOTIFY_MSG" '{"text": $text}')" >/dev/null 2>&1 || true
  else
    curl -s -X POST "$CLANCY_NOTIFY_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg text "$NOTIFY_MSG" '{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","content":{"type":"AdaptiveCard","body":[{"type":"TextBlock","text":$text}]}}]}')" >/dev/null 2>&1 || true
  fi
fi
