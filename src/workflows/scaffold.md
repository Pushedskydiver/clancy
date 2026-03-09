# Clancy Scaffold Workflow

## Overview

Shared scaffolding logic used during `/clancy:init`. Not a standalone command.

---

## Doc templates

Create these files in `.clancy/docs/` with section headings but no content:

### STACK.md
```markdown
# Stack

## Runtime

## Package Manager

## Frameworks

## Key Libraries

## Build Tools

## Dev Servers

## Environment
```

### INTEGRATIONS.md
```markdown
# Integrations

## External APIs

## Authentication

## Data Storage

## Third-party Services

## Environment Variables Required
```

### ARCHITECTURE.md
```markdown
# Architecture

## Overview

## Directory Structure

## Key Modules

## Data Flow

## API Design

## State Management
```

### CONVENTIONS.md
```markdown
# Conventions

## Code Style

## Naming Conventions

## File Organisation

## Component Patterns

## Error Handling

## Logging
```

### TESTING.md
```markdown
# Testing

## Test Runner

## Test Structure

## Unit Tests

## Integration Tests

## E2E Tests

## Coverage Expectations
```

### GIT.md
```markdown
# Git Conventions

## Branch Naming

## Commit Format

## Merge Strategy

## Pull Request Process

## Versioning
```

### DESIGN-SYSTEM.md
```markdown
# Design System

## Token System

## Component Library

## Theming

## Responsive Breakpoints

## Icon System
```

### ACCESSIBILITY.md
```markdown
# Accessibility

## WCAG Level

## ARIA Patterns

## Keyboard Navigation

## Focus Management

## Screen Reader Support
```

### DEFINITION-OF-DONE.md
```markdown
# Definition of Done

## Code Quality

## Testing

## Documentation

## Design

## Accessibility

## Review
```

### CONCERNS.md
```markdown
# Concerns

## Known Tech Debt

## Security Considerations

## Performance Bottlenecks

## Areas to Avoid Changing

## Deprecated Patterns
```

---

## PLAYWRIGHT.md template

Create `.clancy/docs/PLAYWRIGHT.md` when `PLAYWRIGHT_ENABLED=true`:

```markdown
# Playwright Visual Checks

Clancy runs visual checks after implementing UI tickets. This file defines
which server to use and how to start it.

## Decision Rule

Apply in order:
1. If the ticket mentions: route, page, screen, layout, full-page → use **dev server**
2. If the ticket mentions: component, atom, molecule, organism, variant, story → use **Storybook**
3. Ambiguous → default to **dev server**

## Dev Server

| Key | Value |
|---|---|
| Start command | `{PLAYWRIGHT_DEV_COMMAND}` |
| Port | `{PLAYWRIGHT_DEV_PORT}` |
| Health check | `http://localhost:{PLAYWRIGHT_DEV_PORT}` |
| Startup wait | {PLAYWRIGHT_STARTUP_WAIT}s (use health check polling, not sleep) |

## Storybook

<!-- Remove this section if Storybook is not used -->

| Key | Value |
|---|---|
| Start command | `{PLAYWRIGHT_STORYBOOK_COMMAND}` |
| Port | `{PLAYWRIGHT_STORYBOOK_PORT}` |
| Story URL pattern | `http://localhost:{PLAYWRIGHT_STORYBOOK_PORT}/?path=/story/{component-name}` |

## Visual Check Process

1. Determine which server to use (decision rule above)
2. Start the server using health check polling — poll every 2s, timeout after {PLAYWRIGHT_STARTUP_WAIT}s
3. Navigate to the relevant route or story URL
4. Screenshot the full page
5. Assess visually — check layout, spacing, colours, responsive behaviour
6. Check browser console for errors
7. Fix anything wrong before committing
8. Kill server by PID, then sweep the port unconditionally
9. Log result: `YYYY-MM-DD HH:MM | TICKET-KEY | PLAYWRIGHT_PASS|FAIL | dev-server|storybook`

