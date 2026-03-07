## Update check

Before doing anything else, check for updates:

1. Run: `npm show chief-clancy version`
2. Read the installed version from the Clancy `package.json`
3. If a newer version exists, print: `ℹ Clancy v{current} → v{latest} available. Run /clancy:update to upgrade.` then continue normally.
4. If already on latest, continue silently.
5. If the npm check fails for any reason (offline, network error), continue silently. Never block on this.

---

# Clancy Doctor Workflow

## Overview

Diagnose your Clancy setup — test every configured integration and report what's working, what's broken, and how to fix it. Never modifies any files or state.

---

## Step 1 — Check install

- Verify Clancy commands are installed (`.claude/commands/clancy/` or `~/.claude/commands/clancy/`)
- Read installed version from `package.json` in the commands directory
- Print: `✓ Clancy v{version} installed ({location})`

---

## Step 2 — Check prerequisites

Test each required binary:

| Binary | Check | Fix hint |
|---|---|---|
| `claude` | `command -v claude` | `https://claude.ai/code` |
| `jq` | `command -v jq` | `brew install jq` / `apt install jq` |
| `curl` | `command -v curl` | Install curl for your OS |
| `git` | `command -v git` | Install git for your OS |

Print `✓` or `✗` for each.

---

## Step 3 — Check project setup

- `.clancy/` exists → `✓ .clancy/ found`
- `.clancy/clancy-once.sh` exists and is executable → `✓ clancy-once.sh`
- `.clancy/clancy-afk.sh` exists and is executable → `✓ clancy-afk.sh`
- `.clancy/.env` exists → `✓ .clancy/.env found`
- `.clancy/docs/` has non-empty files → `✓ codebase docs present ({N} files)`

If `.clancy/` is missing: `✗ .clancy/ not found — run /clancy:init`
If `.clancy/.env` is missing: `✗ .clancy/.env not found — run /clancy:init`

---

## Step 4 — Check board credentials

Source `.clancy/.env` and detect which board is configured:

**Jira** — if `JIRA_BASE_URL` is set:
1. Check all required vars are non-empty: `JIRA_BASE_URL`, `JIRA_USER`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`
2. Ping: `GET {JIRA_BASE_URL}/rest/api/3/project/{JIRA_PROJECT_KEY}` with basic auth
3. Report HTTP status with specific guidance for each failure code

**GitHub Issues** — if `GITHUB_TOKEN` is set:
1. Check: `GITHUB_TOKEN`, `GITHUB_REPO`
2. Ping: `GET https://api.github.com/repos/{GITHUB_REPO}` with bearer token
3. Report status

**Linear** — if `LINEAR_API_KEY` is set:
1. Check: `LINEAR_API_KEY`, `LINEAR_TEAM_ID`
2. Ping: `POST https://api.linear.app/graphql` with `{ viewer { id } }` — no Bearer prefix
3. Report status

---

## Step 5 — Check optional integrations

**Figma** — if `FIGMA_API_KEY` is set:
- Call `GET https://api.figma.com/v1/me` with `X-Figma-Token: $FIGMA_API_KEY`
- On success: print `✓ Figma connected — {email}`
- On 403: print `✗ Figma authentication failed. Check FIGMA_API_KEY in .clancy/.env.`
- Note: Figma's API does not expose plan information — check your plan at figma.com/settings

**Playwright** — if `PLAYWRIGHT_ENABLED=true`:
- Check `.clancy/docs/PLAYWRIGHT.md` exists
- Verify `PLAYWRIGHT_DEV_COMMAND` and `PLAYWRIGHT_DEV_PORT` are set
- Check port is not currently in use (just a status, not a blocker)

**Notifications** — if `CLANCY_NOTIFY_WEBHOOK` is set:
- Detect platform from URL (Slack/Teams)
- Send a test ping: `"Clancy doctor — webhook test from {project dir}"`
- Report success or failure

---

## Step 6 — Summary

```
Clancy doctor — {N} checks passed, {N} warnings, {N} failures

✓ Clancy v0.1.0 installed (global)
✓ claude, jq, curl, git — all present
✓ .clancy/ set up — 10 docs present
✓ Jira connected — PROJ reachable
⚠ Figma — Starter plan (6 calls/month, ~2 tickets)
✗ PLAYWRIGHT_STORYBOOK_PORT — not set in .clancy/.env

Fix the ✗ items, then run /clancy:once to verify end-to-end.
```

If all checks pass:
```
All good. Run /clancy:once to pick up your first ticket.
```
