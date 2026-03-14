# Clancy Settings Workflow

## Overview

View and change Clancy configuration. Reads `.clancy/.env`, shows current values, and lets the user update any setting interactively. Loops until the user exits. Never modifies anything other than `.clancy/.env`.

### Input handling

This workflow runs inside a Claude Code session. Accept natural language alongside option codes:
- "G1", "max iterations", "change iterations" → all resolve to the max iterations setting
- "enable planner", "R1", "planner" → all resolve to the Planner role toggle
- "switch board", "S" → switch board flow
- If a response is ambiguous, ask for clarification

---

## Step 1 — Preflight

Check `.clancy/` exists and `.clancy/.env` is present.

If either is missing:

```
.clancy/ not found. Run /clancy:init to set up Clancy first.
```

Stop.

---

## Step 2 — Read current config

Source `.clancy/.env` silently. Detect which board is configured:
- `JIRA_BASE_URL` set → Jira
- `GITHUB_TOKEN` set → GitHub Issues
- `LINEAR_API_KEY` set → Linear

---

## Step 3 — Display settings menu

Show all current values. Board-specific settings only appear when that board is configured. Use stable letter/number mnemonics so options don't shift when boards change.

```
🚨 Clancy — Settings
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Welcome to headquarters."

General
  [G1] Max iterations    {MAX_ITERATIONS:-5}          tickets per /clancy:run session
  [G2] Claude model      {CLANCY_MODEL:-default}     model used for each ticket session
  [G3] Base branch       {CLANCY_BASE_BRANCH:-main}
  [G4] Max rework        {CLANCY_MAX_REWORK:-3}

{If Jira:}
Jira
  [B1] Queue status      {CLANCY_JQL_STATUS:-To Do}
  [B2] Sprint filter     {on if CLANCY_JQL_SPRINT set, else off}
  [B3] Label filter      {CLANCY_LABEL if set, else off}
  [B4] Pickup status     {CLANCY_STATUS_IN_PROGRESS if set, else off}
  [B5] Done status       {CLANCY_STATUS_DONE if set, else off}
  [B6] Review status     {CLANCY_STATUS_REVIEW if set, else "uses Done status"}
  [B7] Rework status     {CLANCY_STATUS_REWORK if set, else off}

{If GitHub:}
GitHub
  [B1] Rework label      {CLANCY_REWORK_LABEL if set, else off}

{If Linear:}
Linear
  [B1] Label filter      {CLANCY_LABEL if set, else off}
  [B2] Pickup status     {CLANCY_STATUS_IN_PROGRESS if set, else off}
  [B3] Done status       {CLANCY_STATUS_DONE if set, else off}
  [B4] Review status     {CLANCY_STATUS_REVIEW if set, else "uses Done state"}
  [B5] Rework status     {CLANCY_STATUS_REWORK if set, else off}

Roles
  [R1] Planner           {✅ enabled / ─ disabled}

{If Planner enabled:}
Planner
{If Jira:}
  [P1] Plan queue status  {CLANCY_PLAN_STATUS:-Backlog}
{If GitHub:}
  [P1] Plan label         {CLANCY_PLAN_LABEL:-needs-refinement}
{If Linear:}
  [P1] Plan state type    {CLANCY_PLAN_STATE_TYPE:-backlog}

Git Host (PR creation)
  [H1] Git host token    {platform: GitHub/GitLab/Bitbucket or "not set"}

Integrations
  [I1] Figma MCP         {enabled if FIGMA_API_KEY set, else not set}
  [I2] Playwright        {enabled if PLAYWRIGHT_ENABLED=true, else off}
  [I3] Notifications     {configured if CLANCY_NOTIFY_WEBHOOK set, else not set}

  [S]  Switch board      currently: {Jira / GitHub Issues / Linear}
  [D]  Save as defaults  save current settings for all future projects
  [X]  Exit

Which setting would you like to change?
```

Accept the user's response as a code (e.g. "G1", "R1"), a setting name (e.g. "max iterations", "model"), or a natural language description (e.g. "change the model", "enable planner"). If ambiguous, clarify. Show only the board-specific section that matches the configured board. The Planner section only appears when the Planner role is enabled.

