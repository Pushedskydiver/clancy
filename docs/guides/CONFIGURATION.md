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
CLANCY_STATUS_REVIEW="In Review"
```

Clancy moves tickets on your board when it picks up and completes implementation. Best-effort — a failed transition never stops the run. Configurable via `/clancy:settings`.

`CLANCY_STATUS_REVIEW` is used when Clancy creates a PR (no-parent flow) instead of merging locally. If not set, falls back to `CLANCY_STATUS_DONE`.

**Jira:** Set these to the Jira **transition name** (the action label, e.g. "In Progress", "Done"). Note: in some Jira workflows the transition name differs from the destination column name (e.g. transition "Start Progress" moves to column "In Progress"). Check your Jira workflow if transitions aren't working — the value must match the transition action name, not the column header. `CLANCY_STATUS_DONE` doesn't have to mean "Done" — set it to whatever transition moves tickets to your post-implementation column.

**Linear:** Set these to the exact workflow state name shown in your Linear team settings (e.g. "In Progress", "Done", "Ready for Review").

**GitHub:** Issues don't have status columns — they're `open` or `closed`. Clancy uses **labels as queues** (e.g. `needs-refinement` → `clancy`) and closes issues on completion. Status transition env vars are ignored for GitHub.

## Strategist

```
CLANCY_MODE=interactive
CLANCY_BRIEF_ISSUE_TYPE=Story
CLANCY_BRIEF_EPIC=PROJ-100
CLANCY_COMPONENT=backend
```

`CLANCY_MODE` controls how the grill phase runs: `interactive` (default) interviews the human, `afk` uses the AI-grill agent autonomously. Override per-invocation with `--afk`.

`CLANCY_BRIEF_ISSUE_TYPE` sets the issue type for tickets created by `/clancy:approve-brief` (e.g. `Story`, `Task`). Defaults to the board's default issue type.

`CLANCY_BRIEF_EPIC` sets the parent epic for all tickets created by `/clancy:approve-brief`. Each child ticket's description includes `Epic: {key}` for cross-platform epic completion detection.

`CLANCY_COMPONENT` limits the strategist's research and ticket scope to a specific component or platform area of the codebase.

## Verification gates

```
CLANCY_FIX_RETRIES=2
CLANCY_VERIFY_COMMANDS="npm test,npm run lint,npm run typecheck"
```

Clancy runs lint, test, and typecheck before delivery. If checks fail, Clancy retries up to `CLANCY_FIX_RETRIES` times (default 2, range 0–5). Set to `0` to disable self-healing (checks still run, but failures go straight to the PR with a warning). Override auto-detected commands with `CLANCY_VERIFY_COMMANDS`.

## Time guard

```
CLANCY_TIME_LIMIT=30
```

Minutes allowed per ticket. At 80% a warning is injected; at 100% Clancy is told to commit and deliver. Set to `0` to disable. Default: 30.

## Cost logging

```
CLANCY_TOKEN_RATE=6600
```

Estimated tokens per minute for duration-based cost logging. Each ticket's cost estimate is appended to `.clancy/costs.log`. Default: 6600.

## Branch guard

```
CLANCY_BRANCH_GUARD=true
```

PreToolUse hook that blocks force push, direct push to protected branches, and destructive resets. Enabled by default. Set to `false` to disable.

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
| `CLANCY_PLAN_STATE_TYPE` | Linear | No | `backlog` | Planning queue state type (enum: backlog, unstarted, started, completed, canceled, triage) |
| `CLANCY_STATUS_PLANNED` | Jira | No | — | Transition status after plan approval |
| `CLANCY_SKIP_COMMENTS` | All | No | `true` | Post a comment when skipping a ticket |
| `CLANCY_STATUS_IN_PROGRESS` | Jira/Linear | No | — | Status when picking up a ticket |
| `CLANCY_STATUS_DONE` | Jira/Linear | No | — | Status when completing a ticket |
| `CLANCY_STATUS_REVIEW` | Jira/Linear | No | — | Status when creating a PR (falls back to `CLANCY_STATUS_DONE`) |
| `CLANCY_MAX_REWORK` | All | No | `3` | Max rework cycles before human intervention |
| `CLANCY_TDD` | All | No | — | Enable test-driven development (red-green-refactor) |
| `CLANCY_MODE` | All | No | `interactive` | Grill mode: `interactive` (human) or `afk` (AI-grill). Override per-invocation with `--afk` |
| `CLANCY_BRIEF_ISSUE_TYPE` | All | No | Board default | Issue type for tickets created by `/clancy:approve-brief` (e.g. `Story`, `Task`) |
| `CLANCY_BRIEF_EPIC` | All | No | — | Parent epic key for tickets created by `/clancy:approve-brief` (e.g. `PROJ-100`, `#50`) |
| `CLANCY_COMPONENT` | All | No | — | Component/platform filter — limits strategist research and ticket scope to a specific area |
| `GITLAB_TOKEN` | All | No | — | GitLab personal access token (for PR creation) |
| `BITBUCKET_USER` | All | No | — | Bitbucket username (for PR creation) |
| `BITBUCKET_TOKEN` | All | No | — | Bitbucket app password (for PR creation) |
| `CLANCY_GIT_PLATFORM` | All | No | — | Override git host detection (`github`/`gitlab`/`bitbucket`) |
| `CLANCY_GIT_API_URL` | All | No | — | Self-hosted git instance API base URL |
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
| `CLANCY_FIX_RETRIES` | All | No | `2` | Self-healing retry attempts when verification fails (range 0–5) |
| `CLANCY_VERIFY_COMMANDS` | All | No | Auto-detect | Comma-separated verification commands (e.g. `npm test,npm run lint`) |
| `CLANCY_TOKEN_RATE` | All | No | `6600` | Estimated tokens per minute for cost logging |
| `CLANCY_TIME_LIMIT` | All | No | `30` | Minutes per ticket before time guard warnings (0 to disable) |
| `CLANCY_BRANCH_GUARD` | All | No | `true` | Enable branch guard hook (blocks force push, protected branches, destructive resets) |

**Note on rework detection:** Rework is detected automatically from PR comments: inline code comments always trigger rework, and conversation comments trigger with a `Rework:` prefix. On GitHub, a `CHANGES_REQUESTED` review state is an additional trigger. `CLANCY_MAX_REWORK` controls the safety limit for rework cycles.

**Note on connectivity:** Clancy runs a connectivity preflight check (`git ls-remote origin HEAD`) before every run. If the remote is unreachable, a warning is printed but the run continues — PR creation and rework detection may fail, but local work proceeds normally. See the [Troubleshooting guide](TROUBLESHOOTING.md) for details.
