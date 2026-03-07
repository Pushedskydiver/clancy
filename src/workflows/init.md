# Clancy Init Workflow

## Overview

Full wizard for setting up Clancy in a project. Follow every step exactly. Do not skip steps or reorder them.

---

## Step 1 — Detect project state

Before asking any questions, silently check:

- Is this an existing project? Check for `package.json`, `.git`, `src/`, `app/`, `lib/`
- Is a board already configured? Check `.clancy/.env` for `JIRA_BASE_URL`, `GITHUB_TOKEN`, `LINEAR_API_KEY`
- Does `CLAUDE.md` already exist? Flag for merge — never overwrite
- Does `.clancy/` already exist? Warn and offer re-init or abort

If `.clancy/` exists, output:

It looks like Clancy is already set up in this project.

[1] Re-run init (update config, re-scaffold)
[2] Abort (keep existing setup)

---

## Step 2 — Welcome message

Output:

Clancy pulls tickets from your Kanban board, implements them, commits, and squash-merges — one ticket per run, fresh context every time.

Let's get you set up.

---

## Step 3 — Questions (board-dependent)

### Q1: Board selection

Output:

Which Kanban board are you using?

[1] Jira
[2] GitHub Issues
[3] Linear
[4] My board isn't listed

If the user selects [4], output the dead-end message and stop:

Clancy currently supports Jira, GitHub Issues, and Linear out of the box.

Your board isn't supported yet — but you can add it:
  · Open an issue:   github.com/Pushedskydiver/clancy/issues
  · Contribute one:  see CONTRIBUTING.md — adding a board is just a script template + a boards.json entry

In the meantime, you can still use Clancy manually:
  · Run /clancy:map-codebase to scan and document your codebase
  · Use the clancy-once.sh template from the GitHub repo as a starting point
  · Implement your board's API fetch, store credentials in .clancy/.env
  · Point clancy-afk.sh at your custom script via CLANCY_ONCE_SCRIPT in .clancy/.env

Do not scaffold anything after this message. Stop completely.

---

### Q2: Board-specific config

Ask each question individually and wait for an answer before moving to the next.

**Jira** — ask in this order:

1. `Jira base URL (e.g. https://your-org.atlassian.net):`
2. `Jira project key (e.g. PROJ):`
3. `Jira email (your Atlassian account email):`
4. `Jira API token (from id.atlassian.com/manage-profile/security/api-tokens):`

**GitHub Issues** — ask in this order:

1. `GitHub repo (owner/name, e.g. acme/my-app):`
2. `GitHub personal access token (needs repo scope):`

After collecting GitHub credentials, show:
```
Important: Clancy only picks up GitHub Issues that have the "clancy" label applied.
Add this label to any issue you want Clancy to work on.
```

**Linear** — ask in this order:

1. `Linear API key (from linear.app/settings/api):`
2. `Linear team ID (from linear.app/settings/teams — click your team, copy the ID from the URL):`

---

### Q3 (Jira only): Status name

Output:

Which Jira status should Clancy pick tickets from?
Common values: To Do, Selected for Development, Ready, Open

[1] To Do (default)
[2] Enter a different value

Store as `CLANCY_JQL_STATUS` in `.clancy/.env`.

---

### Q3b (Jira only): Sprints

Output: `Does your Jira project use sprints? (Requires Jira Software — not available on all plans) [y/N]:`

If yes: add `CLANCY_JQL_SPRINT=true` to `.clancy/.env`.
If no: omit the sprint clause from JQL entirely.

---

### Q4: Base branch (auto-detect)

Silently detect the base branch — do not ask unless detection fails:

1. Run `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null` and strip the `refs/remotes/origin/` prefix
2. If that fails, check whether `main`, `master`, or `develop` exist as local branches (in that order)
3. If still unresolved, default to `main`

Only if detection produces an unexpected result (e.g. something other than main/master/develop), confirm with the user:

Detected base branch: `{branch}` — is this correct? [Y/n]

Store the detected (or confirmed) value as `CLANCY_BASE_BRANCH` in `.clancy/.env`.

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
6. Write collected credentials to `.clancy/.env` (if the user provided them)
7. Handle `CLAUDE.md`:
   - If no CLAUDE.md: copy `src/templates/CLAUDE.md` as `CLAUDE.md`
   - If CLAUDE.md exists: append the Clancy section (between `<!-- clancy:start -->` and `<!-- clancy:end -->` delimiters) to the end — never overwrite
8. Check `.gitignore` — if `.clancy/.env` is not listed, append it

---

## Step 5 — Optional enhancements

Output:

Clancy is set up. A few optional enhancements are available — take 2 minutes each or skip for now. You can always configure them later by editing `.clancy/.env`.

Would you like to set up optional enhancements now? [y/N]

If no: skip to Step 6.

If yes, walk through each in order. After each enhancement (whether configured or skipped), ask before starting the next one: `Set up [enhancement name]? [y/N]`

### Enhancement 1: Figma MCP

Output: `Fetch design context from Figma when tickets include a Figma URL. Set up Figma MCP? [y/N]`

If no: skip to Enhancement 2.

If yes: `Figma API key (from figma.com/settings → Personal access tokens):`

If a key is entered:
1. Verify the key by calling `GET https://api.figma.com/v1/me` with `X-Figma-Token: {key}`
2. On success, show:
   ```
   ✓ Figma connected: {email}

   Note: Figma's API does not expose plan information.
   Clancy uses 3 MCP calls per ticket (metadata, design context, screenshot).
   Check your plan at figma.com/settings to confirm you have enough MCP calls for your usage.
   Pro plans: 200 calls/day (~66 tickets). Starter: 6 calls/month (not suitable for AFK use).

   Figma MCP enabled.
   ```

If `GET /v1/me` fails (non-200), show:
```
✗ Couldn't verify Figma API key (HTTP {status}).
Double-check it at figma.com/settings → Personal access tokens.

[1] Try a different key
[2] Skip Figma for now
```
Never silently continue with an unverified key. If the user picks [1], re-prompt for the key and repeat the verification. If [2], skip to Enhancement 2.

Write `FIGMA_API_KEY` to `.clancy/.env`. Add usage note to CLAUDE.md Clancy section.

---

### Enhancement 2: Playwright visual checks

Output: `Screenshot and verify UI after implementing tickets. Set up Playwright visual checks? [y/N]`

If no: skip to Enhancement 3.

If yes, continue:

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
Dev server start command:
  Detected: {value}

[1] Yes, use this
[2] Enter a different command
```

**Step 5: Dev server port**
Auto-detect from `vite.config.*`, `next.config.*`, or common defaults (5173, 3000, 8080).
```
Dev server port:
  Detected: {value}

[1] Yes, use this
[2] Enter a different port
```

**Step 6: (If Storybook confirmed) Storybook command**
Auto-detect from `package.json` scripts (`storybook`, `storybook:dev`).
```
Storybook start command:
  Detected: {value}

[1] Yes, use this
[2] Enter a different command
```

**Step 7: (If Storybook confirmed) Storybook port**
Auto-detect from `.storybook/main.js|ts` or default to 6006.
```
Storybook port:
  Detected: {value}

[1] Yes, use this
[2] Enter a different port
```

**Step 8: Startup wait**
```
How many seconds should Clancy wait for a server to be ready?

[1] 15 seconds (default)
[2] Enter a different value
```

Write to `.clancy/.env`:
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

Output: `Post to a channel when a ticket completes or Clancy hits an error. Set up notifications? [y/N]`

If no: skip to Enhancement 4.

If yes: `Paste your Slack or Teams webhook URL:`

Auto-detect platform from URL:
- `https://hooks.slack.com/` → Slack → sends `{"text": "..."}` payload
- `https://prod-*.logic.azure.com/` or `https://*.webhook.office.com/` → Teams → sends Adaptive Card

If Teams URL entered, show:
```
Ensure you've set up the "Post to a channel when a webhook request is received"
workflow via Teams → channel → ... → Workflows. The URL must come from that
workflow's trigger, not from the old Office 365 Connectors setup (retired April 2026).
```

Write `CLANCY_NOTIFY_WEBHOOK=<url>` to `.clancy/.env`.

---

### Enhancement 4: Max iterations

Output: `How many tickets should /clancy:run process per session? (default: 5) [enter to accept or type a number]:`

Write `MAX_ITERATIONS=<value>` to `.clancy/.env`.

---

## Step 6 — Offer map-codebase

Output:

One last step — Clancy can scan your codebase now and populate `.clancy/docs/` with structured context it reads before every ticket. This takes about 2 minutes.

Scan codebase now? [Y/n]

If yes: run the map-codebase workflow.
If no: output "Run /clancy:map-codebase when you're ready." then continue to final output.

---

## Final output

Output:

Clancy is ready.

- Scripts: `.clancy/clancy-once.sh`, `.clancy/clancy-afk.sh`
- Docs: `.clancy/docs/` (10 files)
- Config: `.clancy/.env`
- CLAUDE.md: updated

Run `/clancy:once` to pick up your first ticket, or `/clancy:run` to process the full queue.
