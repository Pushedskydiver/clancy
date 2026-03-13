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

## Step 1b — Prerequisite check

Before proceeding, silently run `command -v` for each required binary:

| Binary | Install hint |
|---|---|
| `node` | Install Node.js 22+ (nodejs.org) |
| `git` | `brew install git` / `apt install git` |
| `claude` | `npm install -g @anthropic-ai/claude-code` |

If all are present: continue silently.

If any are missing, output:

```
⚠️ Missing prerequisites:

  ❌ node — Install Node.js 22+ (nodejs.org)

Clancy requires these binaries to run. Install them, then re-run /clancy:init.
```

List only the missing ones. Then stop — do not proceed with setup until prerequisites are satisfied.

---

## Step 2 — Welcome message

Output:

```
🚨 Clancy — Init
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Chief Wiggum reporting for duty."

Clancy pulls tickets from your Kanban board, plans and implements them, commits, and squash-merges — one ticket per run, fresh context every time.

Let's get you set up.
```

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
  · Contribute one:  see CONTRIBUTING.md — adding a board is a TypeScript module + a boards.json entry

In the meantime, you can still use Clancy manually:
  · Run /clancy:map-codebase to scan and document your codebase
  · Run `npx -y chief-clancy@latest` and implement your board's API module
  · Store credentials in .clancy/.env

Do not scaffold anything after this message. Stop completely.

---

### Q2: Board-specific config

Ask each question individually and wait for an answer before moving to the next.

**Jira** — ask in this order:

1. `What's your Jira base URL? (e.g. https://your-org.atlassian.net)`
2. `What's your Jira project key? (e.g. PROJ)`
3. `What email address do you use to log in to Atlassian?`
4. `Paste your Jira API token: (create one at id.atlassian.com/manage-profile/security/api-tokens)`

**GitHub Issues** — ask in this order:

1. `What's your GitHub repo? (owner/name, e.g. acme/my-app)`
2. `Paste your GitHub personal access token: (needs repo scope)`

After collecting GitHub credentials, show:
```
Important: Clancy only picks up GitHub Issues that have the "clancy" label applied.
Add this label to any issue you want Clancy to work on.
```

**Linear** — ask in this order:

1. `Paste your Linear API key: (create one at linear.app/settings/api)`
2. `What's your Linear team ID? (find it at linear.app/settings/teams — click your team, copy the ID from the URL)`
3. `What label should Clancy filter by? Create a "clancy" label in your Linear team and apply it to issues you want Clancy to implement. [clancy]`

If a label is entered: store as `CLANCY_LABEL` in `.clancy/.env`. Always wrap the value in double quotes (e.g. `CLANCY_LABEL="clancy"`).
If enter is pressed with no value: skip — omit the label clause entirely (Clancy will pick up all unstarted assigned issues).

---

### Q2b: Board credential verification

After collecting all credentials for the chosen board, verify the connection before continuing.

**Jira** — call `GET {JIRA_BASE_URL}/rest/api/3/project/{JIRA_PROJECT_KEY}` with basic auth (`{JIRA_USER}:{JIRA_API_TOKEN}` base64-encoded in the `Authorization: Basic` header).

On success (HTTP 200), show:
```
✅ Jira connected — project {JIRA_PROJECT_KEY} reachable.
```

On failure, show:
```
❌ Couldn't connect to Jira (HTTP {status}).
Check your credentials in the values you just entered.

[1] Re-enter credentials
```

If [1]: go back to Q2 and re-ask all Jira questions. If the user wants to abandon setup entirely, they can Ctrl+C.

**GitHub Issues** — call `GET https://api.github.com/repos/{GITHUB_REPO}` with `Authorization: Bearer {GITHUB_TOKEN}` and `X-GitHub-Api-Version: 2022-11-28`.

On success (HTTP 200), show:
```
✅ GitHub connected — {GITHUB_REPO} reachable.
```

On failure, show:
```
❌ Couldn't connect to GitHub (HTTP {status}).
Check your token has `repo` scope and the repo name is correct.

[1] Re-enter credentials
```