## Server Health Check Pattern

```bash
# Start server in background
{PLAYWRIGHT_DEV_COMMAND} &
SERVER_PID=$!

# Poll until ready
MAX_WAIT={PLAYWRIGHT_STARTUP_WAIT}
ELAPSED=0
until curl -s http://localhost:{PLAYWRIGHT_DEV_PORT} >/dev/null 2>&1; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "Server did not start within ${MAX_WAIT}s"
    kill $SERVER_PID 2>/dev/null
    exit 1
  fi
done

# ... run visual check ...

# Cleanup — kill by PID, then sweep port unconditionally
kill $SERVER_PID 2>/dev/null
lsof -ti:{PLAYWRIGHT_DEV_PORT} | xargs kill -9 2>/dev/null || true
```
```

---

## CLAUDE.md merge logic

### If CLAUDE.md does not exist

Write the full template as `CLAUDE.md` (see `src/templates/CLAUDE.md`).

### If CLAUDE.md already exists

Check for existing `<!-- clancy:start -->` marker:
- Found: Replace everything between `<!-- clancy:start -->` and `<!-- clancy:end -->` with updated content
- Not found: Append the Clancy section to the end of the file

Never overwrite the entire file. Always preserve existing content.

---

## .gitignore check

Read the project's `.gitignore`. If `.clancy/.env` is not present, append:
```
# Clancy credentials
.clancy/.env
```

If no `.gitignore` exists, create one with:
```
# Clancy credentials
.clancy/.env

# Dependencies
node_modules/

# OS
.DS_Store
```

---

## Shell scripts

Write these scripts exactly as shown — do not generate, summarise, or modify the content. Write the file contents byte-for-byte.

### `.clancy/clancy-once.sh` — Jira

Write this file when the chosen board is **Jira**:

```bash
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

# Transition ticket to In Progress (best-effort — never fails the run)
if [ -n "${CLANCY_STATUS_IN_PROGRESS:-}" ]; then
  TRANSITIONS=$(curl -s \
    -u "$JIRA_USER:$JIRA_API_TOKEN" \
    -H "Accept: application/json" \
    "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/transitions")
  IN_PROGRESS_ID=$(echo "$TRANSITIONS" | jq -r \
    --arg name "$CLANCY_STATUS_IN_PROGRESS" \
    '.transitions[] | select(.name == $name) | .id' | head -1)
  if [ -n "$IN_PROGRESS_ID" ]; then
    curl -s -X POST \
      -u "$JIRA_USER:$JIRA_API_TOKEN" \
      -H "Content-Type: application/json" \
      "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/transitions" \
      -d "{\"transition\":{\"id\":\"$IN_PROGRESS_ID\"}}" >/dev/null 2>&1 || true
    echo "  → Transitioned to $CLANCY_STATUS_IN_PROGRESS"
  fi
fi

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

# Transition ticket to Done (best-effort — never fails the run)
if [ -n "${CLANCY_STATUS_DONE:-}" ]; then
  TRANSITIONS=$(curl -s \
    -u "$JIRA_USER:$JIRA_API_TOKEN" \
    -H "Accept: application/json" \
    "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/transitions")
  DONE_ID=$(echo "$TRANSITIONS" | jq -r \
    --arg name "$CLANCY_STATUS_DONE" \
    '.transitions[] | select(.name == $name) | .id' | head -1)
  if [ -n "$DONE_ID" ]; then
    curl -s -X POST \
      -u "$JIRA_USER:$JIRA_API_TOKEN" \
      -H "Content-Type: application/json" \
      "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/transitions" \
      -d "{\"transition\":{\"id\":\"$DONE_ID\"}}" >/dev/null 2>&1 || true
    echo "  → Transitioned to $CLANCY_STATUS_DONE"
  fi
