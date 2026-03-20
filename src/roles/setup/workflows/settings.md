# Clancy Settings Workflow

## Overview

View and change Clancy configuration. Reads `.clancy/.env`, shows current values, and lets the user update any setting interactively. Loops until the user exits. Never modifies anything other than `.clancy/.env`.

### Input handling

This workflow runs inside a Claude Code session. Accept natural language alongside option codes:
- "G1", "max iterations", "change iterations" → all resolve to the max iterations setting
- "enable planner", "R1", "planner" → all resolve to the Planner role toggle
- "enable strategist", "R2", "strategist" → all resolve to the Strategist role toggle
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
- `SHORTCUT_API_TOKEN` set → Shortcut
- `NOTION_TOKEN` set → Notion
- `AZDO_ORG` set → Azure DevOps

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
  [G5] TDD mode          {on if CLANCY_TDD=true, else off}
  [G6] Grill mode         {CLANCY_MODE:-interactive}
  [G7] Fix retries        {CLANCY_FIX_RETRIES:-2}          self-healing attempts after verification failure
  [G8] Time limit         {CLANCY_TIME_LIMIT:-30}          per-ticket time limit in minutes (0 = disabled)
  [G9] Branch guard       {on if CLANCY_BRANCH_GUARD=true or unset, off if false}
  [G10] Quiet hours       {CLANCY_QUIET_START–CLANCY_QUIET_END if set, else off}
  [G11] Desktop notify    {on if CLANCY_DESKTOP_NOTIFY=true or unset, off if false}

{If Jira:}
Jira
  [B1] Queue status      {CLANCY_JQL_STATUS:-To Do}
  [B2] Sprint filter     {on if CLANCY_JQL_SPRINT set, else off}
  [B3] Label filter      {CLANCY_LABEL if set, else off}
  [B4] Pickup status     {CLANCY_STATUS_IN_PROGRESS if set, else off}
  [B5] Done status       {CLANCY_STATUS_DONE if set, else off}
  [B6] Review status     {CLANCY_STATUS_REVIEW if set, else "uses Done status"}

{If Linear:}
Linear
  [B1] Label filter      {CLANCY_LABEL if set, else off}
  [B2] Pickup status     {CLANCY_STATUS_IN_PROGRESS if set, else off}
  [B3] Done status       {CLANCY_STATUS_DONE if set, else off}
  [B4] Review status     {CLANCY_STATUS_REVIEW if set, else "uses Done state"}

Roles
  [R1] Planner           {✅ enabled / ─ disabled}
  [R2] Strategist        {✅ enabled / ─ disabled}

{If Strategist enabled:}
Strategist
  [T1] Brief epic        {CLANCY_BRIEF_EPIC if set, else "off"}
{If Jira:}
  [T2] Issue type        {CLANCY_BRIEF_ISSUE_TYPE:-Task}
  [T3] Component         {CLANCY_COMPONENT if set, else "off"}

{If Planner or Strategist enabled:}
Pipeline Labels
  [L1] Brief label         {CLANCY_LABEL_BRIEF if set, else "clancy:brief"}    (Strategist only)
  [L2] Plan label          {CLANCY_LABEL_PLAN if set, else "clancy:plan"}
  [L3] Build label         {CLANCY_LABEL_BUILD if set, else "clancy:build"}
  {If CLANCY_LABEL or CLANCY_PLAN_LABEL set:}
  ⚠ CLANCY_LABEL and CLANCY_PLAN_LABEL are deprecated. Use CLANCY_LABEL_BUILD and CLANCY_LABEL_PLAN.

{If Planner enabled:}
Planner
{If Jira:}
  [P1] Plan queue status  {CLANCY_PLAN_STATUS:-Backlog}
{If GitHub:}
  [P1] Plan label         {CLANCY_PLAN_LABEL:-needs-refinement}
{If Linear:}
  [P1] Plan state type    {CLANCY_PLAN_STATE_TYPE:-backlog}
{If Jira:}
  [P2] Post-approval      {CLANCY_STATUS_PLANNED if set, else "off"}

Git Host (PR creation)
  [H1] Git host token    {platform: GitHub/GitLab/Bitbucket or "not set"}

Integrations
  [I1] Figma MCP         {enabled if FIGMA_API_KEY set, else not set}
  [I2] Playwright        {enabled if PLAYWRIGHT_ENABLED=true, else off}
  [I3] Notifications     {configured if CLANCY_NOTIFY_WEBHOOK set, else not set}

  [S]  Switch board      currently: {Jira / GitHub Issues / Linear / Shortcut / Notion / Azure DevOps}
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

### [G5] TDD mode

```
Test-Driven Development — current: {on/off}
When enabled, Clancy follows red-green-refactor for every behaviour change.

[1] Enable
[2] Disable
```

If [1]: write `CLANCY_TDD=true` to `.clancy/.env`.
If [2]: remove `CLANCY_TDD` from `.clancy/.env`.