If [1]: go back to Q2 and re-ask all GitHub questions. If the user wants to abandon setup entirely, they can Ctrl+C.

**Linear** — call `POST https://api.linear.app/graphql` with `Authorization: {LINEAR_API_KEY}` (no Bearer prefix) and body `{"query": "{ viewer { id name } }"}`.

On success (HTTP 200 with `data.viewer`), show:
```
✅ Linear connected — {viewer.name}.
```

On failure, show:
```
❌ Couldn't connect to Linear.
Check your API key at linear.app/settings/api.

[1] Re-enter credentials
```

If [1]: go back to Q2 and re-ask all Linear questions. If the user wants to abandon setup entirely, they can Ctrl+C.

Never silently continue with unverified credentials — the user must fix their credentials or exit with Ctrl+C.

---

### Q3 (Jira only): Status name

Output:

Which Jira status should Clancy pick tickets from?
Common values: To Do, Selected for Development, Ready, Open

[1] To Do (default)
[2] Enter a different value

Store as `CLANCY_JQL_STATUS` in `.clancy/.env`. Always wrap the value in double quotes — status names often contain spaces (e.g. `CLANCY_JQL_STATUS="Selected for Development"`).

---

### Q3b (Jira only): Sprints

Output: `Does your Jira project use sprints? (Requires Jira Software — not available on all plans) [y/N]:`

If yes: add `CLANCY_JQL_SPRINT=true` to `.clancy/.env`.
If no: omit the sprint clause from JQL entirely.

---

### Q3c (Jira only): Label filter

Output: `What label should Clancy filter by? Create a "clancy" label in your Jira project and apply it to tickets you want Clancy to implement. [clancy]`

If a label is entered: store as `CLANCY_LABEL` in `.clancy/.env`. Always wrap the value in double quotes (e.g. `CLANCY_LABEL="clancy"`).
If enter is pressed with no value: skip — omit the label clause entirely (Clancy will pick up all assigned tickets in the queue).

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

1. Verify `.clancy/clancy-once.js` and `.clancy/clancy-afk.js` exist (copied by the installer). If missing, tell the user to run `npx -y chief-clancy@latest` and stop.
2. Create `.clancy/docs/` with 10 empty template files (UPPERCASE.md with section headings only):
   - STACK.md, INTEGRATIONS.md, ARCHITECTURE.md, CONVENTIONS.md, TESTING.md
   - GIT.md, DESIGN-SYSTEM.md, ACCESSIBILITY.md, DEFINITION-OF-DONE.md, CONCERNS.md
3. Write the correct `.env.example` for the chosen board to `.clancy/.env.example` — use the exact content from scaffold.md
4. Write collected credentials to `.clancy/.env` (if the user provided them)
5. Handle `CLAUDE.md` — follow the merge logic in scaffold.md exactly:
   - If no CLAUDE.md: write the full template as `CLAUDE.md`
   - If CLAUDE.md exists without `<!-- clancy:start -->`: append the Clancy section to the end
   - If CLAUDE.md exists with `<!-- clancy:start -->`: replace only the content between the markers
   - Never overwrite the entire file
6. Check `.gitignore` — if `.clancy/.env` is not listed, append it

---

## Step 4b — Commit scaffold

After scaffolding, ask the user whether to commit the scaffolded files:

```
Commit the Clancy scaffold to git? (recommended) [Y/n]
```

If yes (or enter): commit everything created (excluding `.clancy/.env` which contains credentials):

```bash
git add .clancy/.env.example .clancy/docs/ CLAUDE.md .gitignore
git commit -m "chore(clancy): initialise — scaffold docs templates and config"
```

If `CLAUDE.md` was not modified (it already existed and was not changed), omit it from the `git add`. If `.gitignore` was not modified, omit it too. Only stage files that actually changed.

If no: skip the commit silently. The user can commit manually later.

---

## Step 5 — Optional enhancements

Output:

```
Clancy is set up. A few optional enhancements are available:

  1. Figma MCP        — fetch design specs when tickets include a Figma URL
  2. Playwright       — screenshot and verify UI after implementing tickets
  3. Notifications    — post to Slack or Teams when a ticket completes or errors
  4. Max iterations   — set how many tickets /clancy:run processes per session

Each takes about 2 minutes to configure, or skip any for now.
You can always add them later by editing .clancy/.env.

Set up optional enhancements? [y/N]
```

If no: skip to Step 6.

If yes, walk through each in order. After each enhancement (whether configured or skipped), ask before starting the next one: `Set up [enhancement name]? [y/N]`

### Enhancement 1: Figma MCP

Output: `Fetch design context from Figma when tickets include a Figma URL. Set up Figma MCP? [y/N]`

If no: skip to Enhancement 2.

If yes: `Paste your Figma API key: (create one at figma.com/settings → Personal access tokens)`

If a key is entered:
1. Verify the key by calling `GET https://api.figma.com/v1/me` with `X-Figma-Token: {key}`
2. On success, show:
   ```
   ✅ Figma connected: {email}

   Note: Figma's API does not expose plan information.
   Clancy uses 3 MCP calls per ticket (metadata, design context, screenshot).
   Check your plan at figma.com/settings to confirm you have enough MCP calls for your usage.
   Pro plans: 200 calls/day (~66 tickets). Starter: 6 calls/month (not suitable for AFK use).

   Figma MCP enabled.
   ```

If `GET /v1/me` fails (non-200), show:
```
❌ Couldn't verify Figma API key (HTTP {status}).
Double-check it at figma.com/settings → Personal access tokens.

[1] Try a different key
[2] Skip Figma for now
```
Never silently continue with an unverified key. If the user picks [1], re-prompt for the key and repeat the verification. If [2], skip to Enhancement 2.

Write `FIGMA_API_KEY` to `.clancy/.env`. Add usage note to CLAUDE.md Clancy section.

---

### Enhancement 2: Playwright visual checks

If Figma was configured in Enhancement 1, output:
`Screenshot and verify UI after implementing tickets — and compare against the Figma design when one was fetched. Set up Playwright visual checks? [y/N]`

Otherwise output:
`Screenshot and verify UI after implementing tickets. Set up Playwright visual checks? [y/N]`

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
What command starts your dev server?
  Detected: {value}

[1] Yes, use this
[2] Enter a different command
```

**Step 5: Dev server port**
Auto-detect from `vite.config.*`, `next.config.*`, or common defaults (5173, 3000, 8080).
```
What port does your dev server run on?
  Detected: {value}

[1] Yes, use this
[2] Enter a different port
```

**Step 6: (If Storybook confirmed) Storybook command**
Auto-detect from `package.json` scripts (`storybook`, `storybook:dev`).
```
What command starts Storybook?
  Detected: {value}

[1] Yes, use this
[2] Enter a different command
```

**Step 7: (If Storybook confirmed) Storybook port**
Auto-detect from `.storybook/main.js|ts` or default to 6006.
```
What port does Storybook run on?
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

Write to `.clancy/.env`. Wrap command values in double quotes — they often contain spaces:
```
PLAYWRIGHT_ENABLED=true
PLAYWRIGHT_DEV_COMMAND="<value>"
PLAYWRIGHT_DEV_PORT=<value>
PLAYWRIGHT_STORYBOOK_COMMAND="<value>"   # only if Storybook confirmed
PLAYWRIGHT_STORYBOOK_PORT=<value>        # only if Storybook confirmed
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

Output:

```
How many tickets should /clancy:run process before stopping? [5]
(You can override this per-session with /clancy:run 20)
```

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

```
╔═══════════════════════════════════════════════════════════╗
║  ✅ Clancy is ready.                                     ║
╚═══════════════════════════════════════════════════════════╝

- Scripts: `.clancy/clancy-once.js`, `.clancy/clancy-afk.js`
- Docs: `.clancy/docs/` (10 files)
- Config: `.clancy/.env`
- CLAUDE.md: updated

"Clancy's on the beat." — Run /clancy:plan to refine backlog tickets, /clancy:dry-run to preview, or /clancy:once to pick up a ticket.
```
