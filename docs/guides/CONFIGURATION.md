# Configuration

Set during `/clancy:init` advanced setup, or by editing `.clancy/.env` directly. Use `/clancy:settings` → "Save as defaults" to save non-credential settings to `~/.clancy/defaults.json` — new projects created with `/clancy:init` will inherit them automatically.

## Figma MCP

```
FIGMA_API_KEY=your-key
```

When a ticket description contains a Figma URL, Clancy fetches design specs automatically:

1. Figma MCP: `get_metadata` → `get_design_context` → `get_screenshot` (3 calls)
2. Figma REST API image export (fallback)
3. Ticket image attachment (fallback)

## Playwright visual checks

```
PLAYWRIGHT_ENABLED=true
PLAYWRIGHT_DEV_COMMAND="yarn dev"
PLAYWRIGHT_DEV_PORT=5173
PLAYWRIGHT_STORYBOOK_COMMAND="yarn storybook"  # if applicable
PLAYWRIGHT_STORYBOOK_PORT=6006                 # if applicable
PLAYWRIGHT_STARTUP_WAIT=15
```

After implementing a UI ticket, Clancy starts the dev server or Storybook, screenshots, assesses visually, checks the console, and fixes anything wrong before committing.

## Status transitions

```
CLANCY_STATUS_IN_PROGRESS="In Progress"
CLANCY_STATUS_DONE="Ready for Review"
```

Clancy moves tickets on your board when it picks up and completes implementation. Best-effort — a failed transition never stops the run. Configurable via `/clancy:settings`.

**Jira / Linear:** Set these to the exact column name shown in your board. `CLANCY_STATUS_DONE` doesn't have to mean "Done" — set it to wherever tickets should go after implementation (e.g. "Ready for Review", "Peer Review", "Ready for QA"). Clancy calls the board API to transition the ticket status.

**GitHub:** Issues don't have status columns — they're `open` or `closed`. Clancy uses **labels as queues** (e.g. `needs-refinement` → `clancy`) and closes issues on completion. Status transition env vars are ignored for GitHub.

## Notifications

```
CLANCY_NOTIFY_WEBHOOK=https://hooks.slack.com/services/your/webhook/url
```

Posts to Slack or Teams when a ticket completes. The payload format (Slack vs Teams) is inferred from the webhook URL you provide.

## Queue filters

### Implementation queue

| Board | Default filter | Env var |
| --- | --- | --- |
| Jira | `status = "To Do"` | `CLANCY_JQL_STATUS` |
| GitHub | No label filter by default (all open issues assigned to you). Set `CLANCY_LABEL=clancy` for a dedicated queue | `CLANCY_LABEL` |
| Linear | `state.type: "unstarted"` | (hardcoded — not customisable) |

### Planning queue

| Board | Default filter | Env var |
| --- | --- | --- |
| Jira | `status = "Backlog"` | `CLANCY_PLAN_STATUS` |
| GitHub | Label: `needs-refinement` | `CLANCY_PLAN_LABEL` |
| Linear | `state.type: "backlog"` | `CLANCY_PLAN_STATE_TYPE` |

### Additional filters

| Filter | Env var | Applies to | Notes |
| --- | --- | --- | --- |
| Sprint filter | `CLANCY_JQL_SPRINT` | Jira (both queues) | Adds `AND sprint in openSprints()` |
| Label filter | `CLANCY_LABEL` | Jira (both queues), GitHub (implementation only) | GitHub planning uses `CLANCY_PLAN_LABEL` instead |
| Assignment | — | All boards (both queues) | Always `assignee = currentUser()` |

## All environment variables

| Variable | Board | Required | Default | Purpose |
| --- | --- | --- | --- | --- |
| `JIRA_BASE_URL` | Jira | Yes | — | Your Jira instance URL |
| `JIRA_USER` | Jira | Yes | — | Your Jira email |
| `JIRA_API_TOKEN` | Jira | Yes | — | Jira API token |
| `JIRA_PROJECT_KEY` | Jira | Yes | — | Project key (e.g. `PROJ`) |
| `GITHUB_TOKEN` | GitHub | Yes | — | GitHub personal access token |
| `GITHUB_REPO` | GitHub | Yes | — | Repo in `owner/repo` format |
| `LINEAR_API_KEY` | Linear | Yes | — | Linear personal API key (no Bearer prefix) |
| `LINEAR_TEAM_ID` | Linear | Yes | — | Linear team ID |
| `CLANCY_LABEL` | All | No | — | Label filter for tickets |
| `CLANCY_JQL_STATUS` | Jira | No | `To Do` | Implementation queue status |
| `CLANCY_JQL_SPRINT` | Jira | No | — | Enable sprint filtering |
| `CLANCY_PLAN_STATUS` | Jira | No | `Backlog` | Planning queue status |
| `CLANCY_PLAN_LABEL` | GitHub | No | `needs-refinement` | Planning queue label |
| `CLANCY_PLAN_STATE_TYPE` | Linear | No | `backlog` | Planning queue state type |
| `CLANCY_STATUS_IN_PROGRESS` | Jira/Linear | No | — | Status when picking up a ticket |
| `CLANCY_STATUS_DONE` | Jira/Linear | No | — | Status when completing a ticket |
| `CLANCY_NOTIFY_WEBHOOK` | All | No | — | Slack/Teams webhook URL |
| `CLANCY_ROLES` | All | No | — | Comma-separated optional roles |
| `CLANCY_MODEL` | All | No | — | Claude model for ticket sessions |
| `CLANCY_BASE_BRANCH` | All | No | `main` | Base branch for merges |
| `MAX_ITERATIONS` | All | No | `5` | Max tickets per `/clancy:run` |
| `FIGMA_API_KEY` | All | No | — | Figma API key for design specs |
| `PLAYWRIGHT_ENABLED` | All | No | — | Enable visual checks |
| `PLAYWRIGHT_DEV_COMMAND` | All | No | — | Dev server start command |
| `PLAYWRIGHT_DEV_PORT` | All | No | — | Dev server port |
| `PLAYWRIGHT_STORYBOOK_COMMAND` | All | No | — | Storybook start command |
| `PLAYWRIGHT_STORYBOOK_PORT` | All | No | — | Storybook port |
| `PLAYWRIGHT_STARTUP_WAIT` | All | No | `15` | Seconds to wait for server |