---

### [G6] Grill mode

```
Grill mode — current: {interactive/afk}
Controls how /clancy:brief handles clarifying questions before generating a brief.

[1] Interactive (default) — asks the human
[2] AFK — AI-grill resolves autonomously (for automation pipelines)
```

If [1]: remove `CLANCY_MODE` from `.clancy/.env` (uses default).
If [2]: write `CLANCY_MODE=afk` to `.clancy/.env`.

---

### [G7] Fix retries

```
Fix retries — current: {value or 2}
Max self-healing attempts after a verification failure (lint/test/typecheck).
When exhausted, Clancy delivers anyway with a warning in the PR body.

[1] 2 (default)
[2] Enter a different number (0–5)
[3] Cancel
```

Validate the input is an integer between 0 and 5. If invalid, re-prompt.

If [1]: remove `CLANCY_FIX_RETRIES` from `.clancy/.env` (uses default).
If [2]: prompt `How many fix retries?` then write `CLANCY_FIX_RETRIES=<value>` to `.clancy/.env`.

---

### [G8] Time limit

```
Time limit — current: {value or 30} minutes
Per-ticket time limit. Clancy stops working on a ticket after this many minutes.
Set to 0 to disable.

[1] 30 minutes (default)
[2] Enter a different number
[3] Cancel
```

Validate the input is a non-negative integer. If invalid, re-prompt.

If [1]: remove `CLANCY_TIME_LIMIT` from `.clancy/.env` (uses default).
If [2]: prompt `Time limit in minutes? (0 to disable)` then write `CLANCY_TIME_LIMIT=<value>` to `.clancy/.env`.

---

### [G9] Branch guard

```
Branch guard — current: {on/off}
Prevents accidental commits to the base branch during autonomous runs.

[1] Enable (default)
[2] Disable
```

If [1]: write `CLANCY_BRANCH_GUARD=true` to `.clancy/.env`.
If [2]: write `CLANCY_BRANCH_GUARD=false` to `.clancy/.env`.

---

### [G10] Quiet hours

```
Quiet hours — current: {CLANCY_QUIET_START–CLANCY_QUIET_END or "off"}
Pause AFK runs during these hours. Clancy sleeps until the end of the quiet window.

[1] Set quiet hours
[2] Off (no quiet hours)
[3] Cancel
```

If [1]: prompt `Quiet start time (HH:MM, 24h format):` then `Quiet end time (HH:MM, 24h format):`. Validate HH:MM format (0-23:00-59). Write `CLANCY_QUIET_START` and `CLANCY_QUIET_END` to `.clancy/.env`.
If [2]: remove `CLANCY_QUIET_START` and `CLANCY_QUIET_END` from `.clancy/.env`.

---

### [G11] Desktop notifications

```
Desktop notifications — current: {on/off}
Native OS notifications when tickets complete or errors occur.

[1] Enable (default)
[2] Disable
```

If [1]: write `CLANCY_DESKTOP_NOTIFY=true` to `.clancy/.env`.
If [2]: write `CLANCY_DESKTOP_NOTIFY=false` to `.clancy/.env`.

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

### [R1] Planner role

```
Planner role — currently: {enabled / disabled}
The Planner refines vague backlog tickets into structured implementation plans.
Commands: /clancy:plan, /clancy:approve-plan

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

### [R2] Strategist role

```
Strategist role — currently: {enabled / disabled}
The Strategist generates strategic briefs and creates tickets on the board.
Commands: /clancy:brief, /clancy:approve-brief

[1] Enable
[2] Disable
[3] Cancel
```

If enabling:
- Add `strategist` to `CLANCY_ROLES` in `.clancy/.env` (create the key if it doesn't exist, append if other roles are listed)
- Show `✅ Strategist role enabled. Re-run the installer to apply: npx chief-clancy@latest --local (or --global)`

If disabling:
- Remove `strategist` from `CLANCY_ROLES` in `.clancy/.env` (if empty after removal, remove the line entirely)
- Keep strategist-specific settings (CLANCY_BRIEF_EPIC, CLANCY_BRIEF_ISSUE_TYPE, CLANCY_COMPONENT) in `.clancy/.env` so re-enabling is frictionless
- Show `✅ Strategist role disabled. Re-run the installer to apply: npx chief-clancy@latest --local (or --global)`

---

### [T1] Brief epic

Only shown when Strategist is enabled.

```
Brief epic — current: {value or "off"}
Default parent epic/milestone for briefs created from text or file input.