fi

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
```

---

### `.clancy/clancy-once.sh` — GitHub Issues

Write this file when the chosen board is **GitHub Issues**:

```bash
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
1. Read core docs in .clancy/docs/: STACK.md, ARCHITECTURE.md, CONVENTIONS.md, GIT.md, DEFINITION-OF-DONE.md, CONCERNS.md
   Also read if relevant to this ticket: INTEGRATIONS.md (external APIs/services/auth), TESTING.md (tests/specs/coverage), DESIGN-SYSTEM.md (UI/components/styles), ACCESSIBILITY.md (accessibility/ARIA/WCAG)
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
```

---

### `.clancy/clancy-once.sh` — Linear

Write this file when the chosen board is **Linear**:

```bash
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

# Validate user-controlled values to prevent GraphQL injection.
# Values are passed via GraphQL variables (JSON-encoded by jq) rather than string-interpolated.
if ! echo "$LINEAR_TEAM_ID" | grep -qE '^[a-zA-Z0-9_-]+$'; then
  echo "✗ LINEAR_TEAM_ID contains invalid characters. Check .clancy/.env."
  exit 0
fi
if [ -n "${CLANCY_LABEL:-}" ] && ! echo "$CLANCY_LABEL" | grep -qE '^[a-zA-Z0-9 _-]+$'; then
  echo "✗ CLANCY_LABEL contains invalid characters. Use only letters, numbers, spaces, hyphens, and underscores."
  exit 0
fi

# Build request using GraphQL variables — values are JSON-encoded by jq, never interpolated into the query string.
# The label filter clause is only added to the query when CLANCY_LABEL is set, since passing null would match nothing.
if [ -n "${CLANCY_LABEL:-}" ]; then
  REQUEST_BODY=$(jq -n \
    --arg teamId "$LINEAR_TEAM_ID" \
    --arg label "$CLANCY_LABEL" \
    '{"query": "query($teamId: String!, $label: String) { viewer { assignedIssues(filter: { state: { type: { eq: \"unstarted\" } } team: { id: { eq: $teamId } } labels: { name: { eq: $label } } } first: 1 orderBy: priority) { nodes { id identifier title description parent { identifier title } } } } }", "variables": {"teamId": $teamId, "label": $label}}')
else
  REQUEST_BODY=$(jq -n \
    --arg teamId "$LINEAR_TEAM_ID" \
    '{"query": "query($teamId: String!) { viewer { assignedIssues(filter: { state: { type: { eq: \"unstarted\" } } team: { id: { eq: $teamId } } } first: 1 orderBy: priority) { nodes { id identifier title description parent { identifier title } } } } }", "variables": {"teamId": $teamId}}')
fi

RESPONSE=$(curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d "$REQUEST_BODY")

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

ISSUE_ID=$(echo "$RESPONSE" | jq -r '.data.viewer.assignedIssues.nodes[0].id')
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

# Transition issue to In Progress (best-effort — never fails the run).
# Queries team workflow states by type "started", picks the first match.
if [ -n "${CLANCY_STATUS_IN_PROGRESS:-}" ]; then
  STATE_RESP=$(curl -s -X POST https://api.linear.app/graphql \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    -d "$(jq -n --arg teamId "$LINEAR_TEAM_ID" --arg name "$CLANCY_STATUS_IN_PROGRESS" \
      '{"query": "query($teamId: String!, $name: String!) { workflowStates(filter: { team: { id: { eq: $teamId } } name: { eq: $name } }) { nodes { id } } }", "variables": {"teamId": $teamId, "name": $name}}')")
  IN_PROGRESS_STATE_ID=$(echo "$STATE_RESP" | jq -r '.data.workflowStates.nodes[0].id // empty')
  if [ -n "$IN_PROGRESS_STATE_ID" ]; then
    curl -s -X POST https://api.linear.app/graphql \
      -H "Content-Type: application/json" \
      -H "Authorization: $LINEAR_API_KEY" \
      -d "$(jq -n --arg issueId "$ISSUE_ID" --arg stateId "$IN_PROGRESS_STATE_ID" \
        '{"query": "mutation($issueId: String!, $stateId: String!) { issueUpdate(id: $issueId, input: { stateId: $stateId }) { success } }", "variables": {"issueId": $issueId, "stateId": $stateId}}')" \
      >/dev/null 2>&1 || true
    echo "  → Transitioned to $CLANCY_STATUS_IN_PROGRESS"
  fi
