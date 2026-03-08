#!/usr/bin/env bash
# Strict mode: exit on error (-e), undefined variables (-u), pipe failures (-o pipefail).
# This means any command that fails will stop the script immediately rather than silently continuing.
set -euo pipefail

# ─── WHAT THIS SCRIPT DOES ─────────────────────────────────────────────────────
#
# Board: GitHub Issues
#
# 1. Preflight  — checks all required tools, credentials, and repo reachability
# 2. Fetch      — pulls the next open issue with the 'clancy' label assigned to you
# 3. Branch     — creates a feature branch from the issue's milestone branch (or base branch)
# 4. Implement  — passes the issue to Claude Code, which reads .clancy/docs/ and implements it
# 5. Merge      — squash-merges the feature branch back into the target branch
# 6. Close      — marks the GitHub issue as closed via the API
# 7. Log        — appends a completion entry to .clancy/progress.txt
#
# This script is run once per issue. The loop is handled by clancy-afk.sh.
#
# NOTE: GitHub's /issues endpoint returns pull requests too. This script filters
# them out by checking for the presence of the 'pull_request' key in each result.
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

[ -n "${GITHUB_TOKEN:-}"  ] || { echo "✗ GITHUB_TOKEN is not set in .clancy/.env";  exit 0; }
[ -n "${GITHUB_REPO:-}"   ] || { echo "✗ GITHUB_REPO is not set in .clancy/.env";   exit 0; }

# Validate GITHUB_REPO format — must be owner/repo with safe characters only
if ! echo "$GITHUB_REPO" | grep -qE '^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$'; then
  echo "✗ GITHUB_REPO format is invalid. Expected owner/repo (e.g. acme/my-app). Check GITHUB_REPO in .clancy/.env."
  exit 0
fi

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

# ─── FETCH ISSUE ───────────────────────────────────────────────────────────────

# Fetch open issues assigned to the authenticated user with the 'clancy' label.
# GitHub's issues endpoint returns PRs too — filter them out by checking for pull_request key.
# per_page=3 so we can find one real issue even if the first result(s) are PRs.
RESPONSE=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/issues?state=open&assignee=@me&labels=clancy&per_page=3")

# Verify response is an array before parsing (guards against error objects on rate limit / transient failure)
if ! echo "$RESPONSE" | jq -e 'type == "array"' >/dev/null 2>&1; then
  ERR_MSG=$(echo "$RESPONSE" | jq -r '.message // "Unexpected response"' 2>/dev/null || echo "Unexpected response")
  echo "✗ GitHub API error: $ERR_MSG. Check GITHUB_TOKEN in .clancy/.env."
  exit 0
fi

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

# ─── IMPLEMENT ─────────────────────────────────────────────────────────────────

echo "Picking up: [#${ISSUE_NUMBER}] $TITLE"
echo "Milestone: $MILESTONE | Target branch: $TARGET_BRANCH"

git checkout "$TARGET_BRANCH"
# -B creates the branch if it doesn't exist, or resets it to HEAD if it does.
# This handles retries cleanly without failing on an already-existing branch.
git checkout -B "$TICKET_BRANCH"

PROMPT="You are implementing GitHub Issue #${ISSUE_NUMBER}.

Title: $TITLE
Milestone: $MILESTONE

Description:
$BODY

Step 0 — Executability check (do this before any git or file operation):
Read the issue title and description above. Can this issue be implemented entirely
as a code change committed to this repo? Consult the 'Executability check' section of
CLAUDE.md for the full list of skip conditions.

If you must SKIP this issue:
1. Output: ⚠ Skipping [#${ISSUE_NUMBER}]: {one-line reason}
2. Output: Ticket skipped — update it to be codebase-only work, then re-run.
3. Append to .clancy/progress.txt: YYYY-MM-DD HH:MM | #${ISSUE_NUMBER} | SKIPPED | {reason}
4. Stop — no branches, no file changes, no git operations.

If the issue IS implementable, continue:
1. Read ALL docs in .clancy/docs/ — especially GIT.md for branching and commit conventions
2. Follow the conventions in GIT.md exactly
3. Implement the issue fully
4. Commit your work following the conventions in GIT.md
5. When done, confirm you are finished."

CLAUDE_ARGS=(--dangerously-skip-permissions)
[ -n "${CLANCY_MODEL:-}" ] && CLAUDE_ARGS+=(--model "$CLANCY_MODEL")
echo "$PROMPT" | claude "${CLAUDE_ARGS[@]}"

# ─── MERGE, CLOSE & LOG ────────────────────────────────────────────────────────

# Squash all commits from the feature branch into a single commit on the target branch.
git checkout "$TARGET_BRANCH"
git merge --squash "$TICKET_BRANCH"
if git diff --cached --quiet; then
  echo "⚠ No changes staged after squash merge. Claude may not have committed any work."
else
  git commit -m "feat(#${ISSUE_NUMBER}): $TITLE"
fi

# Delete ticket branch locally
git branch -d "$TICKET_BRANCH"

# Close the issue — warn but don't fail if this doesn't go through
CLOSE_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/$GITHUB_REPO/issues/${ISSUE_NUMBER}" \
  -d '{"state": "closed"}')
[ "$CLOSE_HTTP" = "200" ] || echo "⚠ Could not close issue #${ISSUE_NUMBER} (HTTP $CLOSE_HTTP). Close it manually on GitHub."

# Log progress
echo "$(date '+%Y-%m-%d %H:%M') | #${ISSUE_NUMBER} | $TITLE | DONE" >> .clancy/progress.txt

echo "✓ #${ISSUE_NUMBER} complete."

# Send completion notification if webhook is configured
if [ -n "${CLANCY_NOTIFY_WEBHOOK:-}" ]; then
  NOTIFY_MSG="✓ Clancy completed [#${ISSUE_NUMBER}] $TITLE"
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
