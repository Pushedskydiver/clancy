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
Clancy settings — .clancy/.env

General
[1] Max iterations    {MAX_ITERATIONS:-5}          tickets per /clancy:run session
[2] Claude model      {CLANCY_MODEL:-default}     model used for each ticket session
[3] Base branch       {CLANCY_BASE_BRANCH:-main}

{If Jira:}
Jira
[4] Status filter     {CLANCY_JQL_STATUS:-To Do}
[5] Sprint filter     {on if CLANCY_JQL_SPRINT set, else off}
[6] Label filter      {CLANCY_LABEL if set, else off — only pick up tickets with this label}

Optional enhancements
[{N}] Figma MCP       {enabled if FIGMA_API_KEY set, else not set}
[{N}] Playwright      {enabled if PLAYWRIGHT_ENABLED=true, else off}
[{N}] Notifications   {configured if CLANCY_NOTIFY_WEBHOOK set, else not set}

[{N}] Switch board    currently: {Jira / GitHub Issues / Linear}
[{N}] Exit

Which setting would you like to change?
```

Number each option sequentially. If Jira is not configured, skip [4] and [5] and renumber accordingly.

---

## Step 4 — Handle each selection

After the user picks a number, handle it as below. After saving, print `✓ Saved.` and loop back to Step 3 to show the updated menu.

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
✓ Connected — {board-specific confirmation, e.g. "PROJ reachable" / "acme/my-app found" / "Linear authenticated"}
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
4. Write the correct `clancy-once.sh` variant for the new board to `.clancy/clancy-once.sh` — same script content as init Step 4 uses (Jira → `clancy-once.sh`, GitHub → `clancy-once-github.sh`, Linear → `clancy-once-linear.sh`). Make it executable: `chmod +x .clancy/clancy-once.sh`

Print:

```
✓ Switched to {new board}.
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

## Notes

- All changes are written to `.clancy/.env` immediately after confirmation
- Switching boards verifies credentials before making any changes — nothing is written if verification fails
- `/clancy:init` remains available for a full re-setup (re-scaffolds scripts and docs)
- This command never restarts any servers or triggers any ticket processing