fi

PROMPT="You are implementing Linear issue $IDENTIFIER.

Title: $TITLE
Epic: $EPIC_INFO

Description:
$DESCRIPTION

Step 0 — Executability check (do this before any git or file operation):
Read the issue title and description above. Can this issue be implemented entirely
as a code change committed to this repo? Consult the 'Executability check' section of
CLAUDE.md for the full list of skip conditions.

If you must SKIP this issue:
1. Output: ⚠ Skipping [$IDENTIFIER]: {one-line reason}
2. Output: Ticket skipped — update it to be codebase-only work, then re-run.
3. Append to .clancy/progress.txt: YYYY-MM-DD HH:MM | $IDENTIFIER | SKIPPED | {reason}
4. Stop — no branches, no file changes, no git operations.

If the issue IS implementable, continue:
1. Read core docs in .clancy/docs/: STACK.md, ARCHITECTURE.md, CONVENTIONS.md, GIT.md, DEFINITION-OF-DONE.md, CONCERNS.md
   Also read if relevant to this ticket: INTEGRATIONS.md (external APIs/services/auth), TESTING.md (tests/specs/coverage), DESIGN-SYSTEM.md (UI/components/styles), ACCESSIBILITY.md (accessibility/ARIA/WCAG)
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

# Transition issue to Done (best-effort — never fails the run).
if [ -n "${CLANCY_STATUS_DONE:-}" ]; then
  STATE_RESP=$(curl -s -X POST https://api.linear.app/graphql \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    -d "$(jq -n --arg teamId "$LINEAR_TEAM_ID" --arg name "$CLANCY_STATUS_DONE" \
      '{"query": "query($teamId: String!, $name: String!) { workflowStates(filter: { team: { id: { eq: $teamId } } name: { eq: $name } }) { nodes { id } } }", "variables": {"teamId": $teamId, "name": $name}}')")
  DONE_STATE_ID=$(echo "$STATE_RESP" | jq -r '.data.workflowStates.nodes[0].id // empty')
  if [ -n "$DONE_STATE_ID" ]; then
    curl -s -X POST https://api.linear.app/graphql \
      -H "Content-Type: application/json" \
      -H "Authorization: $LINEAR_API_KEY" \
      -d "$(jq -n --arg issueId "$ISSUE_ID" --arg stateId "$DONE_STATE_ID" \
        '{"query": "mutation($issueId: String!, $stateId: String!) { issueUpdate(id: $issueId, input: { stateId: $stateId }) { success } }", "variables": {"issueId": $issueId, "stateId": $stateId}}')" \
      >/dev/null 2>&1 || true
    echo "  → Transitioned to $CLANCY_STATUS_DONE"
  fi
fi

# Log progress
echo "$(date '+%Y-%m-%d %H:%M') | $IDENTIFIER | $TITLE | DONE" >> .clancy/progress.txt

echo "✓ $IDENTIFIER complete."

# Send completion notification if webhook is configured
if [ -n "${CLANCY_NOTIFY_WEBHOOK:-}" ]; then
  NOTIFY_MSG="✓ Clancy completed [$IDENTIFIER] $TITLE"
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
```

---

### `.clancy/clancy-afk.sh` — all boards

Write this file regardless of board choice:

```bash
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
```

---

## .env.example files

Write the correct `.env.example` for the chosen board to `.clancy/.env.example`.

### Jira

```
# Clancy — Jira configuration
# Copy this file to .env and fill in your values.
# Never commit .env to version control.

