# Changelog

All notable changes to Clancy are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [0.1.2] — 2026-03-09

### 🐛 Bug fixes

- **Shell scripts generated incorrectly on init** — the init workflow told Claude to "copy" `clancy-once.sh` from a source that doesn't exist after installation. Claude would improvise and generate a broken script (wrong API endpoint, BSD-incompatible `head -n -1`, etc.). The scaffold workflow now embeds the exact script content for all three boards so Claude writes it verbatim.

---

## [0.1.1] — 2026-03-09

### 🐛 Bug fixes

- **Global install: workflow files not found** — commands installed to `~/.claude` reference workflow files via `@` paths that Claude Code resolves relative to the project root. For global installs, the workflow files weren't in the project so all commands failed to load. The installer now inlines workflow content directly into command files at global install time.
- **Jira: `JIRA_PROJECT_KEY` format validation** — added a format check (`^[A-Z][A-Z0-9]+$`) before using the key in API URLs and JQL queries.

---

## [0.1.0] — 2026-03-07

### 🚀 Install

- `npx chief-clancy` installer — global (`~/.claude`) or local (`./.claude`) install
- Version check at workflow startup — prompts to update if a newer version is available, continues silently otherwise

### ⚡ Commands

- `/clancy:init` — full setup wizard with Jira, GitHub Issues, and Linear support; explicit Figma key verification with retry/skip menu on failure
- `/clancy:run` — loop runner with optional iteration count override; cost warning for 10+ iterations
- `/clancy:once` — pick up and implement exactly one ticket, then stop
- `/clancy:status` — read-only board check showing the next 3 tickets assigned to you
- `/clancy:review` — 7-criterion ticket scoring (0–100%) with actionable recommendations
- `/clancy:logs` — formatted progress log with ASCII epic progress bars
- `/clancy:map-codebase` — 5-agent parallel codebase scan writing 10 structured docs to `.clancy/docs/`
- `/clancy:update-docs` — incremental doc refresh for changed areas of the codebase
- `/clancy:doctor` — test every configured integration and report what's working, broken, and how to fix it
- `/clancy:settings` — interactive settings menu; change board, model, iterations, label filter, and optional enhancements without re-running init
- `/clancy:update` — self-update slash commands via npx (re-run `/clancy:init` to also update shell scripts)
- `/clancy:uninstall` — remove Clancy commands from global or local install
- `/clancy:help` — command reference with lineage credit

### 📋 Board support

- **Jira** — POST `/rest/api/3/search/jql` endpoint, ADF description parsing, sprint filter, optional label filter (`CLANCY_LABEL`), classic and next-gen epic detection
- **GitHub Issues** — PR filtering, milestone as epic context, `clancy` label required for pickup, optional `CLANCY_LABEL` filter, auto-close on complete
- **Linear** — `viewer.assignedIssues` query, `state.type: unstarted` filter, personal API key auth (no Bearer prefix), optional `CLANCY_LABEL` filter

### 🌿 Git workflow

- Epic branch auto-detection — tickets with a parent epic branch from and merge into `epic/{epic-key}` (created from `CLANCY_BASE_BRANCH` if it doesn't exist); tickets without a parent use `CLANCY_BASE_BRANCH` directly
- Squash merge per ticket; ticket branch deleted locally after merge, never pushed to remote
- Progress logged to `.clancy/progress.txt` — timestamp, ticket key, summary, and status after every completion

### 🔌 Optional integrations

- **Figma MCP** — three-tier design context fetch (MCP → REST image export → ticket attachment); key verified on setup with retry/skip on failure
- **Playwright** — visual check after UI tickets; Storybook detection with configurable routing rules between dev server and Storybook; Figma design compliance comparison when a design was fetched for the ticket
- **Slack / Teams** — webhook notifications on ticket completion or error; auto-detected from URL format

### ⚙️ Configuration & setup

- Full `.clancy/` scaffold: shell scripts, 10 doc templates, `.env`, `.env.example`
- CLAUDE.md merge strategy — appends Clancy section between delimiters, never overwrites existing content
- Pre-implementation executability check — Clancy self-assesses each ticket before executing; skips and logs tickets that aren't implementable in the current codebase
- Prerequisite check in `/clancy:init` — verifies `jq`, `curl`, and `git` are installed before proceeding; lists missing binaries with install hints and stops
- Preflight checks in all scripts: binary check, `.env` validation, git repo check, board reachability ping
- Board registry (`registry/boards.json`) for community-contributed board integrations

### 🧪 Testing & docs

- Unit tests against fixture files for all three boards
- Smoke test suite for live API validation
- `COMPARISON.md` — Clancy vs GSD vs PAUL feature comparison
- MIT license
- Credits to Geoffrey Huntley for the Ralph technique
