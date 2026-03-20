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

## .prettierignore check

Check whether a `.prettierignore` file exists in the project root.

**If it exists:** read it. If it does not already contain `.clancy/`, append:
```
# Clancy generated files
.clancy/
.claude/commands/clancy/
```

**If it does not exist:** skip — do not create it. Clancy only adds entries to an existing `.prettierignore` so it does not impose Prettier on projects that don't use it.

---

## Runtime scripts

The installer copies bundled runtime scripts (`clancy-once.js` and `clancy-afk.js`) directly into `.clancy/` during installation. These are self-contained — they have zero runtime dependency on the `chief-clancy` npm package.

**Do NOT write or modify these files during init.** They are managed by the installer and updated automatically via `/clancy:update`.

If the scripts are missing (e.g. upgrading from an older version), tell the user to run:
```bash
npx -y chief-clancy@latest
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

# ─── Implementation Queue ─────────────────────────────────────────────────────
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
# Set to the Jira transition name (the action label, not the column header).
# In many workflows these match, but check your Jira workflow if transitions fail.
# "Done" can be any transition to a post-implementation status.
# CLANCY_STATUS_IN_PROGRESS="In Progress"
# CLANCY_STATUS_DONE="Done"
# CLANCY_STATUS_REVIEW="In Review"        # used when creating a PR instead of merging locally

# ─── Optional: Git host (PR creation) ───────────────────────────────────────
# When a ticket has no parent epic, Clancy pushes the feature branch and creates
# a pull request instead of squash-merging locally. Requires a git host token.
# GitHub Issues users already have GITHUB_TOKEN above — no extra config needed.
# GITHUB_TOKEN=ghp_your-token              # if your git host is GitHub
# GITLAB_TOKEN=glpat-your-token            # if your git host is GitLab
# BITBUCKET_USER=your-username             # if your git host is Bitbucket
# BITBUCKET_TOKEN=your-app-password        # if your git host is Bitbucket
# CLANCY_GIT_PLATFORM=gitlab               # override auto-detection (github/gitlab/bitbucket)
# CLANCY_GIT_API_URL=https://gitlab.example.com/api/v4  # self-hosted git API base URL

# ─── Optional: Pipeline labels ────────────────────────────────────────────────
# Labels that control ticket flow through pipeline stages.
# CLANCY_LABEL_BRIEF marks tickets that have been briefed (awaiting approval).
# CLANCY_LABEL_PLAN marks tickets that need planning.
# CLANCY_LABEL_BUILD marks tickets ready for implementation.
# Deprecated: CLANCY_LABEL (use CLANCY_LABEL_BUILD), CLANCY_PLAN_LABEL (use CLANCY_LABEL_PLAN)
# CLANCY_LABEL_BRIEF="clancy:brief"
# CLANCY_LABEL_PLAN="clancy:plan"
# CLANCY_LABEL_BUILD="clancy:build"

# ─── Optional: Rework loop ──────────────────────────────────────────────────
# PR-based rework is automatic — when a reviewer leaves inline comments or
# a conversation comment prefixed with "Rework:", Clancy picks it up on the
# next run. No configuration needed.
# CLANCY_MAX_REWORK=3                    # Max rework cycles before human intervention (default: 3)

# ─── Optional: Test-Driven Development ──────────────────────────────────────
# When enabled, Clancy follows red-green-refactor for every behaviour change.
# CLANCY_TDD=true

# ─── Optional: Grill mode ───────────────────────────────────────────────────
# Controls how /clancy:brief handles clarifying questions before generating a brief.
# "interactive" (default) — asks the human. "afk" — AI-grill resolves autonomously.
# Can also be overridden per-invocation with --afk flag.
# CLANCY_MODE=interactive

# ─── Optional: Strategist ───────────────────────────────────────────────────
# Issue type for tickets created by /clancy:brief (Jira only, default: Task)
# CLANCY_BRIEF_ISSUE_TYPE="Task"

# Default parent epic for briefs created from text or file input
# CLANCY_BRIEF_EPIC="PROJ-100"

# Auto-set on tickets created by /clancy:brief.
# Only affects ticket creation — does not filter the implementation queue.
# CLANCY_COMPONENT="frontend"

# ─── Optional: Planner queue ─────────────────────────────────────────────────
# Status for backlog tickets that /clancy:plan fetches from (default: Backlog)
# Only used if Planner role is enabled via CLANCY_ROLES
# CLANCY_PLAN_STATUS="Backlog"

# After approving a plan, transition the ticket to this status (e.g. "To Do")
# CLANCY_STATUS_PLANNED="To Do"

# ─── Optional: Skip comments ──────────────────────────────────────────────
# When Clancy skips a ticket (irrelevant/infeasible), post a comment explaining why
# Set to "false" to disable skip comments
# CLANCY_SKIP_COMMENTS=true

# ─── Optional: Reliable autonomous mode ───────────────────────────────────────
# Max self-healing attempts after verification failure (default: 2, range 0-5)
# CLANCY_FIX_RETRIES=2

# Per-ticket time limit in minutes (default: 30, 0 to disable)
# CLANCY_TIME_LIMIT=30

# Prevent accidental commits to the base branch (default: true)
# CLANCY_BRANCH_GUARD=true

# ─── Optional: Quiet hours ───────────────────────────────────────────────────
# Pause AFK runs during these hours (24h format). Handles overnight windows.
# CLANCY_QUIET_START=22:00
# CLANCY_QUIET_END=06:00

# ─── Optional: Desktop notifications ─────────────────────────────────────────
# Native OS notifications on ticket completion or error (default: true)
# CLANCY_DESKTOP_NOTIFY=true

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

# Recommended: only pick up issues with this label.
# Without this, Clancy picks up all open issues assigned to you.
# Create the label in GitHub first, then add it to any issue you want Clancy to pick up.
# CLANCY_LABEL="clancy"

# ─── Planner Queue (optional — requires CLANCY_ROLES to include "planner") ───
# Label for backlog issues that /clancy:plan fetches from (default: needs-refinement)
# CLANCY_PLAN_LABEL="needs-refinement"

# ─── Git ──────────────────────────────────────────────────────────────────────
# Base integration branch. Clancy branches from here when an issue has no milestone.
# When an issue has a milestone, Clancy auto-creates milestone/{slug} from this branch.
CLANCY_BASE_BRANCH=main

# ─── PR creation ─────────────────────────────────────────────────────────────
# When an issue has no milestone, Clancy pushes the feature branch and creates a
# PR using your GITHUB_TOKEN above. No extra config needed for GitHub Issues users.

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

# ─── Optional: Pipeline labels ────────────────────────────────────────────────
# Labels that control ticket flow through pipeline stages.
# CLANCY_LABEL_BRIEF marks tickets that have been briefed (awaiting approval).
# CLANCY_LABEL_PLAN marks tickets that need planning.
# CLANCY_LABEL_BUILD marks tickets ready for implementation.
# Deprecated: CLANCY_LABEL (use CLANCY_LABEL_BUILD), CLANCY_PLAN_LABEL (use CLANCY_LABEL_PLAN)
# CLANCY_LABEL_BRIEF="clancy:brief"
# CLANCY_LABEL_PLAN="clancy:plan"
# CLANCY_LABEL_BUILD="clancy:build"

# ─── Optional: Rework loop ──────────────────────────────────────────────────
# PR-based rework is automatic — when a reviewer leaves inline comments or
# a conversation comment prefixed with "Rework:", Clancy picks it up on the
# next run. No configuration needed.
# CLANCY_MAX_REWORK=3                    # Max rework cycles before human intervention (default: 3)

# ─── Optional: Test-Driven Development ──────────────────────────────────────
# When enabled, Clancy follows red-green-refactor for every behaviour change.
# CLANCY_TDD=true

# ─── Optional: Grill mode ───────────────────────────────────────────────────
# Controls how /clancy:brief handles clarifying questions before generating a brief.
# "interactive" (default) — asks the human. "afk" — AI-grill resolves autonomously.
# Can also be overridden per-invocation with --afk flag.
# CLANCY_MODE=interactive

# ─── Optional: Strategist ───────────────────────────────────────────────────
# Default parent epic/milestone for briefs created from text or file input
# CLANCY_BRIEF_EPIC="#42"

# Auto-set on tickets created by /clancy:brief.
# Only affects ticket creation — does not filter the implementation queue.
# CLANCY_COMPONENT="frontend"

# ─── Optional: Skip comments ──────────────────────────────────────────────
# When Clancy skips a ticket (irrelevant/infeasible), post a comment explaining why
# Set to "false" to disable skip comments
# CLANCY_SKIP_COMMENTS=true

# ─── Optional: Reliable autonomous mode ───────────────────────────────────────
# Max self-healing attempts after verification failure (default: 2, range 0-5)
# CLANCY_FIX_RETRIES=2

# Per-ticket time limit in minutes (default: 30, 0 to disable)
# CLANCY_TIME_LIMIT=30

# Prevent accidental commits to the base branch (default: true)
# CLANCY_BRANCH_GUARD=true

# ─── Optional: Notifications ──────────────────────────────────────────────────
# Webhook URL for Slack or Teams notifications on ticket completion
# ─── Optional: Quiet hours ───────────────────────────────────────────────────
# CLANCY_QUIET_START=22:00
# CLANCY_QUIET_END=06:00

# ─── Optional: Desktop notifications ─────────────────────────────────────────
# CLANCY_DESKTOP_NOTIFY=true

# ─── Optional: Notifications ──────────────────────────────────────────────────
# CLANCY_NOTIFY_WEBHOOK=https://hooks.slack.com/services/your/webhook/url
```

