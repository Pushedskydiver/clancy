#!/usr/bin/env bash
set -euo pipefail

# Board: Linear

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

# Fetch one unstarted issue assigned to the current user on the configured team.
# state.type "unstarted" is a fixed enum — filters by state type, not state name.
# This works regardless of what the team named their "To Do" column.
# Note: personal API keys do NOT use "Bearer" prefix — this is intentional.
RESPONSE=$(curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d "{
    \"query\": \"{ viewer { assignedIssues(filter: { state: { type: { eq: \\\"unstarted\\\" } } team: { id: { eq: \\\"$LINEAR_TEAM_ID\\\" } } } first: 1 orderBy: priority) { nodes { id identifier title description parent { identifier title } } } } }\"
  }")

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

echo "Picking up: [$IDENTIFIER] $TITLE"
echo "Epic: $EPIC_INFO | Target branch: $TARGET_BRANCH"

git checkout "$TARGET_BRANCH"
git checkout -b "$TICKET_BRANCH"

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

echo "$PROMPT" | claude --dangerously-skip-permissions

# Squash merge back into target branch
git checkout "$TARGET_BRANCH"
git merge --squash "$TICKET_BRANCH"
git commit -m "feat($IDENTIFIER): $TITLE"

# Delete ticket branch locally
git branch -d "$TICKET_BRANCH"

# Log progress
echo "$(date '+%Y-%m-%d %H:%M') | $IDENTIFIER | $TITLE | DONE" >> .clancy/progress.txt

echo "✓ $IDENTIFIER complete."
