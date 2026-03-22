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

## Pipeline labels

```
CLANCY_LABEL_BRIEF="clancy:brief"
CLANCY_LABEL_PLAN="clancy:plan"
CLANCY_LABEL_BUILD="clancy:build"
```

Pipeline labels control ticket flow through Clancy's stages. Each label acts as a queue marker:

1. `/clancy:brief` adds `CLANCY_LABEL_BRIEF` to the ticket
2. `/clancy:approve-brief` removes `CLANCY_LABEL_BRIEF`, adds `CLANCY_LABEL_PLAN` to children (or `CLANCY_LABEL_BUILD` with `--skip-plan`)
3. `/clancy:approve-plan` removes `CLANCY_LABEL_PLAN`, adds `CLANCY_LABEL_BUILD`
4. `/clancy:once` filters the queue by `CLANCY_LABEL_BUILD`

Label transitions use add-before-remove ordering for crash safety — a ticket briefly has two labels rather than zero.

### Deprecated label vars

`CLANCY_LABEL` and `CLANCY_PLAN_LABEL` are deprecated. They still work as fallbacks:

- `CLANCY_LABEL_BUILD` falls back to `CLANCY_LABEL` if not set
- `CLANCY_LABEL_PLAN` falls back to `CLANCY_PLAN_LABEL` if not set

Existing users see no change until they explicitly set the new vars. New installs use the pipeline label defaults.

## Strategist

```
CLANCY_MODE=interactive
CLANCY_BRIEF_ISSUE_TYPE=Story
CLANCY_BRIEF_EPIC=PROJ-100
CLANCY_COMPONENT=backend
```

`CLANCY_MODE` controls how the grill phase runs and whether confirmations are skipped: `interactive` (default) interviews the human and prompts for confirmation, `afk` uses the AI-grill agent and auto-confirms all prompts. Override per-invocation with `--afk`. The `--afk` flag is supported on `/clancy:brief`, `/clancy:approve-brief`, `/clancy:plan`, and `/clancy:approve-plan`.

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

## Quiet hours

```
CLANCY_QUIET_START=22:00
CLANCY_QUIET_END=06:00
```

Pauses AFK runs during the configured window. The AFK runner checks before each iteration — if the current time is within quiet hours, it sleeps until the end of the window, then resumes. Handles overnight windows (e.g. `22:00`–`06:00`). Both vars must be set; if only one is present, the check is skipped with a warning.

## Desktop notifications

```
CLANCY_DESKTOP_NOTIFY=true
```

Native OS desktop notifications on Notification events. Uses platform detection: macOS (osascript), Linux (notify-send), Windows (PowerShell). Falls back to `console.log` if the OS command fails. Set to `false` to suppress.

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
| GitHub | No label filter by default. Set `CLANCY_LABEL_BUILD` (or `CLANCY_LABEL`) for a dedicated queue | `CLANCY_LABEL_BUILD` (falls back to `CLANCY_LABEL`) |
| Linear | `state.type: "unstarted"` | (hardcoded — not customisable) |

### Planning queue

| Board | Default filter | Env var |
| --- | --- | --- |
| Jira | `status = "Backlog"` | `CLANCY_PLAN_STATUS` |
| GitHub | Label: `clancy:plan` (or `needs-refinement`) | `CLANCY_LABEL_PLAN` (falls back to `CLANCY_PLAN_LABEL`) |
| Linear | `state.type: "backlog"` | `CLANCY_PLAN_STATE_TYPE` |

### Additional filters

| Filter | Env var | Applies to | Notes |
| --- | --- | --- | --- |
| Sprint filter | `CLANCY_JQL_SPRINT` | Jira (both queues) | Adds `AND sprint in openSprints()` |
| Build label filter | `CLANCY_LABEL_BUILD` (falls back to `CLANCY_LABEL`) | Jira (implementation only), GitHub (implementation only) | Excludes tickets with `CLANCY_LABEL_PLAN` (dual-label guard) |
| Plan label filter | `CLANCY_LABEL_PLAN` (falls back to `CLANCY_PLAN_LABEL`) | GitHub (planning only), Jira (supplementary when set) | Jira/Linear primarily use status-based filtering for planning queue |
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
| `CLANCY_LABEL` | All | No | — | **Deprecated** — use `CLANCY_LABEL_BUILD`. Label filter for tickets |
| `CLANCY_LABEL_BRIEF` | All | No | `clancy:brief` | Pipeline label for briefed tickets (awaiting approval) |
| `CLANCY_LABEL_PLAN` | All | No | `clancy:plan` | Pipeline label for tickets needing planning (falls back to `CLANCY_PLAN_LABEL`) |
| `CLANCY_LABEL_BUILD` | All | No | `clancy:build` | Pipeline label for tickets ready to build (falls back to `CLANCY_LABEL`) |
| `CLANCY_JQL_STATUS` | Jira | No | `To Do` | Implementation queue status |
| `CLANCY_JQL_SPRINT` | Jira | No | — | Enable sprint filtering |
| `CLANCY_PLAN_STATUS` | Jira | No | `Backlog` | Planning queue status |
| `CLANCY_PLAN_LABEL` | GitHub | No | `needs-refinement` | **Deprecated** — use `CLANCY_LABEL_PLAN`. Planning queue label |
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
| `CLANCY_QUIET_START` | All | No | — | Quiet hours start time (HH:MM 24h format, e.g. `22:00`) |
| `CLANCY_QUIET_END` | All | No | — | Quiet hours end time (HH:MM 24h format, e.g. `06:00`) |
| `CLANCY_DESKTOP_NOTIFY` | All | No | `true` | Enable native OS desktop notifications (`false` to suppress) |
| `SHORTCUT_API_TOKEN` | Shortcut | Yes | — | Shortcut API token |
| `SHORTCUT_WORKFLOW` | Shortcut | No | Auto-detect | Shortcut workflow name |
| `NOTION_TOKEN` | Notion | Yes | — | Notion integration token |
| `NOTION_DATABASE_ID` | Notion | Yes | — | Notion database ID (32-char hex) |
| `CLANCY_NOTION_STATUS` | Notion | No | `Status` | Status property name |
| `CLANCY_NOTION_TODO` | Notion | No | `To-do` | Status value name for the implementation queue (e.g. `Not started`) |
| `CLANCY_NOTION_ASSIGNEE` | Notion | No | `Assignee` | Assignee property name |
| `CLANCY_NOTION_LABELS` | Notion | No | — | Labels property name |
| `CLANCY_NOTION_PARENT` | Notion | No | — | Parent relation property name |
| `AZDO_ORG` | Azure DevOps | Yes | — | Azure DevOps organisation name |
| `AZDO_PROJECT` | Azure DevOps | Yes | — | Azure DevOps project name |
| `AZDO_PAT` | Azure DevOps | Yes | — | Azure DevOps personal access token |

**Note on rework detection:** Rework is detected automatically from PR comments: inline code comments always trigger rework, and conversation comments trigger with a `Rework:` prefix. On GitHub, a `CHANGES_REQUESTED` review state is an additional trigger. `CLANCY_MAX_REWORK` controls the safety limit for rework cycles.

**Note on connectivity:** Clancy runs a connectivity preflight check (`git ls-remote origin HEAD`) before every run. If the remote is unreachable, a warning is printed but the run continues — PR creation and rework detection may fail, but local work proceeds normally. See the [Troubleshooting guide](TROUBLESHOOTING.md) for details.