### Shortcut

```
# Clancy — Shortcut configuration
# Copy this file to .env and fill in your values.
# Never commit .env to version control.

# ─── Shortcut ────────────────────────────────────────────────────────────────
SHORTCUT_API_TOKEN=your-api-token

# Optional: workflow name (default: auto-detect first workflow)
# SHORTCUT_WORKFLOW=Engineering

# ─── Implementation Queue ─────────────────────────────────────────────────────
# Status name for "ready to be picked up" (default: Unstarted)
# CLANCY_SC_STATUS="Unstarted"

# ─── Git ──────────────────────────────────────────────────────────────────────
CLANCY_BASE_BRANCH=main

# ─── Loop ─────────────────────────────────────────────────────────────────────
MAX_ITERATIONS=5

# ─── Optional: Git host (PR creation) ───────────────────────────────────────
# GITHUB_TOKEN=ghp_your-token
# GITLAB_TOKEN=glpat-your-token
# BITBUCKET_USER=your-username
# BITBUCKET_TOKEN=your-app-password

# ─── Optional: Pipeline labels ────────────────────────────────────────────────
# CLANCY_LABEL_BRIEF="clancy:brief"
# CLANCY_LABEL_PLAN="clancy:plan"
# CLANCY_LABEL_BUILD="clancy:build"

# ─── Optional: Status transitions ────────────────────────────────────────────
# CLANCY_STATUS_IN_PROGRESS="In Progress"
# CLANCY_STATUS_DONE="Done"
# CLANCY_STATUS_REVIEW="In Review"

# ─── Optional: Quiet hours ───────────────────────────────────────────────────
# CLANCY_QUIET_START=22:00
# CLANCY_QUIET_END=06:00

# ─── Optional: Desktop notifications ─────────────────────────────────────────
# CLANCY_DESKTOP_NOTIFY=true

# ─── Optional: Notifications ──────────────────────────────────────────────────
# CLANCY_NOTIFY_WEBHOOK=https://hooks.slack.com/services/your/webhook/url
```

