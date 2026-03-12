# Changelog

All notable changes to Clancy are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [0.3.2] — Unreleased

### 🐛 Bug fixes

- **Fixed Jira JQL query syntax** — `buildJql()` was joining `ORDER BY priority ASC` with `AND`, producing invalid JQL (`... AND ORDER BY priority ASC`) that Jira rejected with HTTP 400. The once command couldn't fetch tickets while review/status (which build JQL inline) worked fine.

---

## [0.3.1] — 2026-03-12

### 🔧 Breaking changes

- **Runtime scripts are now bundled** — `.clancy/clancy-once.js` and `.clancy/clancy-afk.js` are now self-contained esbuild bundles copied by the installer. They no longer `import('chief-clancy/scripts/once')` from `node_modules`. This means `npx chief-clancy` is fire-and-forget — zero runtime dependency on the npm package.
- **Subpath exports removed** — `chief-clancy/scripts/once` and `chief-clancy/scripts/afk` package exports are removed (no longer needed).
- **`zod` moved to devDependencies** — zod is now inlined into the bundles at build time, so it's no longer a runtime dependency.

### ⬆️ Upgrading from 0.3.0

```bash
npx -y chief-clancy@latest
```

The installer automatically replaces your `.clancy/clancy-once.js` and `.clancy/clancy-afk.js` with the new bundled versions. No manual steps needed. You can safely remove `chief-clancy` from your project's devDependencies if it was added for the shims:

```bash
npm uninstall chief-clancy
```

---

## [0.3.0] — 2026-03-12

### 🔧 Breaking changes

- **Shell scripts replaced by TypeScript** — all four shell scripts (`clancy-once.sh`, `clancy-once-github.sh`, `clancy-once-linear.sh`, `clancy-afk.sh`) are replaced by TypeScript ESM modules. Board detection happens at runtime from `.clancy/.env`.
- **Prerequisites changed** — `jq` and `curl` are no longer required. Only `node` (22+) and `git` are needed.
- **Windows now natively supported** — WSL is no longer required since all shell scripts have been replaced by cross-platform TypeScript.
- **Shellcheck CI removed** — the shellcheck job is removed from CI since there are no more shell scripts.
- **Bash tests removed** — all `test/unit/*.test.sh` and `test/smoke/smoke.sh` files are replaced by Vitest tests co-located with their modules.

### ✨ New features

- **Unified once orchestrator** (`src/scripts/once/once.ts`) — single TypeScript entry point handles all three boards (Jira, GitHub Issues, Linear). Full lifecycle: preflight → board detection → fetch ticket → branch computation → dry-run gate → status transition → Claude session → squash merge → close/transition → progress log → notification.
- **Zod env validation** — all board credentials and shared config are validated at startup using `zod/mini` schemas with clear error messages for missing or malformed values.
- **Discriminated union board config** — `BoardConfig` type (`{ provider: 'jira' | 'github' | 'linear'; env: ... }`) enables exhaustive type checking across all board-specific code paths.
- **Board-agnostic runtime scripts** — `.clancy/clancy-once.js` and `.clancy/clancy-afk.js` are identical for all boards. No more board-specific script selection during init or settings changes.

### 🐛 Bug fixes

- **Claude exit code check** — `invokeClaudeSession` now returns a `boolean` based on exit status. The orchestrator skips squash merge when Claude exits with an error, preventing empty or broken merges.
- **Linear label filtering relaxed** — removed overly restrictive `SAFE_ID_PATTERN` regex that rejected labels containing spaces or special characters. Labels are now trimmed and passed directly as GraphQL variables (inherently safe).
- **GitHub label parameter** — `fetchIssue` now accepts a configurable `label` parameter instead of hardcoding `'clancy'`, respecting the `CLANCY_LABEL` env var.
- **GitHub `per_page` bumped** — increased from 3 to 10 to reduce the chance of missing eligible issues when PRs (which the API returns alongside issues) consume result slots.
- **Force delete after squash merge** — `deleteBranch` now uses `git branch -D` instead of `-d`, since squash-merged branches are never seen as "merged" by git.

### 📝 Documentation

- **All workflow markdown files updated** — references to shell scripts, `bash`, `chmod +x`, `jq`, and `curl` replaced with TypeScript/Node equivalents throughout all 9 workflow files.
- **scaffold.md reduced by ~1000 lines** — removed embedded shell scripts (3 board variants × once + afk), replaced with 2 short JS shim blocks.
- **CONTRIBUTING.md rewritten** — board contribution guide now describes creating TypeScript modules instead of shell scripts.
- **CONVENTIONS.md rewritten** — language matrix updated from Bash/Node to TypeScript ESM/Node CJS.
- **PR template updated** — checklist items reference TypeScript modules and co-located tests.
- **README** — updated permissions TIP (`curl` → `node`), stale references cleaned up.
- **CLAUDE.md, ARCHITECTURE.md, TESTING.md** — fully rewritten for TypeScript codebase.

