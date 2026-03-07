# Clancy Init Workflow

## Overview

Full wizard for setting up Clancy in a project. Follow every step exactly. Do not skip steps or reorder them.

---

## Step 1 — Detect project state

Before asking any questions, silently check:

- Is this an existing project? Check for `package.json`, `.git`, `src/`, `app/`, `lib/`
- Is a board already configured? Check `.env` for `JIRA_BASE_URL`, `GITHUB_TOKEN`, `LINEAR_API_KEY`
- Does `CLAUDE.md` already exist? Flag for merge — never overwrite
- Does `.clancy/` already exist? Warn and offer re-init or abort

If `.clancy/` exists:
```
It looks like Clancy is already set up in this project.

[1] Re-run init (update config, re-scaffold)
[2] Abort (keep existing setup)
```

---

## Step 2 — Welcome message

Display this exactly:

```
Clancy is an autonomous coding agent that pulls tickets from your Kanban
board, implements them, commits, and squash-merges — one ticket per run,
fresh context every time.

Named after Chief Clancy Wiggum (Ralph's dad, The Simpsons), because Clancy
equips Ralph before sending him to work. Built on the Ralph technique coined
by Geoffrey Huntley (ghuntley.com/ralph/) — a bash loop that solves context
rot through simplicity. Clancy extends that foundation with board integration,
structured codebase docs, and a git workflow built for team development.

Let's get you set up.
```

---

## Step 3 — Questions (up to 5, board-dependent)

### Q1: Board selection

```
Which Kanban board are you using?

[1] Jira
[2] GitHub Issues
[3] Linear
[4] My board isn't listed
```

If the user selects [4], show the dead-end message and stop:

```
Clancy currently supports Jira, GitHub Issues, and Linear out of the box.

Your board isn't supported yet — but you can add it:
  · Open an issue:   github.com/your-username/clancy/issues
  · Contribute one:  see CONTRIBUTING.md — adding a board is just a script
                     template + a boards.json entry

In the meantime, you can still use Clancy manually:
  · Run /clancy:map-codebase to scan and document your codebase
  · Copy src/templates/scripts/clancy-once.sh as a starting point
  · Implement your board's API fetch, store credentials in .env
  · Point clancy-afk.sh at your custom script via CLANCY_ONCE_SCRIPT in .env
```

Do not scaffold anything after this message. Stop completely.

---

### Q2: Board-specific config

**Jira:**
```
Jira base URL (e.g. https://your-org.atlassian.net):
Jira project key (e.g. PROJ):
Jira email (your Atlassian account email):
Jira API token (from id.atlassian.com/manage-profile/security/api-tokens):
```

**GitHub Issues:**
```
GitHub repo (owner/name, e.g. acme/my-app):
GitHub personal access token (needs repo scope):
```

**Linear:**
```
Linear API key (from linear.app/settings/api):
Linear team ID (from linear.app/settings/teams — click your team, copy the ID from the URL):
```

---

### Q3 (Jira only): Status name

```
What status name means "ready to be picked up"?
Common values: To Do, Selected for Development, Ready, Open
Press Enter to use "To Do":
```

Store as `CLANCY_JQL_STATUS` in `.env`.

---

### Q3b (Jira only): Sprints

```
Does your Jira project use sprints?
(Sprints require Jira Software — not available on all plans)
[y/N]:
```

If yes: add `CLANCY_JQL_SPRINT=true` to `.env`.
If no: omit the sprint clause from JQL entirely.

---

### Q4: Epic branch

```
What is the name of your epic branch?
(The branch Clancy squash-merges completed tickets into)
Example: epic/PROJ-1-user-auth, develop, main
```

Store as `CLANCY_EPIC_BRANCH` in `.env`.

---

### Q5: Confirm

```
Shall we set Clancy up now? [Y/n]:
```

If no: exit cleanly with "Run /clancy:init when you're ready."

---

## Step 4 — Scaffold

Create `.clancy/` directory and the following:

1. Copy the correct `clancy-once.sh` variant for the chosen board to `.clancy/clancy-once.sh`
2. Copy `clancy-afk.sh` to `.clancy/clancy-afk.sh`
3. Make both scripts executable: `chmod +x .clancy/*.sh`
4. Create `.clancy/docs/` with 10 empty template files (UPPERCASE.md with section headings only):
   - STACK.md, INTEGRATIONS.md, ARCHITECTURE.md, CONVENTIONS.md, TESTING.md
   - GIT.md, DESIGN-SYSTEM.md, ACCESSIBILITY.md, DEFINITION-OF-DONE.md, CONCERNS.md
5. Copy the correct `.env.example` variant to `.clancy/.env.example`
6. Write `.env` with collected credentials (if the user provided them)
7. Handle `CLAUDE.md`:
   - If no CLAUDE.md: copy `src/templates/CLAUDE.md` as `CLAUDE.md`
   - If CLAUDE.md exists: append the Clancy section (between `<!-- clancy:start -->` and `<!-- clancy:end -->` delimiters) to the end — never overwrite
8. Check `.gitignore` — if `.env` is not listed, append it

---

## Step 5 — Optional enhancements

```
Would you like to configure optional enhancements? [y/N]
You can always set these up later by editing .env
```

If yes, walk through each in order. Enter skips any individual item.

### Enhancement 1: Figma MCP