---

## Step 4 — Handle each selection

After the user picks an option (by code, name, or description), handle it as below. After saving, print `✅ Saved.` and loop back to Step 3 to show the updated menu.

---

### [G1] Max iterations

```
Max iterations — current: {value}
How many tickets should /clancy:run process per session?

[1] 5 (default)
[2] Enter a different number
```

Validate the input is a positive integer between 1 and 100. If invalid, re-prompt.

Write `MAX_ITERATIONS=<value>` to `.clancy/.env`.

---

### [G2] Claude model

```
Claude model — current: {value or "default"}

[1] Default (Claude picks the best available model)
[2] claude-opus-4-6     — most capable, slower
[3] claude-sonnet-4-6   — balanced (recommended)
[4] claude-haiku-4-5    — fastest, lightest
[5] Enter a custom model ID
[6] Clear (revert to default)
```

If the user picks [1] or [6]: remove `CLANCY_MODEL` from `.clancy/.env` (or leave it commented out).
Otherwise: write `CLANCY_MODEL=<value>` to `.clancy/.env`.

---

### [G3] Base branch

```
Base branch — current: {value}
Branch Clancy uses as the integration target when a ticket has no parent epic.

Enter new value (or press enter to keep current):
```

Write `CLANCY_BASE_BRANCH=<value>` to `.clancy/.env`.

---

### [G4] Max rework cycles

```
Max rework cycles — current: {value or 3}
After this many rework cycles on a single ticket, Clancy flags it for human intervention.

[1] 3 (default)
[2] Enter a different number
[3] Cancel
```

Validate the input is a positive integer between 1 and 20. If invalid, re-prompt.

If [1]: remove `CLANCY_MAX_REWORK` from `.clancy/.env` (uses default).
If [2]: prompt `How many rework cycles before human intervention?` then write `CLANCY_MAX_REWORK=<value>` to `.clancy/.env`.

---

### [B1] Jira status filter (Jira only)

```
Jira status filter — current: {value}
Which status name should Clancy pick tickets from?
Common values: To Do, Selected for Development, Ready, Open

[1] To Do (default)
[2] Enter a different value
```

Write `CLANCY_JQL_STATUS=<value>` to `.clancy/.env`.

---

### [B2] Jira sprint filter (Jira only)

```
Jira sprint filter — current: {on / off}
Filter tickets to the active sprint? (Requires Jira Software)

[1] On
[2] Off (default)
```

If on: write `CLANCY_JQL_SPRINT=true` to `.clancy/.env`.
If off: remove `CLANCY_JQL_SPRINT` from `.clancy/.env` (or comment it out).

---

### [B3] Jira label filter (Jira only)

```
Jira label filter — current: {label name or "off"}
Only pick up tickets with this label. Useful for mixed backlogs
where some tickets are not suitable for autonomous implementation.

[1] Set label name
[2] Off (pick up all assigned tickets regardless of label)
[3] Cancel
```

If [1]: prompt `What label should Clancy filter by? (must already exist in Jira)` then write `CLANCY_LABEL=<value>` to `.clancy/.env`.
If [2]: remove `CLANCY_LABEL` from `.clancy/.env`.

---

### [B4] Jira In Progress status (Jira only)

```
Jira In Progress status — current: {value or "off"}
When set, Clancy moves a ticket to this status when it starts working on it.
Must match the exact column name shown in your Jira board.

[1] Set status name
[2] Off (do not transition on pickup)
[3] Cancel
```

If [1]: prompt `What status name should Clancy use for In Progress? (e.g. In Progress, In Dev, Doing)` then write `CLANCY_STATUS_IN_PROGRESS=<value>` to `.clancy/.env`.
If [2]: remove `CLANCY_STATUS_IN_PROGRESS` from `.clancy/.env`.

---

### [B5] Jira Done status (Jira only)

```
Jira Done status — current: {value or "off"}
When set, Clancy moves a ticket to this status after completing it.
Must match the exact column name shown in your Jira board.

[1] Set status name
[2] Off (do not transition on completion)
[3] Cancel
```

