# Clancy Settings Workflow

## Overview

View and change Clancy configuration. Reads `.clancy/.env`, shows current values, and lets the user update any setting interactively. Loops until the user exits. Never modifies anything other than `.clancy/.env`.

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

Show all current values. Board-specific settings only appear when that board is configured.

```
🚨 Clancy — Settings
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Welcome to headquarters." — .clancy/.env

General
[1] Max iterations    {MAX_ITERATIONS:-5}          tickets per /clancy:run session
[2] Claude model      {CLANCY_MODEL:-default}     model used for each ticket session
[3] Base branch       {CLANCY_BASE_BRANCH:-main}

{If Jira:}
Jira
[4] Queue status      {CLANCY_JQL_STATUS:-To Do}
[5] Sprint filter     {on if CLANCY_JQL_SPRINT set, else off}
[6] Label filter      {CLANCY_LABEL if set, else off — only pick up tickets with this label}
[7] Pickup status     {CLANCY_STATUS_IN_PROGRESS if set, else off — move ticket on pickup}
[8] Done status       {CLANCY_STATUS_DONE if set, else off — move ticket on completion}

{If Linear:}
Linear
[4] Label filter      {CLANCY_LABEL if set, else off — only pick up issues with this label}
[5] Pickup status     {CLANCY_STATUS_IN_PROGRESS if set, else off — move issue on pickup}
[6] Done status       {CLANCY_STATUS_DONE if set, else off — move issue on completion}

Optional enhancements
[{N}] Figma MCP       {enabled if FIGMA_API_KEY set, else not set}
[{N}] Playwright      {enabled if PLAYWRIGHT_ENABLED=true, else off}
[{N}] Notifications   {configured if CLANCY_NOTIFY_WEBHOOK set, else not set}

[{N}] Switch board    currently: {Jira / GitHub Issues / Linear}
[{N}] Exit

Which setting would you like to change?
```

Number each option sequentially. Show only the board-specific section that matches the configured board. If Jira: show [4] queue status, [5] sprint, [6] label, [7] pickup status, [8] done status. If Linear: show [4] label, [5] pickup status, [6] done status. If GitHub: no board-specific options.

---

## Step 4 — Handle each selection

After the user picks a number, handle it as below. After saving, print `✅ Saved.` and loop back to Step 3 to show the updated menu.

---

### [1] Max iterations

```
Max iterations — current: {value}
How many tickets should /clancy:run process per session?

[1] 5 (default)
[2] Enter a different number
```

Write `MAX_ITERATIONS=<value>` to `.clancy/.env`.

---

### [2] Claude model

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

### [3] Base branch

```
Base branch — current: {value}
Branch Clancy uses as the integration target when a ticket has no parent epic.

Enter new value (or press enter to keep current):
```

Write `CLANCY_BASE_BRANCH=<value>` to `.clancy/.env`.

---

### [4] Jira status filter (Jira only)

```
Jira status filter — current: {value}
Which status name should Clancy pick tickets from?
Common values: To Do, Selected for Development, Ready, Open

[1] To Do (default)
[2] Enter a different value
```

Write `CLANCY_JQL_STATUS=<value>` to `.clancy/.env`.

---

### [5] Jira sprint filter (Jira only)

```
Jira sprint filter — current: {on / off}
Filter tickets to the active sprint? (Requires Jira Software)

[1] On
[2] Off (default)
```

If on: write `CLANCY_JQL_SPRINT=true` to `.clancy/.env`.
If off: remove `CLANCY_JQL_SPRINT` from `.clancy/.env` (or comment it out).

---

### [6] Jira label filter (Jira only)

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

### [7] Jira In Progress status (Jira only)

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

### [8] Jira Done status (Jira only)

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

### [4] Linear label filter (Linear only)

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

### [5] Linear In Progress status (Linear only)

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

### [6] Linear Done status (Linear only)

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

### Figma MCP

```
Figma MCP — current: {enabled / not set}

[1] Set API key
[2] Disable (remove key)
[3] Cancel
```

If [1]: prompt `Paste your Figma API key: (create one at figma.com/settings → Personal access tokens)` then verify with the Figma `whoami` API before saving. If verification fails, tell the user and offer retry or skip — never save an unverified key.
If [2]: remove `FIGMA_API_KEY` from `.clancy/.env`.

---

### Playwright

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

### Notifications

```
Notifications — current: {configured / not set}

[1] Set webhook URL
[2] Disable (remove webhook)
[3] Cancel
```

If [1]: prompt `Paste your Slack or Teams webhook URL:` then write `CLANCY_NOTIFY_WEBHOOK=<url>` to `.clancy/.env`.
If [2]: remove `CLANCY_NOTIFY_WEBHOOK` from `.clancy/.env`.

---

### Switch board

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
2. Write the new board credentials to `.clancy/.env`
3. If switching to Jira: also ask the status filter question (same as init Q3) and write `CLANCY_JQL_STATUS` to `.clancy/.env`
4. No script replacement needed — the bundled runtime scripts are board-agnostic (board detection happens at runtime from `.clancy/.env`)

Print:

```
✅ Switched to {new board}. "New beat, same Chief."
```

Then loop back to the main settings menu.

---

### Exit

Print nothing extra. Stop.

---

## Step 5 — Writing values to .clancy/.env

When updating a value:

- If the key already exists in `.clancy/.env`: replace its line in place
- If the key does not exist: append it to the end of the file
- If removing a key: delete its line from the file
- Never touch any other lines in the file

---

### Save as global defaults

At the bottom of the settings menu (before Exit), show:

```
[{N}] Save as defaults   save current settings for all future projects
```

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