### Notion

```
# Clancy — Notion configuration
# Copy this file to .env and fill in your values.
# Never commit .env to version control.

# ─── Notion ──────────────────────────────────────────────────────────────────
NOTION_TOKEN=your-integration-token
NOTION_DATABASE_ID=your-database-id-32-char-hex

# Optional: property name overrides (defaults shown)
# NOTION_STATUS_PROP=Status
# NOTION_ASSIGNEE_PROP=Assignee

# ─── Git ──────────────────────────────────────────────────────────────────────
CLANCY_BASE_BRANCH=main

# ─── Loop ─────────────────────────────────────────────────────────────────────
MAX_ITERATIONS=5

# ─── Optional: Git host (PR creation) ───────────────────────────────────────
# GITHUB_TOKEN=ghp_your-token
# GITLAB_TOKEN=glpat-your-token
# BITBUCKET_USER=your-username
# BITBUCKET_TOKEN=your-app-password

# ─── Optional: Pipeline labels ────────────────────────────────────────────────
# CLANCY_LABEL_BRIEF="clancy:brief"
# CLANCY_LABEL_PLAN="clancy:plan"
# CLANCY_LABEL_BUILD="clancy:build"

# ─── Optional: Quiet hours ───────────────────────────────────────────────────
# CLANCY_QUIET_START=22:00
# CLANCY_QUIET_END=06:00

# ─── Optional: Desktop notifications ─────────────────────────────────────────
# CLANCY_DESKTOP_NOTIFY=true

# ─── Optional: Notifications ──────────────────────────────────────────────────
# CLANCY_NOTIFY_WEBHOOK=https://hooks.slack.com/services/your/webhook/url
```

