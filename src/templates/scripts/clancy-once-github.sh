#!/usr/bin/env bash
set -euo pipefail

# Board: GitHub Issues

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

[ -n "${GITHUB_TOKEN:-}"  ] || { echo "✗ GITHUB_TOKEN is not set in .clancy/.env";  exit 0; }
[ -n "${GITHUB_REPO:-}"   ] || { echo "✗ GITHUB_REPO is not set in .clancy/.env";   exit 0; }

PING=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO")

case "$PING" in
  200) ;;
  401) echo "✗ GitHub authentication failed. Check GITHUB_TOKEN in .clancy/.env."; exit 0 ;;
  403) echo "✗ GitHub access denied. Your token may lack the repo scope."; exit 0 ;;
  404) echo "✗ GitHub repo '$GITHUB_REPO' not found. Check GITHUB_REPO in .clancy/.env."; exit 0 ;;
  000) echo "✗ Could not reach GitHub. Check your network."; exit 0 ;;
  *)   echo "✗ GitHub returned unexpected status $PING. Check your config."; exit 0 ;;
esac

if [ "${PLAYWRIGHT_ENABLED:-}" = "true" ]; then
  if lsof -ti:"${PLAYWRIGHT_DEV_PORT:-5173}" >/dev/null 2>&1; then
    echo "⚠ Port ${PLAYWRIGHT_DEV_PORT:-5173} is already in use."
    echo "  If visual checks fail, stop whatever is using the port first."
  fi
fi

echo "✓ Preflight passed. Starting Clancy..."

# ─── END PREFLIGHT ─────────────────────────────────────────────────────────────

# Fetch open issues assigned to the authenticated user with the 'clancy' label.
# GitHub's issues endpoint returns PRs too — filter them out by checking for pull_request key.
# per_page=3 so we can find one real issue even if the first result(s) are PRs.
RESPONSE=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/issues?state=open&assignee=@me&labels=clancy&per_page=3")

# Filter out PRs and take first real issue
ISSUE=$(echo "$RESPONSE" | jq 'map(select(has("pull_request") | not)) | .[0]')

if [ "$(echo "$ISSUE" | jq 'type')" = '"null"' ] || [ -z "$(echo "$ISSUE" | jq -r '.number // empty')" ]; then
  echo "No issues found. All done!"
  exit 0
fi

ISSUE_NUMBER=$(echo "$ISSUE" | jq -r '.number')
TITLE=$(echo "$ISSUE" | jq -r '.title')
BODY=$(echo "$ISSUE" | jq -r '.body // "No description"')
MILESTONE=$(echo "$ISSUE" | jq -r '.milestone.title // "none"')

BASE_BRANCH="${CLANCY_BASE_BRANCH:-main}"
TICKET_BRANCH="feature/issue-${ISSUE_NUMBER}"

# GitHub has no native epic concept — use milestone as the grouping signal.
# If the issue has a milestone, branch from milestone/{slug} (creating it from
# BASE_BRANCH if it doesn't exist yet). Otherwise branch from BASE_BRANCH directly.
if [ "$MILESTONE" != "none" ]; then
  MILESTONE_SLUG=$(echo "$MILESTONE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
  TARGET_BRANCH="milestone/${MILESTONE_SLUG}"
  git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH" \
    || git checkout -b "$TARGET_BRANCH" "$BASE_BRANCH"
else
  TARGET_BRANCH="$BASE_BRANCH"
fi

echo "Picking up: [#${ISSUE_NUMBER}] $TITLE"
echo "Milestone: $MILESTONE | Target branch: $TARGET_BRANCH"

git checkout "$TARGET_BRANCH"
git checkout -b "$TICKET_BRANCH"

PROMPT="You are implementing GitHub Issue #${ISSUE_NUMBER}.

Title: $TITLE
Milestone: $MILESTONE

Description:
$BODY

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
git commit -m "feat(#${ISSUE_NUMBER}): $TITLE"

# Delete ticket branch locally
git branch -d "$TICKET_BRANCH"

# Close the issue
curl -s -X PATCH \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/$GITHUB_REPO/issues/${ISSUE_NUMBER}" \
  -d '{"state": "closed"}' \
  >/dev/null

# Log progress
echo "$(date '+%Y-%m-%d %H:%M') | #${ISSUE_NUMBER} | $TITLE | DONE" >> .clancy/progress.txt

echo "✓ #${ISSUE_NUMBER} complete."