# ─── Jira ─────────────────────────────────────────────────────────────────────
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_USER=your-email@example.com
JIRA_API_TOKEN=your-api-token-from-id.atlassian.com
JIRA_PROJECT_KEY=PROJ

# Status name for "ready to be picked up" (default: To Do)
# Must be quoted if the status name contains spaces (e.g. "Selected for Development")
CLANCY_JQL_STATUS="To Do"

# Set to any non-empty value to filter by open sprints (requires Jira Software)
# Remove or leave empty if your project doesn't use sprints
# CLANCY_JQL_SPRINT=true

# Optional: only pick up tickets with this label. Recommended for mixed backlogs
# where not every ticket is suitable for autonomous implementation (e.g. non-code tasks).
# Create the label in Jira first, then add it to any ticket you want Clancy to pick up.
# CLANCY_LABEL="clancy"

# ─── Git ──────────────────────────────────────────────────────────────────────
# Base integration branch. Clancy branches from here when a ticket has no parent epic.
# When a ticket has a parent epic, Clancy auto-creates epic/{key} from this branch.
CLANCY_BASE_BRANCH=main

# ─── Loop ─────────────────────────────────────────────────────────────────────
# Max tickets to process per /clancy:run session (default: 5)
MAX_ITERATIONS=5

# ─── Model ────────────────────────────────────────────────────────────────────
# Claude model used for each ticket session. Leave unset to use the default.
# Options: claude-opus-4-6 | claude-sonnet-4-6 | claude-haiku-4-5
# CLANCY_MODEL=claude-sonnet-4-6

# ─── Optional: Figma MCP ──────────────────────────────────────────────────────
# Fetch design specs from Figma when a ticket has a Figma URL in its description
# FIGMA_API_KEY=your-figma-api-key

# ─── Optional: Playwright visual checks ───────────────────────────────────────
# Run a visual check after implementing UI tickets
# PLAYWRIGHT_ENABLED=true
# PLAYWRIGHT_DEV_COMMAND="yarn dev"
# PLAYWRIGHT_DEV_PORT=5173
# PLAYWRIGHT_STORYBOOK_COMMAND="yarn storybook"
# PLAYWRIGHT_STORYBOOK_PORT=6006
# PLAYWRIGHT_STARTUP_WAIT=15

# ─── Optional: Status transitions ────────────────────────────────────────────
# Move tickets automatically when Clancy picks up or completes them.
# Set to the exact status name shown in your Jira board column header.
# CLANCY_STATUS_IN_PROGRESS="In Progress"
# CLANCY_STATUS_DONE="Done"

# ─── Optional: Notifications ──────────────────────────────────────────────────
# Webhook URL for Slack or Teams notifications on ticket completion
# CLANCY_NOTIFY_WEBHOOK=https://hooks.slack.com/services/your/webhook/url
```

### GitHub Issues

```
# Clancy — GitHub Issues configuration
# Copy this file to .env and fill in your values.
# Never commit .env to version control.

# ─── GitHub Issues ────────────────────────────────────────────────────────────
GITHUB_TOKEN=ghp_your-personal-access-token
GITHUB_REPO=owner/repo-name

# Optional: only pick up issues with this label (in addition to 'clancy').
# Useful for mixed backlogs where not every issue is suitable for autonomous implementation.
# Create the label in GitHub first, then add it to any issue you want Clancy to pick up.
# CLANCY_LABEL=clancy

# ─── Git ──────────────────────────────────────────────────────────────────────
# Base integration branch. Clancy branches from here when an issue has no milestone.
# When an issue has a milestone, Clancy auto-creates milestone/{slug} from this branch.
CLANCY_BASE_BRANCH=main