### Azure DevOps

```
# Clancy — Azure DevOps configuration
# Copy this file to .env and fill in your values.
# Never commit .env to version control.

# ─── Azure DevOps ────────────────────────────────────────────────────────────
AZDO_ORG=your-organisation
AZDO_PROJECT=your-project
AZDO_PAT=your-personal-access-token

# ─── Git ──────────────────────────────────────────────────────────────────────
CLANCY_BASE_BRANCH=main

# ─── Loop ─────────────────────────────────────────────────────────────────────
MAX_ITERATIONS=5

# ─── Optional: Git host (PR creation) ───────────────────────────────────────
# GITHUB_TOKEN=ghp_your-token
# GITLAB_TOKEN=glpat-your-token
# BITBUCKET_USER=your-username
# BITBUCKET_TOKEN=your-app-password

# ─── Optional: Pipeline labels ────────────────────────────────────────────────
# CLANCY_LABEL_BRIEF="clancy:brief"
# CLANCY_LABEL_PLAN="clancy:plan"
# CLANCY_LABEL_BUILD="clancy:build"

# ─── Optional: Status transitions ────────────────────────────────────────────
# CLANCY_STATUS_IN_PROGRESS="Active"
# CLANCY_STATUS_DONE="Closed"
# CLANCY_STATUS_REVIEW="Resolved"

# ─── Optional: Quiet hours ───────────────────────────────────────────────────
# CLANCY_QUIET_START=22:00
# CLANCY_QUIET_END=06:00

# ─── Optional: Desktop notifications ─────────────────────────────────────────
# CLANCY_DESKTOP_NOTIFY=true

# ─── Optional: Notifications ──────────────────────────────────────────────────
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

# ─── Planner Queue (optional — requires CLANCY_ROLES to include "planner") ───
# State type for issues that /clancy:plan fetches from (default: backlog)
# Valid values: backlog, unstarted, started, completed, canceled, triage
# CLANCY_PLAN_STATE_TYPE="backlog"

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
# Set to the exact workflow state name shown in your Linear team settings.
# "Done" can be any post-implementation state (e.g. "Ready for Review", "In Review").
# CLANCY_STATUS_IN_PROGRESS="In Progress"
# CLANCY_STATUS_DONE="Done"
# CLANCY_STATUS_REVIEW="In Review"        # used when creating a PR instead of merging locally

# ─── Optional: Rework loop ──────────────────────────────────────────────────
# PR-based rework is automatic — when a reviewer leaves inline comments or
# a conversation comment prefixed with "Rework:", Clancy picks it up on the
# next run. No configuration needed.
# CLANCY_MAX_REWORK=3                    # Max rework cycles before human intervention (default: 3)

# ─── Optional: Test-Driven Development ──────────────────────────────────────
# When enabled, Clancy follows red-green-refactor for every behaviour change.
# CLANCY_TDD=true

# ─── Optional: Grill mode ───────────────────────────────────────────────────
# Controls how /clancy:brief handles clarifying questions before generating a brief.
# "interactive" (default) — asks the human. "afk" — AI-grill resolves autonomously.
# Can also be overridden per-invocation with --afk flag.
# CLANCY_MODE=interactive

# ─── Optional: Strategist ───────────────────────────────────────────────────
# Default parent epic for briefs created from text or file input
# CLANCY_BRIEF_EPIC="ENG-50"

# Auto-set on tickets created by /clancy:brief.
# Only affects ticket creation — does not filter the implementation queue.
# CLANCY_COMPONENT="frontend"

# ─── Optional: Git host (PR creation) ───────────────────────────────────────
# When an issue has no parent, Clancy pushes the feature branch and creates a
# pull request instead of squash-merging locally. Requires a git host token.
# GITHUB_TOKEN=ghp_your-token              # if your git host is GitHub
# GITLAB_TOKEN=glpat-your-token            # if your git host is GitLab
# BITBUCKET_USER=your-username             # if your git host is Bitbucket
# BITBUCKET_TOKEN=your-app-password        # if your git host is Bitbucket
# CLANCY_GIT_PLATFORM=gitlab               # override auto-detection (github/gitlab/bitbucket)
# CLANCY_GIT_API_URL=https://gitlab.example.com/api/v4  # self-hosted git API base URL

# ─── Optional: Pipeline labels ────────────────────────────────────────────────
# Labels that control ticket flow through pipeline stages.
# CLANCY_LABEL_BRIEF marks tickets that have been briefed (awaiting approval).
# CLANCY_LABEL_PLAN marks tickets that need planning.
# CLANCY_LABEL_BUILD marks tickets ready for implementation.
# Deprecated: CLANCY_LABEL (use CLANCY_LABEL_BUILD), CLANCY_PLAN_LABEL (use CLANCY_LABEL_PLAN)
# CLANCY_LABEL_BRIEF="clancy:brief"
# CLANCY_LABEL_PLAN="clancy:plan"
# CLANCY_LABEL_BUILD="clancy:build"

# ─── Optional: Reliable autonomous mode ───────────────────────────────────────
# Max self-healing attempts after verification failure (default: 2, range 0-5)
# CLANCY_FIX_RETRIES=2

# Per-ticket time limit in minutes (default: 30, 0 to disable)
# CLANCY_TIME_LIMIT=30

# Prevent accidental commits to the base branch (default: true)
# CLANCY_BRANCH_GUARD=true

# ─── Optional: Skip comments ──────────────────────────────────────────────
# When Clancy skips a ticket (irrelevant/infeasible), post a comment explaining why
# Set to "false" to disable skip comments
# CLANCY_SKIP_COMMENTS=true

# ─── Optional: Quiet hours ───────────────────────────────────────────────────
# CLANCY_QUIET_START=22:00
# CLANCY_QUIET_END=06:00

# ─── Optional: Desktop notifications ─────────────────────────────────────────
# CLANCY_DESKTOP_NOTIFY=true

# ─── Optional: Notifications ──────────────────────────────────────────────────
# Webhook URL for Slack or Teams notifications on ticket completion
# CLANCY_NOTIFY_WEBHOOK=https://hooks.slack.com/services/your/webhook/url
```