If [1]: prompt `What status name should Clancy use for Done? (e.g. Done, Complete, Closed)` then write `CLANCY_STATUS_DONE=<value>` to `.clancy/.env`.
If [2]: remove `CLANCY_STATUS_DONE` from `.clancy/.env`.

---

### [B6] Jira Review status (Jira only)

```
Jira Review status — current: {value or "uses Done status"}
When Clancy creates a pull request (instead of merging locally), it transitions
the ticket to this status. Falls back to CLANCY_STATUS_DONE if not set.

[1] Set status name
[2] Off (use Done status for PR flow too)
[3] Cancel
```

If [1]: prompt `What status name should Clancy use for In Review? (e.g. In Review, Ready for Review, Code Review)` then write `CLANCY_STATUS_REVIEW=<value>` to `.clancy/.env`.
If [2]: remove `CLANCY_STATUS_REVIEW` from `.clancy/.env`.

---

### [B7] Jira Rework status (Jira only)

```
Jira Rework status — current: {value or "off"}
When a reviewer sends a ticket back for changes, Clancy picks it up again
with feedback context. Set to the Jira status name for rework tickets.

[1] Set status name
[2] Off (disable rework loop)
[3] Cancel
```

If [1]: prompt `What status name represents "sent back for changes"? (e.g. Rework, Changes Requested)` then write `CLANCY_STATUS_REWORK=<value>` to `.clancy/.env`. Wrap in double quotes.
If [2]: remove `CLANCY_STATUS_REWORK` from `.clancy/.env`.

---

### [B1] GitHub Rework label (GitHub only)

```
GitHub Rework label — current: {value or "off"}
When a reviewer sends an issue back for changes, Clancy picks it up again
with feedback context. Requires a label on the issue.

[1] Set label name
[2] Off (disable rework loop)
[3] Cancel
```

If [1]: prompt `What label marks issues for rework? (e.g. needs-changes)` then write `CLANCY_REWORK_LABEL=<value>` to `.clancy/.env`. Wrap in double quotes.
If [2]: remove `CLANCY_REWORK_LABEL` from `.clancy/.env`.

---

### [B1] Linear label filter (Linear only)

```
Linear label filter — current: {label name or "off"}
Only pick up issues with this label. Useful for mixed backlogs
where some issues are not suitable for autonomous implementation.

[1] Set label name
[2] Off (pick up all unstarted assigned issues regardless of label)
[3] Cancel
```

If [1]: prompt `What label should Clancy filter by? (must already exist in your Linear team)` then write `CLANCY_LABEL=<value>` to `.clancy/.env`.
If [2]: remove `CLANCY_LABEL` from `.clancy/.env`.

---

### [B2] Linear In Progress status (Linear only)

```
Linear In Progress status — current: {value or "off"}
When set, Clancy moves an issue to this workflow state when it starts working on it.
Must match the exact state name shown in your Linear board column header.

[1] Set state name
[2] Off (do not transition on pickup)
[3] Cancel
```

If [1]: prompt `What workflow state name should Clancy use for In Progress? (e.g. In Progress, In Dev, Doing)` then write `CLANCY_STATUS_IN_PROGRESS=<value>` to `.clancy/.env`.
If [2]: remove `CLANCY_STATUS_IN_PROGRESS` from `.clancy/.env`.

---

### [B3] Linear Done status (Linear only)

```
Linear Done status — current: {value or "off"}
When set, Clancy moves an issue to this workflow state after completing it.
Must match the exact state name shown in your Linear board column header.

[1] Set state name
[2] Off (do not transition on completion)
[3] Cancel
```

If [1]: prompt `What workflow state name should Clancy use for Done? (e.g. Done, Complete, Closed)` then write `CLANCY_STATUS_DONE=<value>` to `.clancy/.env`.
If [2]: remove `CLANCY_STATUS_DONE` from `.clancy/.env`.

---

### [B4] Linear Review status (Linear only)

```
Linear Review status — current: {value or "uses Done state"}
When Clancy creates a pull request (instead of merging locally), it moves
the issue to this state. Falls back to CLANCY_STATUS_DONE if not set.

[1] Set state name
[2] Off (use Done state for PR flow too)
[3] Cancel
```

