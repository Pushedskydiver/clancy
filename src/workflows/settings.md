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
[1] Max iterations    {MAX_ITERATIONS:-20}        tickets per /clancy:run session
[2] Claude model      {CLANCY_MODEL:-default}     model used for each ticket session
[3] Base branch       {CLANCY_BASE_BRANCH:-main}

{If Jira:}
Jira
[4] Status filter     {CLANCY_JQL_STATUS:-To Do}
[5] Sprint filter     {on if CLANCY_JQL_SPRINT set, else off}

Optional enhancements
[{N}] Figma MCP       {enabled if FIGMA_API_KEY set, else not set}
[{N}] Playwright      {enabled if PLAYWRIGHT_ENABLED=true, else off}
[{N}] Notifications   {configured if CLANCY_NOTIFY_WEBHOOK set, else not set}

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

[1] 20 (default)
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

### Figma MCP

```
Figma MCP — current: {enabled / not set}

[1] Set API key
[2] Disable (remove key)
[3] Cancel
```

If [1]: prompt `Figma API key (from figma.com/settings → Personal access tokens):` then verify with the Figma `whoami` API before saving. If verification fails, tell the user and offer retry or skip — never save an unverified key.
If [2]: remove `FIGMA_API_KEY` from `.clancy/.env`.

---

### Playwright

```
Playwright visual checks — current: {enabled / off}

[1] Enable
[2] Disable
[3] Cancel
```

If enabling and `PLAYWRIGHT_DEV_COMMAND` is not already set: walk through the Playwright setup questions from the init workflow (dev server command, port, Storybook detection, startup wait).
If disabling: set `PLAYWRIGHT_ENABLED=false` in `.clancy/.env`.

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
- Board credentials (Jira URL, tokens, GitHub repo, Linear key) are never shown or editable here — use `/clancy:init` to reconfigure those
- This command never restarts any servers or triggers any ticket processing
