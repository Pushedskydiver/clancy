#!/usr/bin/env bash
# Strict mode: exit on error (-e), undefined variables (-u), pipe failures (-o pipefail).
# This means any command that fails will stop the script immediately rather than silently continuing.
set -euo pipefail

# ─── WHAT THIS SCRIPT DOES ─────────────────────────────────────────────────────
#
# Board: Linear
#
# 1. Preflight  — checks all required tools, credentials, and API reachability
# 2. Fetch      — pulls the next unstarted issue assigned to you via GraphQL
# 3. Branch     — creates a feature branch from the issue's parent branch (or base branch)
# 4. Implement  — passes the issue to Claude Code, which reads .clancy/docs/ and implements it
# 5. Merge      — squash-merges the feature branch back into the target branch
# 6. Log        — appends a completion entry to .clancy/progress.txt
#
# This script is run once per issue. The loop is handled by clancy-afk.sh.
#
# NOTE: Linear personal API keys do NOT use a "Bearer" prefix in the Authorization
# header. OAuth access tokens do. This is correct per Linear's documentation.
#
# NOTE: state.type "unstarted" is a fixed enum value — it filters by state category,
# not state name. This works regardless of what your team named their backlog column.
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

[ -n "${LINEAR_API_KEY:-}"  ] || { echo "✗ LINEAR_API_KEY is not set in .clancy/.env";  exit 0; }
[ -n "${LINEAR_TEAM_ID:-}"  ] || { echo "✗ LINEAR_TEAM_ID is not set in .clancy/.env";  exit 0; }

# Linear ping — verify API key with a minimal query
# Note: personal API keys do NOT use a "Bearer" prefix — this is correct per Linear docs.
# OAuth access tokens use "Bearer". Do not change this.
PING_BODY=$(curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ viewer { id } }"}')

echo "$PING_BODY" | jq -e '.data.viewer.id' >/dev/null 2>&1 || {
  echo "✗ Linear authentication failed. Check LINEAR_API_KEY in .clancy/.env."; exit 0
}

if [ "${PLAYWRIGHT_ENABLED:-}" = "true" ]; then
  if lsof -ti:"${PLAYWRIGHT_DEV_PORT:-5173}" >/dev/null 2>&1; then
    echo "⚠ Port ${PLAYWRIGHT_DEV_PORT:-5173} is already in use."
    echo "  If visual checks fail, stop whatever is using the port first."
  fi
fi

echo "✓ Preflight passed. Starting Clancy..."

# ─── END PREFLIGHT ─────────────────────────────────────────────────────────────

# ─── FETCH ISSUE ───────────────────────────────────────────────────────────────

# Fetch one unstarted issue assigned to the current user on the configured team.
# Note: personal API keys do NOT use "Bearer" prefix — this is intentional.
#
# GraphQL query (expanded for readability):
#   viewer {
#     assignedIssues(
#       filter: {
#         state: { type: { eq: "unstarted" } }   ← fixed enum, works regardless of column name
#         team: { id: { eq: "$LINEAR_TEAM_ID" } }
#         labels: { name: { eq: "$CLANCY_LABEL" } }  ← only if CLANCY_LABEL is set
#       }
#       first: 1
#       orderBy: priority
#     ) {
#       nodes { id identifier title description parent { identifier title } }
#     }
#   }

# Optional label filter — set CLANCY_LABEL in .env to only pick up issues with that label.
# Recommended: create a "clancy" label in Linear and apply it to issues suitable for autonomous implementation.
if [ -n "${CLANCY_LABEL:-}" ]; then
  LABEL_CLAUSE=" labels: { name: { eq: \\\"$CLANCY_LABEL\\\" } }"
else
  LABEL_CLAUSE=""
fi

RESPONSE=$(curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d "{\"query\": \"{ viewer { assignedIssues(filter: { state: { type: { eq: \\\"unstarted\\\" } } team: { id: { eq: \\\"$LINEAR_TEAM_ID\\\" } }$LABEL_CLAUSE } first: 1 orderBy: priority) { nodes { id identifier title description parent { identifier title } } } } } }\"}")

# Check for API errors before parsing (rate limit, permission error, etc.)
if ! echo "$RESPONSE" | jq -e '.data.viewer.assignedIssues' >/dev/null 2>&1; then
  ERR_MSG=$(echo "$RESPONSE" | jq -r '.errors[0].message // "Unexpected response"' 2>/dev/null || echo "Unexpected response")
  echo "✗ Linear API error: $ERR_MSG. Check LINEAR_API_KEY in .clancy/.env."
  exit 0
fi

NODE_COUNT=$(echo "$RESPONSE" | jq '.data.viewer.assignedIssues.nodes | length')
if [ "$NODE_COUNT" -eq 0 ]; then
  echo "No issues found. All done!"
  exit 0
fi

IDENTIFIER=$(echo "$RESPONSE" | jq -r '.data.viewer.assignedIssues.nodes[0].identifier')
TITLE=$(echo "$RESPONSE" | jq -r '.data.viewer.assignedIssues.nodes[0].title')
DESCRIPTION=$(echo "$RESPONSE" | jq -r '.data.viewer.assignedIssues.nodes[0].description // "No description"')
PARENT_ID=$(echo "$RESPONSE" | jq -r '.data.viewer.assignedIssues.nodes[0].parent.identifier // "none"')
PARENT_TITLE=$(echo "$RESPONSE" | jq -r '.data.viewer.assignedIssues.nodes[0].parent.title // ""')

EPIC_INFO="${PARENT_ID}"
if [ -n "$PARENT_TITLE" ] && [ "$PARENT_TITLE" != "null" ]; then
  EPIC_INFO="${PARENT_ID} — ${PARENT_TITLE}"
fi

BASE_BRANCH="${CLANCY_BASE_BRANCH:-main}"
TICKET_BRANCH="feature/$(echo "$IDENTIFIER" | tr '[:upper:]' '[:lower:]')"

# Auto-detect target branch from ticket's parent.
# If the issue has a parent, branch from epic/{parent-id} (creating it from
# BASE_BRANCH if it doesn't exist yet). Otherwise branch from BASE_BRANCH directly.
if [ "$PARENT_ID" != "none" ]; then
  TARGET_BRANCH="epic/$(echo "$PARENT_ID" | tr '[:upper:]' '[:lower:]')"
  git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH" \
    || git checkout -b "$TARGET_BRANCH" "$BASE_BRANCH"
else
  TARGET_BRANCH="$BASE_BRANCH"
fi

# ─── IMPLEMENT ─────────────────────────────────────────────────────────────────

echo "Picking up: [$IDENTIFIER] $TITLE"
echo "Epic: $EPIC_INFO | Target branch: $TARGET_BRANCH"

git checkout "$TARGET_BRANCH"
# -B creates the branch if it doesn't exist, or resets it to HEAD if it does.
# This handles retries cleanly without failing on an already-existing branch.
git checkout -B "$TICKET_BRANCH"

PROMPT="You are implementing Linear issue $IDENTIFIER.

Title: $TITLE
Epic: $EPIC_INFO

Description:
$DESCRIPTION

Before starting:
1. Read ALL docs in .clancy/docs/ — especially GIT.md for branching and commit conventions
2. Follow the conventions in GIT.md exactly
3. Implement the issue fully
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
  git commit -m "feat($IDENTIFIER): $TITLE"
fi

# Delete ticket branch locally
git branch -d "$TICKET_BRANCH"

# Log progress
echo "$(date '+%Y-%m-%d %H:%M') | $IDENTIFIER | $TITLE | DONE" >> .clancy/progress.txt

echo "✓ $IDENTIFIER complete."