If [1]: prompt `What workflow state name should Clancy use for In Review? (e.g. In Review, Ready for Review, Code Review)` then write `CLANCY_STATUS_REVIEW=<value>` to `.clancy/.env`.
If [2]: remove `CLANCY_STATUS_REVIEW` from `.clancy/.env`.

---

### [B5] Linear Rework status (Linear only)

```
Linear Rework status — current: {value or "off"}
When a reviewer sends an issue back for changes, Clancy picks it up again
with feedback context. Set to the Linear workflow state name for rework issues.

[1] Set state name
[2] Off (disable rework loop)
[3] Cancel
```

If [1]: prompt `What workflow state name represents "sent back for changes"? (e.g. Rework, Changes Requested)` then write `CLANCY_STATUS_REWORK=<value>` to `.clancy/.env`. Wrap in double quotes.
If [2]: remove `CLANCY_STATUS_REWORK` from `.clancy/.env`.

---

### [R1] Planner role

```
Planner role — currently: {enabled / disabled}
The Planner refines vague backlog tickets into structured implementation plans.
Commands: /clancy:plan, /clancy:approve

[1] Enable
[2] Disable
[3] Cancel
```

If enabling:
- Add `planner` to `CLANCY_ROLES` in `.clancy/.env` (create the key if it doesn't exist, append if other roles are listed)
- Show `✅ Planner role enabled. Re-run the installer to apply: npx chief-clancy@latest --local (or --global)`

If disabling:
- Remove `planner` from `CLANCY_ROLES` in `.clancy/.env` (if empty after removal, remove the line entirely)
- Keep planner-specific settings (CLANCY_PLAN_STATUS, etc.) in `.clancy/.env` so re-enabling is frictionless
- Show `✅ Planner role disabled. Re-run the installer to apply: npx chief-clancy@latest --local (or --global)`

---

### [P1] Plan queue status (Jira only)

```
Plan queue status — current: {value or "Backlog"}
Which Jira status should /clancy:plan fetch backlog tickets from?
Common values: Backlog, To Refine, Unrefined

[1] Backlog (default)
[2] Enter a different value
```

If [1]: remove `CLANCY_PLAN_STATUS` from `.clancy/.env` (uses default).
If [2]: prompt `What status name should /clancy:plan fetch from?` then write `CLANCY_PLAN_STATUS=<value>` to `.clancy/.env`.

---

### [P1] Plan label (GitHub only)

```
Plan label — current: {value or "needs-refinement"}
Which label marks issues for /clancy:plan to refine?
Create this label in GitHub first if it doesn't exist.

[1] needs-refinement (default)
[2] Enter a different label name
```

If [1]: remove `CLANCY_PLAN_LABEL` from `.clancy/.env` (uses default).
If [2]: prompt `What label should /clancy:plan filter by?` then write `CLANCY_PLAN_LABEL=<value>` to `.clancy/.env`.

---

### [P1] Plan state type (Linear only)

```
Plan state type — current: {value or "backlog"}
Which Linear state type should /clancy:plan fetch issues from?

[1] backlog (default)
[2] triage
[3] Enter a different value
```

If [1]: remove `CLANCY_PLAN_STATE_TYPE` from `.clancy/.env` (uses default).
If [2]: write `CLANCY_PLAN_STATE_TYPE=triage` to `.clancy/.env`.
If [3]: prompt `What state type should /clancy:plan fetch from?` then write `CLANCY_PLAN_STATE_TYPE=<value>` to `.clancy/.env`.

---

### [H1] Git host token

Only shown for Jira and Linear boards. GitHub Issues users already have `GITHUB_TOKEN` for PR creation.

```
Git host — current: {GitHub / GitLab / Bitbucket / not set}
Clancy pushes feature branches and creates PRs on your git host.

[1] GitHub
[2] GitLab
[3] Bitbucket
[4] Remove (push and create PRs manually)
[5] Cancel
```

If [1]: prompt `Paste your GitHub personal access token:` then write `GITHUB_TOKEN=<value>` to `.clancy/.env`. Remove any existing `GITLAB_TOKEN`, `BITBUCKET_USER`, `BITBUCKET_TOKEN`.
If [2]: prompt `Paste your GitLab personal access token:` then write `GITLAB_TOKEN=<value>` to `.clancy/.env`. Optionally ask for a self-hosted API base URL (e.g. `https://gitlab.example.com/api/v4`) and write `CLANCY_GIT_API_URL` and `CLANCY_GIT_PLATFORM="gitlab"`. If the user enters just a hostname or instance URL without `/api/v4`, append `/api/v4` automatically. Remove any existing `GITHUB_TOKEN` (only if board is not GitHub), `BITBUCKET_USER`, `BITBUCKET_TOKEN`.
If [3]: prompt for `Bitbucket username` and `Bitbucket app password`, write `BITBUCKET_USER` and `BITBUCKET_TOKEN` to `.clancy/.env`. Remove any existing `GITHUB_TOKEN` (only if board is not GitHub), `GITLAB_TOKEN`.
If [4]: remove all git host token vars (`GITLAB_TOKEN`, `BITBUCKET_USER`, `BITBUCKET_TOKEN`, `CLANCY_GIT_PLATFORM`, `CLANCY_GIT_API_URL`). Keep `GITHUB_TOKEN` only if board is GitHub Issues.

---

### [I1] Figma MCP

```
Figma MCP — current: {enabled / not set}

[1] Set API key
[2] Disable (remove key)
[3] Cancel
```

If [1]: prompt `Paste your Figma API key: (create one at figma.com/settings → Personal access tokens)` then verify with the Figma `whoami` API before saving. If verification fails, tell the user and offer retry or skip — never save an unverified key.
If [2]: remove `FIGMA_API_KEY` from `.clancy/.env`.

---

### [I2] Playwright

```
Playwright visual checks — current: {enabled / off}

[1] Enable
[2] Disable
[3] Cancel
```

If [1] Enable selected and `PLAYWRIGHT_ENABLED` is already `true`: show `Playwright is already enabled. [1] Reconfigure [2] Cancel`. If Reconfigure, walk through the setup questions again. If Cancel, loop back.
If [1] Enable selected and `PLAYWRIGHT_DEV_COMMAND` is not set: walk through the Playwright setup questions from the init workflow (dev server command, port, Storybook detection, startup wait).
If [1] Enable selected and `PLAYWRIGHT_DEV_COMMAND` is already set: just set `PLAYWRIGHT_ENABLED=true`.
If [2] Disable: set `PLAYWRIGHT_ENABLED=false` in `.clancy/.env`.

---

### [I3] Notifications

```
Notifications — current: {configured / not set}

[1] Set webhook URL
[2] Disable (remove webhook)
[3] Cancel
```

If [1]: prompt `Paste your Slack or Teams webhook URL:` then write `CLANCY_NOTIFY_WEBHOOK=<url>` to `.clancy/.env`.
If [2]: remove `CLANCY_NOTIFY_WEBHOOK` from `.clancy/.env`.

---

### [S] Switch board

Show which board is currently active, then offer the other two:

```
Switch board — currently: {Jira / GitHub Issues / Linear}

[1] {board A}
[2] {board B}
[3] Cancel
```

Only show the two boards that are not currently active. If the user picks Cancel, loop back to the menu without changing anything.

**Step 1: Collect new credentials**

Ask each credential question individually and wait for an answer, exactly as in the init workflow Q2:

Jira — ask in this order:
1. `What's your Jira base URL? (e.g. https://your-org.atlassian.net)`
2. `What's your Jira project key? (e.g. PROJ)`
3. `What email address do you use to log in to Atlassian?`
4. `Paste your Jira API token: (create one at id.atlassian.com/manage-profile/security/api-tokens)`

GitHub Issues — ask in this order:
1. `What's your GitHub repo? (owner/name, e.g. acme/my-app)`
2. `Paste your GitHub personal access token: (needs repo scope)`

After collecting GitHub credentials, remind the user:
```
Important: Clancy only picks up GitHub Issues that have the "clancy" label applied.
Add this label to any issue you want Clancy to work on.
```

Linear — ask in this order:
1. `Paste your Linear API key: (create one at linear.app/settings/api)`
2. `What's your Linear team ID? (find it at linear.app/settings/teams — click your team, copy the ID from the URL)`

**Step 2: Verify credentials**

Verify the new credentials before making any changes — same checks as the init preflight and doctor workflow. Show the result:

```
Verifying...
✅ Connected — {board-specific confirmation, e.g. "PROJ reachable" / "acme/my-app found" / "Linear authenticated"}
```

If verification fails, tell the user clearly and offer:

```
Could not connect. Check your credentials and try again.

[1] Try again
[2] Cancel
```

Never modify any files if verification fails.

**Step 3: Confirm the switch**

Once verified, show a single confirmation before making changes:

```
Ready to switch from {old board} to {new board}.
Your other settings (model, iterations, branch, enhancements) will be kept.

Confirm? [Y/n]
```

If no: print `Cancelled. No changes made.` and loop back to the menu.

**Step 4: Apply the switch**

1. Remove all vars belonging to the old board from `.clancy/.env`:
   - Jira: `JIRA_BASE_URL`, `JIRA_USER`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`, `CLANCY_JQL_STATUS`, `CLANCY_JQL_SPRINT`
   - GitHub: `GITHUB_TOKEN`, `GITHUB_REPO`
   - Linear: `LINEAR_API_KEY`, `LINEAR_TEAM_ID`
   - Git host (all boards): `GITLAB_TOKEN`, `BITBUCKET_USER`, `BITBUCKET_TOKEN`, `CLANCY_GIT_PLATFORM`, `CLANCY_GIT_API_URL`, `CLANCY_STATUS_REVIEW`
2. Write the new board credentials to `.clancy/.env`
3. If switching to Jira: also ask the status filter question (same as init Q3) and write `CLANCY_JQL_STATUS` to `.clancy/.env`
4. No script replacement needed — the bundled runtime scripts are board-agnostic (board detection happens at runtime from `.clancy/.env`)

Print:

```
✅ Switched to {new board}. "New beat, same Chief."
```

Then loop back to the main settings menu.

---

### [X] Exit

Print nothing extra. Stop.

---

## Step 5 — Writing values to .clancy/.env

When updating a value:

- If the key already exists in `.clancy/.env`: replace its line in place
- If the key does not exist: append it to the end of the file
- If removing a key: delete its line from the file
- Never touch any other lines in the file

---

### [D] Save as global defaults

When selected:

1. Read the current `.clancy/.env` and extract only the non-credential, non-board-specific settings:
   - `MAX_ITERATIONS`
   - `CLANCY_MODEL`
   - `CLANCY_BASE_BRANCH`
   - `PLAYWRIGHT_ENABLED`
   - `PLAYWRIGHT_STARTUP_WAIT`

2. Write these to `~/.clancy/defaults.json`:
   ```json
   {
     "MAX_ITERATIONS": "5",
     "CLANCY_MODEL": "claude-sonnet-4-6",
     "CLANCY_BASE_BRANCH": "main"
   }
   ```

3. Print: `✅ Defaults saved to ~/.clancy/defaults.json — new projects will inherit these settings.`

4. Loop back to the settings menu.

**Never save credentials, board-specific settings (status filter, sprint, label), or webhook URLs to global defaults.**

---

## Step 6 — Load global defaults during init

When `/clancy:init` creates `.clancy/.env`, check if `~/.clancy/defaults.json` exists. If so, pre-populate the `.env` with those values instead of the built-in defaults. The user's answers during init still take priority — defaults are only used for settings that init doesn't ask about (max iterations, model, etc.).

---

## Notes

- All changes are written to `.clancy/.env` immediately after confirmation
- Switching boards verifies credentials before making any changes — nothing is written if verification fails
- `/clancy:init` remains available for a full re-setup (re-scaffolds scripts and docs)
- This command never restarts any servers or triggers any ticket processing
- Global defaults (`~/.clancy/defaults.json`) are optional — if the file doesn't exist, built-in defaults are used