# ─── Loop ─────────────────────────────────────────────────────────────────────
# Max tickets to process per /clancy:run session (default: 20)
MAX_ITERATIONS=20

# ─── Model ────────────────────────────────────────────────────────────────────
# Claude model used for each ticket session. Leave unset to use the default.
# Options: claude-opus-4-6 | claude-sonnet-4-6 | claude-haiku-4-5
# CLANCY_MODEL=claude-sonnet-4-6

# ─── Optional: Figma MCP ──────────────────────────────────────────────────────
# Fetch design specs from Figma when a ticket has a Figma URL in its description
# FIGMA_API_KEY=your-figma-api-key

# ─── Optional: Playwright visual checks ───────────────────────────────────────
# Run a visual check after implementing UI tickets
# PLAYWRIGHT_ENABLED=true
# PLAYWRIGHT_DEV_COMMAND="yarn dev"
# PLAYWRIGHT_DEV_PORT=5173
# PLAYWRIGHT_STORYBOOK_COMMAND="yarn storybook"
# PLAYWRIGHT_STORYBOOK_PORT=6006
# PLAYWRIGHT_STARTUP_WAIT=15

# ─── Optional: Notifications ──────────────────────────────────────────────────
# Webhook URL for Slack or Teams notifications on ticket completion
# CLANCY_NOTIFY_WEBHOOK=https://hooks.slack.com/services/your/webhook/url
```

### Linear

```
# Clancy — Linear configuration
# Copy this file to .env and fill in your values.
# Never commit .env to version control.

# ─── Linear ───────────────────────────────────────────────────────────────────
LINEAR_API_KEY=lin_api_your-personal-api-key
LINEAR_TEAM_ID=your-team-uuid

# Optional: only pick up issues with this label. Recommended for mixed backlogs
# where not every issue is suitable for autonomous implementation (e.g. non-code tasks).
# Create the label in Linear first, then add it to any issue you want Clancy to pick up.
# CLANCY_LABEL=clancy

# ─── Git ──────────────────────────────────────────────────────────────────────
# Base integration branch. Clancy branches from here when an issue has no parent.
# When an issue has a parent, Clancy auto-creates epic/{key} from this branch.
CLANCY_BASE_BRANCH=main

# ─── Loop ─────────────────────────────────────────────────────────────────────
# Max tickets to process per /clancy:run session (default: 20)
MAX_ITERATIONS=20

# ─── Model ────────────────────────────────────────────────────────────────────
# Claude model used for each ticket session. Leave unset to use the default.
# Options: claude-opus-4-6 | claude-sonnet-4-6 | claude-haiku-4-5
# CLANCY_MODEL=claude-sonnet-4-6

# ─── Optional: Figma MCP ──────────────────────────────────────────────────────
# Fetch design specs from Figma when a ticket has a Figma URL in its description
# FIGMA_API_KEY=your-figma-api-key

# ─── Optional: Playwright visual checks ───────────────────────────────────────
# Run a visual check after implementing UI tickets
# PLAYWRIGHT_ENABLED=true
# PLAYWRIGHT_DEV_COMMAND="yarn dev"
# PLAYWRIGHT_DEV_PORT=5173
# PLAYWRIGHT_STORYBOOK_COMMAND="yarn storybook"
# PLAYWRIGHT_STORYBOOK_PORT=6006
# PLAYWRIGHT_STARTUP_WAIT=15

# ─── Optional: Status transitions ────────────────────────────────────────────
# Move issues automatically when Clancy picks up or completes them.
# Set to the exact workflow state name shown in your Linear board column header.
# CLANCY_STATUS_IN_PROGRESS="In Progress"
# CLANCY_STATUS_DONE="Done"

# ─── Optional: Notifications ──────────────────────────────────────────────────
# Webhook URL for Slack or Teams notifications on ticket completion
# CLANCY_NOTIFY_WEBHOOK=https://hooks.slack.com/services/your/webhook/url
```