[1] Set epic key (e.g. PROJ-100, #42, ENG-50)
[2] Off (no default parent)
[3] Cancel
```

If [1]: prompt `What epic key should /clancy:brief parent tickets under?` then write `CLANCY_BRIEF_EPIC=<value>` to `.clancy/.env`. Wrap in double quotes.
If [2]: remove `CLANCY_BRIEF_EPIC` from `.clancy/.env`.

---

### [T2] Issue type (Jira only)

Only shown when Strategist is enabled and board is Jira.

```
Brief issue type — current: {value or "Task"}
Issue type used when /clancy:brief creates tickets on the board.

[1] Task (default)
[2] Story
[3] Enter a different value
[4] Cancel
```

If [1]: remove `CLANCY_BRIEF_ISSUE_TYPE` from `.clancy/.env` (uses default).
If [2]: write `CLANCY_BRIEF_ISSUE_TYPE="Story"` to `.clancy/.env`.
If [3]: prompt `What issue type should /clancy:brief use?` then write `CLANCY_BRIEF_ISSUE_TYPE=<value>` to `.clancy/.env`. Wrap in double quotes.

---

### [T3] Component

Only shown when Strategist is enabled.

```
Component — current: {value or "off"}
Auto-set on tickets created by /clancy:brief.
Only affects ticket creation — does not filter the implementation queue.

[1] Set component name
[2] Off (no component)
[3] Cancel
```

If [1]: prompt `What component should /clancy:brief set on created tickets?` then write `CLANCY_COMPONENT=<value>` to `.clancy/.env`. Wrap in double quotes.
If [2]: remove `CLANCY_COMPONENT` from `.clancy/.env`.

---

### [L1] Brief label

Only shown when Strategist is enabled.

```
Brief label — current: {value or "clancy:brief"}
Label applied to tickets after /clancy:brief. Removed when the brief is approved.

[1] clancy:brief (default)
[2] Enter a different value
[3] Cancel
```

If [1]: remove `CLANCY_LABEL_BRIEF` from `.clancy/.env` (uses default).
If [2]: prompt `What label should /clancy:brief apply?` then write `CLANCY_LABEL_BRIEF=<value>` to `.clancy/.env`. Wrap in double quotes.

---

### [L2] Plan label

Only shown when Planner or Strategist is enabled.

```
Plan label — current: {value or "clancy:plan"}
Label applied to tickets that need planning. Removed when the plan is approved.

[1] clancy:plan (default)
[2] Enter a different value
[3] Cancel
```

If [1]: remove `CLANCY_LABEL_PLAN` from `.clancy/.env` (uses default).
If [2]: prompt `What label should mark tickets needing planning?` then write `CLANCY_LABEL_PLAN=<value>` to `.clancy/.env`. Wrap in double quotes.

---

### [L3] Build label

Only shown when Planner or Strategist is enabled.

```
Build label — current: {value or "clancy:build"}
Label applied to tickets ready for implementation. Used by /clancy:once and /clancy:run to filter the queue.

[1] clancy:build (default)
[2] Enter a different value
[3] Cancel
```

If [1]: remove `CLANCY_LABEL_BUILD` from `.clancy/.env` (uses default).
If [2]: prompt `What label should mark tickets ready to build?` then write `CLANCY_LABEL_BUILD=<value>` to `.clancy/.env`. Wrap in double quotes.

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

### [P2] Post-approval transition (Jira only)

Only shown when Planner is enabled and board is Jira.

```
Post-approval transition — current: {value or "off"}
After approving a plan, transition the ticket to this status.

[1] Set status name
[2] Off (move manually)
[3] Cancel
```

If [1]: prompt `What status should Clancy transition to after approving a plan? (e.g. To Do, Ready)` then write `CLANCY_STATUS_PLANNED=<value>` to `.clancy/.env`. Wrap in double quotes.
If [2]: remove `CLANCY_STATUS_PLANNED` from `.clancy/.env`.

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

Show which board is currently active, then offer the others:

```
Switch board — currently: {Jira / GitHub Issues / Linear / Shortcut / Notion / Azure DevOps}

[1] {board A}
[2] {board B}
...
[N] Cancel
```

Only show the boards that are not currently active. If the user picks Cancel, loop back to the menu without changing anything.

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

Shortcut — ask in this order:
1. `Paste your Shortcut API token: (create one at app.shortcut.com/settings/account/api-tokens)`
2. `What workflow should Clancy use? (press Enter to auto-detect)`

Notion — ask in this order:
1. `Paste your Notion integration token: (create one at notion.so/my-integrations)`
2. `What's your Notion database ID? (32-character hex string from your database URL)`
3. `Status property name? [Status]`
4. `Assignee property name? [Assignee]`

Azure DevOps — ask in this order:
1. `What's your Azure DevOps organisation name?`
2. `What's your project name?`
3. `Paste your Azure DevOps personal access token: (needs Work Items Read & Write scope)`

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
   - Shortcut: `SHORTCUT_API_TOKEN`, `SHORTCUT_WORKFLOW`, `CLANCY_SC_STATUS`
   - Notion: `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `NOTION_STATUS_PROP`, `NOTION_ASSIGNEE_PROP`
   - Azure DevOps: `AZDO_ORG`, `AZDO_PROJECT`, `AZDO_PAT`
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