### ⬆️ Upgrading from 0.2.x

```bash
npx chief-clancy@latest
```

**What changes:**
- `.clancy/clancy-once.sh` (board-specific) → `.clancy/clancy-once.js` (board-agnostic, bundled)
- `.clancy/clancy-afk.sh` → `.clancy/clancy-afk.js` (bundled)
- `jq` and `curl` are no longer required — only `node` (22+) and `git`

**What's preserved:**
- `.clancy/.env` — no credential changes needed, same env var format
- `.clancy/docs/` — all 10 codebase docs are untouched
- `CLAUDE.md` — the Clancy section is updated in place
- `.clancy/progress.txt` — your run history is preserved

**After upgrading:** you can safely delete any leftover `.sh` files in `.clancy/`:

```bash
rm -f .clancy/clancy-once.sh .clancy/clancy-once-github.sh .clancy/clancy-once-linear.sh .clancy/clancy-afk.sh
```

---

## [0.2.0] — 2026-03-09

### ✨ New features

- **Shellcheck CI** — `.github/workflows/ci.yml` lints all nine shell scripts on every push and PR to `main`, then runs the full unit test suite.
- **Auto update check** — `hooks/clancy-check-update.js` fires on session start, spawns a background process to check npm for a newer `chief-clancy` version, and writes the result to `~/.claude/cache/clancy-update-check.json`. The CLAUDE.md template reads this file and surfaces an upgrade notice at the top of every session.
- **Context window monitor** — `hooks/clancy-statusline.js` tracks context usage and writes a bridge file; `hooks/clancy-context-monitor.js` reads it after each tool call and injects warnings (WARNING ≤ 35%, CRITICAL ≤ 25%) with debouncing (5 tool calls between warnings, severity escalation bypasses debounce). The statusline also shows a colour-coded progress bar.
- **Targeted doc loading** — Claude now reads six core docs on every run (STACK, ARCHITECTURE, CONVENTIONS, GIT, DEFINITION-OF-DONE, CONCERNS) and loads the four supplementary docs (INTEGRATIONS, TESTING, DESIGN-SYSTEM, ACCESSIBILITY) only when relevant to the ticket.
- **Status transitions** — Jira and Linear issues now move through the board automatically. Set `CLANCY_STATUS_IN_PROGRESS` and `CLANCY_STATUS_DONE` in `.env` to the exact column name; Clancy transitions on pickup and on completion. Best-effort — never fails the run. Configurable via `/clancy:settings`.
- **`/clancy:dry-run` command** — dedicated slash command in the Claude Code dropdown. Previews which ticket would be picked up next (including epic, target branch, and feature branch) without making any git changes or calling Claude. Runs full preflight to catch config issues early. Works on all three boards.
- **Credential guard** — `hooks/clancy-credential-guard.js` is a PreToolUse hook that scans Write, Edit, and MultiEdit operations for credential patterns (API keys, tokens, passwords, private keys, connection strings) and blocks the operation if a match is found. Allowed paths (`.clancy/.env`, `.env.example`, etc.) are exempt. Best-effort — never blocks on error.

### 🐛 Bug fixes

- **`/clancy:uninstall` left orphaned hooks** — the uninstall workflow only removed command and workflow directories. The three hook files, their `settings.json` registrations (SessionStart, PostToolUse, statusline), and the update check cache were all left behind. All are now cleaned up on uninstall.
- **Statusline never displayed** — the installer wrote `statusline` (lowercase, plain string) to `settings.json` but Claude Code requires `statusLine` (camelCase, `{type, command}` object). The statusline was silently ignored on every install. Fixed the key name and value format in the installer.
- **Hooks fail on ESM projects** — projects with `"type": "module"` in their `package.json` caused Node to treat hook files as ES modules, breaking `require()` with a `ReferenceError`. The installer now writes a `{"type":"commonjs"}` package.json into the hooks directory so the hooks always run as CommonJS regardless of the host project's module type.
- **Dry run created git branches before exiting** — the epic/milestone branch was created before the dry-run gate in all three board scripts, meaning `--dry-run` left behind a git branch despite printing "No changes made". Branch creation is now deferred to after the gate.
- **`DRY_RUN` overwritable by `.env` source** — the flag was set before `.clancy/.env` was sourced; a `.env` exporting `DRY_RUN=false` could silently negate `--dry-run`. Fixed with `readonly DRY_RUN` immediately after flag parsing in all three scripts.
- **Jira transition payload used string interpolation** — `IN_PROGRESS_ID` and `DONE_ID` were interpolated directly into the curl `-d` JSON string. Both are now routed through `jq --arg` for safe JSON construction.
- **Linear: silent failure when workflow state name not found** — if `CLANCY_STATUS_IN_PROGRESS` or `CLANCY_STATUS_DONE` didn't match any state in `workflowStates`, the transition was silently skipped with no feedback. An explicit warning is now printed so misconfigured state names are immediately visible.