```
Fetch design specs from Figma when a ticket has a Figma URL in its description.

Figma API key (Enter to skip):
```

If a key is entered:
1. Verify the key by calling the Figma `whoami` API immediately
2. Detect plan from the response and show appropriate message:

   **Starter/View/Collab (6 calls/month):**
   ```
   Figma connected: {email}

   Your Figma plan allows only 6 MCP tool calls per month.
   Clancy uses 3 calls per ticket (metadata, design context, screenshot).
   That's approximately 2 tickets with Figma MCP context — not enough for
   meaningful AFK use.

   Options:
   [1] Skip Figma MCP (recommended)
   [2] What plan do I need?
   [3] Enable anyway (yolo mode)
   ```

   Option 2 shows upgrade info and loops back. Option 3 sets `FIGMA_YOLO=true`.

   **Pro (200 calls/day):**
   ```
   Figma connected: {email}
   Plan: Pro — 200 MCP tool calls/day (~66 tickets with Figma context)
   Figma MCP enabled.
   ```

   **Enterprise (600 calls/day):**
   ```
   Figma connected: {email}
   Plan: Enterprise — 600 MCP tool calls/day (~200 tickets with Figma context)
   Figma MCP enabled.
   ```

If `whoami` fails: tell the user the key couldn't be verified, ask to check it, offer skip or retry. Never silently continue with an unverified key.

Write `FIGMA_API_KEY` to `.env`. Add usage note to CLAUDE.md Clancy section.

---

### Enhancement 2: Playwright visual checks

```
Run a visual check after implementing UI tickets using Playwright MCP.
```

**Step 1: Storybook detection**

Check `package.json` for `@storybook/` dependencies and `.storybook/` directory.
If detected: "This project appears to use Storybook. Is that right? [Y/n]"

**Step 2: (If Storybook confirmed) Storybook content**
```
What does your project keep in Storybook?
[a] Individual components only (atoms, molecules, organisms)
[b] Components and some pages
[c] Everything — all UI is previewed in Storybook
[d] Let me describe it
```

**Step 3: (If Storybook confirmed) Dev server scope**
```
What UI work requires the full dev server instead of Storybook?
[a] Full pages and routes
[b] Nothing — everything is in Storybook
[c] Let me describe it
```

**Step 4: Dev server command**
Auto-detect from `package.json` scripts (priority: `dev`, `start`, `serve`).
```
Dev server start command: [detected] — press Enter to confirm or type yours:
```

**Step 5: Dev server port**
Auto-detect from `vite.config.*`, `next.config.*`, or common defaults (5173, 3000, 8080).
```
Dev server port: [detected] — press Enter to confirm or type yours:
```

**Step 6: (If Storybook confirmed) Storybook command**
Auto-detect from `package.json` scripts (`storybook`, `storybook:dev`).
```
Storybook start command: [detected] — press Enter to confirm or type yours:
```

**Step 7: (If Storybook confirmed) Storybook port**
Auto-detect from `.storybook/main.js|ts` or default to 6006.
```
Storybook port: [detected] — press Enter to confirm or type yours:
```

**Step 8: Startup wait**
```
How many seconds should Clancy wait for a server to be ready? [15]:
```

Write to `.env`:
```
PLAYWRIGHT_ENABLED=true
PLAYWRIGHT_DEV_COMMAND=<value>
PLAYWRIGHT_DEV_PORT=<value>
PLAYWRIGHT_STORYBOOK_COMMAND=<value>   # only if Storybook confirmed
PLAYWRIGHT_STORYBOOK_PORT=<value>      # only if Storybook confirmed
PLAYWRIGHT_STARTUP_WAIT=<value>
```

Create `.clancy/docs/PLAYWRIGHT.md` — see PLAYWRIGHT.md template in scaffold.md.

---

### Enhancement 3: Slack / Teams notifications

```
Post to a webhook when a ticket completes or Clancy hits an error.

Paste your webhook URL (Slack or Teams — Enter to skip):
```

Auto-detect platform from URL:
- `https://hooks.slack.com/` → Slack → sends `{"text": "..."}` payload
- `https://prod-*.logic.azure.com/` or `https://*.webhook.office.com/` → Teams → sends Adaptive Card

If Teams URL entered, show:
```
Ensure you've set up the "Post to a channel when a webhook request is received"
workflow via Teams → channel → ... → Workflows. The URL must come from that
workflow's trigger, not from the old Office 365 Connectors setup (retired April 2026).
```

Write `CLANCY_NOTIFY_WEBHOOK=<url>` to `.env`.

---

### Enhancement 4: Max iterations

```
How many tickets should /clancy:run process per session? [20]:
```

Write `MAX_ITERATIONS=<value>` to `.env`.

---

## Step 6 — Offer map-codebase

```
Clancy is set up. Shall we scan your codebase now
and populate .clancy/docs/? This takes ~2 minutes. [Y/n]:
```

If yes: run the map-codebase workflow.
If no: "Run /clancy:map-codebase when you're ready."

---

## Final output

```
Clancy is ready.

Scripts:   .clancy/clancy-once.sh
           .clancy/clancy-afk.sh
Docs:      .clancy/docs/ (10 files)
Config:    .env
CLAUDE.md: updated

Next steps:
  Run /clancy:once to pick up your first ticket
  Run /clancy:run to process the full queue
```