### ✅ Tests

- **More test fixtures** — added edge-case coverage identified post-release: Linear `ISSUE_ID` extraction, Linear `CLANCY_LABEL` request body (with and without label), GitHub all-PRs response returning zero real issues.
- **Credential guard tests** — 32 tests covering non-file-writing tool passthrough, allowed-path exemptions, 13 credential pattern categories (AWS, GitHub, Stripe, Slack, private keys, connection strings, etc.), Edit/MultiEdit support, block reason content, and error resilience (malformed input never crashes). Total: 94 passing (up from 55).

### ⬆️ Upgrading from 0.1.x

Run `/clancy:update` or `npx chief-clancy@latest`. The installer handles everything — new commands, workflows, hooks, and `settings.json` registrations are added automatically. User-modified files are backed up to `.claude/clancy/local-patches/` before overwriting.

**Optional new `.env` vars** (documented in `.env.example`):
- `CLANCY_STATUS_IN_PROGRESS` — column name for auto-transitioning tickets on pickup (Jira/Linear)
- `CLANCY_STATUS_DONE` — column name for auto-transitioning tickets on completion (Jira/Linear)

No manual migration steps required. All new features work out of the box or are opt-in via `.env`.

---

## [0.1.7] — 2026-03-11

### 📝 Documentation

- **README** — expanded "Updating Clancy?" section to describe changelog preview, confirmation prompt, and automatic patch backup; corrected "Uninstalling?" section to reflect CLAUDE.md and .gitignore cleanup; added global defaults mention under optional enhancements; updated test badge count from 34 to 51.
- **Roadmap** — moved patch preservation, global defaults, update preview, and uninstall cleanup from v0.2.0 to v0.1.x (already shipped); updated v0.2.0 to reflect current planned features.

---

## [0.1.6] — 2026-03-11

### ✨ New features

- **Patch preservation on update** — the installer now generates SHA-256 file manifests (`manifest.json`, `workflows-manifest.json`) during install. On subsequent installs (updates), it compares current files against the manifest to detect user modifications. Modified files are backed up to `.claude/clancy/local-patches/` with metadata before overwriting, so customisations are never silently lost.
- **Global defaults for settings** — `/clancy:settings` now offers a "Save as defaults" option that writes non-credential settings (max iterations, model, base branch, Playwright) to `~/.clancy/defaults.json`. New projects created with `/clancy:init` inherit these defaults automatically.

---

## [0.1.5] — 2026-03-11

### ✨ Improvements

- **`/clancy:update` workflow rewrite** — now detects the installed version from the local `VERSION` file, compares against npm before running, shows the changelog diff and a clean-install warning, asks for user confirmation, and clears the update check cache after a successful update. Previously the update ran immediately with no preview or confirmation.

### 🐛 Bug fixes

- **`/clancy:uninstall` left CLAUDE.md and .gitignore dirty** — uninstall did not clean up the `<!-- clancy:start -->` / `<!-- clancy:end -->` block it added to CLAUDE.md, nor remove the `.clancy/.env` entry it added to .gitignore. If Clancy created CLAUDE.md (no other content), it is now deleted entirely; if Clancy appended to an existing CLAUDE.md, only the Clancy section is removed. The .gitignore entry and comment are also cleaned up, and the file is deleted if Clancy was the only contributor.

---

## [0.1.4] — 2026-03-10

### 💄 Improvements

- **Settings menu labels** — renamed `Status filter` to `Queue status` in the Jira settings menu to make it clear this controls which column Clancy pulls tickets *from*, distinct from the status transition settings.

---

## [0.1.3] — 2026-03-09

### 🐛 Bug fixes

- **`scaffold.md` out of sync with source templates** — the shell scripts and `.env.example` files embedded in `scaffold.md` (written verbatim by Claude during `/clancy:init`) had diverged from their source templates in `src/templates/`. Synced all seven embedded blocks: four shell scripts (`clancy-once.sh` Jira/GitHub/Linear, `clancy-afk.sh`) and three `.env.example` files. Changes include expanded preflight error messages, additional inline comments, and fuller `.env.example` documentation.

### ✅ Tests

- **Drift test** — `test/unit/scaffold.test.sh` now extracts each embedded block from `scaffold.md` and diffs it against the source template. Covers all four shell scripts and all three `.env.example` files. Fails loudly if they diverge. Added to `npm test`.

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
