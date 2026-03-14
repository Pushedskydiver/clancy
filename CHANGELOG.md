# Changelog

All notable changes to Clancy are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [0.5.5] — 2026-03-14

### ✨ Features

- **QA rework loop** — when a reviewer leaves feedback on a PR, Clancy picks it up automatically on the next run. Inline code comments (on specific diff lines) always trigger rework; conversation comments trigger with a `Rework:` prefix. Reads the feedback, builds a focused rework prompt ("fix the flagged issues, don't re-implement"), and pushes fixes to the existing branch — the PR updates automatically.
- **Comment-based rework detection** — Clancy scans open PRs for reviewer comments instead of relying on platform review states. Inline code comments always trigger rework. General conversation comments trigger when prefixed with `Rework:`. Works identically across GitHub, GitLab, and Bitbucket. Zero configuration needed — the PR body includes reviewer instructions automatically.
- **PR review comment fetching** — reads inline code review comments and conversation comments from GitHub, unresolved MR discussions from GitLab, and PR comments from Bitbucket (Cloud + Server). Comments are included in the rework prompt as actionable feedback.
- **Board comment fetching** — `fetchComments()` functions for all 3 boards (Jira REST, GitHub REST, Linear GraphQL). Filtered by timestamp.
- **Rework prompt** (`buildReworkPrompt`) — includes reviewer feedback and "address specific feedback" instructions.
- **Progress reader** — `findLastEntry()`, `countReworkCycles()`, and `findEntriesWithStatus()` for progress history scanning.
- **Max rework guard** — after N cycles (default 3, configurable via `CLANCY_MAX_REWORK`), ticket is skipped with "needs human intervention".

### 📝 Documentation

- **Init workflow** — added Q3e (max rework cycles)
- **Settings workflow** — added max rework setting
- **Scaffold workflow** — added `CLANCY_MAX_REWORK` to `.env.example` templates
- **Implementer docs** — added automatic PR-based rework flow section
- **Configuration guide** — added `CLANCY_MAX_REWORK` to table
- **Troubleshooting guide** — added PR rework scenarios

### ✅ Tests

- 82 new tests (270 → 352): progress reader (15), rework prompt (7), git fetchRemoteBranch (2), GitHub PR review (8), GitLab MR review (9), Bitbucket PR review (12), rework-comment (10), orchestrator PR rework (8), env schema (2), Jira async (8), pr-body rework (1)

---

## [0.5.4] — 2026-03-14

### ✨ Features

- **PR-based flow when ticket has no epic/parent** — when a ticket has no parent (epic, milestone, or Linear parent), Clancy now pushes the feature branch and creates a pull request instead of squash-merging locally. Supports GitHub, GitLab (including self-hosted), and Bitbucket (Cloud and Server/DC). Falls back gracefully: push failure → leaves branch, PR failure → logs manual URL, no token → logs pushed status, no remote → leaves branch locally.
- **Remote detection** (`src/scripts/shared/remote/remote.ts`) — `parseRemote()` and `detectRemote()` parse git remote URLs and detect the git platform (GitHub, GitLab, Bitbucket, Azure DevOps, GHE, self-hosted). `buildApiBaseUrl()` constructs the correct API base for each platform.
- **PR body builder** (`src/scripts/shared/pull-request/pr-body/pr-body.ts`) — `buildPrBody()` generates a PR description with a link back to the board ticket.
- **New env vars** — `CLANCY_STATUS_REVIEW` (transition status when creating a PR, falls back to `CLANCY_STATUS_DONE`), `GITHUB_TOKEN` (shared, for Jira/Linear users on GitHub), `GITLAB_TOKEN`, `BITBUCKET_USER`, `BITBUCKET_TOKEN`, `CLANCY_GIT_PLATFORM` (override auto-detection), `CLANCY_GIT_API_URL` (self-hosted API base).

### ♻️ Refactor

- **PR creation functions consolidated** — extracted GitHub PR creation from `board/github/github.ts` and moved GitLab/Bitbucket PR creation from `shared/remote/` into a new `shared/pull-request/` folder with co-located subfolders. All three git host PR creation functions now live together with a shared `postPullRequest()` utility that DRYs up the common POST + error-handling pattern.
- **`run()` function decomposed** — extracted `deliverViaEpicMerge()` and `deliverViaPullRequest()` from the 365-line `run()` function in `once.ts` for readability and testability.
- **DRY improvements** — extracted shared `formatDuration()` utility (was duplicated in once.ts and afk.ts), deduplicated `GITHUB_API` constant into `http.ts`, extracted `extractHostAndPath()` helper in `remote.ts` (was duplicated regex), removed local `LinearEnv` type in favour of schema-derived import.

### 🐛 Fixes

- **Bitbucket duplicate PR detection** — both Cloud and Server PR creation now detect HTTP 409 "already exists" responses (was returning generic error instead of `alreadyExists: true`).
- **`CLANCY_GIT_PLATFORM` override always applies** — user override now takes precedence even when auto-detection returns a known platform (previously only applied when auto-detection returned `unknown`/`none`).
- **URL-encode branch names in manual PR URLs** — `buildManualPrUrl` now uses `encodeURIComponent()` to handle special characters in branch names.
- **Type-safe shared env access** — replaced unsafe `as Record<string, string | undefined>` casts with a typed `sharedEnv()` helper.

### 📝 Documentation

- **Init workflow** — added Q2c (git host token for Jira/Linear) and Q3d-2 (review status)
- **Settings workflow** — added review status (B6/B4), git host token (H1) settings
- **Scaffold workflow** — added new env vars to all 3 `.env.example` templates
- **Implementer docs** — documented PR flow vs epic merge, updated loop diagram
- **Configuration guide** — added all new env vars to the table
- **Security guide** — added GitLab and Bitbucket token scope recommendations
- **Troubleshooting guide** — added push/PR failure scenarios
- **CLAUDE.md** — added PR-based flow technical decisions

### ✅ Tests

- 103 new tests (167 → 270): remote detection (35+4), shared `postPullRequest` utility (7), GitHub PR creation (5), GitLab MR creation (6), Bitbucket PR creation (7+2), git push (2), PR body builder (5), once orchestrator flows (3), `formatDuration` (5), `pingEndpoint` (5), Jira async functions (8), Linear async functions (6), `sendNotification` (3), `yellow` ANSI (1)

---

## [0.5.3] — 2026-03-14

### 🐛 Fixes

- **GitHub `@me` assignee bug** — Fine-grained PATs don't resolve `@me` in the Issues API. Clancy now resolves the authenticated username via `GET /user` and caches it for the session. Falls back to `@me` for classic PATs that support it.

### ✅ Tests

- Added 4 tests for `resolveUsername` (success, API failure fallback, network error fallback, cache verification)

---

## [0.5.2] — 2026-03-14

### 🐛 Fixes

- **Init missing queue config questions** — `/clancy:init` now asks for status transition names (In Progress / Done) on Jira and Linear, and planning queue status on Jira when the Planner role is enabled. Previously only the implementation queue status was asked for Jira, and Linear users had no way to configure transitions during init.

---

## [0.5.1] — 2026-03-13

### 🐛 Fixes

- **Init "already set up" false positive** — `/clancy:init` now checks for `.clancy/.env` (created by init) instead of `.clancy/` (created by the installer). Previously, running `npx chief-clancy --local` then `/clancy:init` for the first time would incorrectly warn that Clancy was already set up.

---

## [0.5.0] — 2026-03-13

### ✨ Features

- **Planner role** — new `/clancy:plan` command fetches backlog tickets from the board, explores the codebase, and generates structured implementation plans posted as comments for human review. Supports batch mode (`/clancy:plan 3`), re-planning with feedback (`--force`), feasibility scanning, QA return detection, Figma design context, and parallel codebase exploration for larger tickets.
- **`/clancy:approve`** — promotes an approved Clancy plan from a ticket comment to the ticket description. Appends below the existing description with a separator — never overwrites.
- **Board comment write-back** — plans are posted as comments on all 3 boards: Jira (ADF format), GitHub (Markdown), Linear (GraphQL Markdown).
- **Planner settings** — new board-specific settings for the planning queue: `CLANCY_PLAN_STATUS` (Jira, default: `Backlog`), `CLANCY_PLAN_LABEL` (GitHub, default: `needs-refinement`), `CLANCY_PLAN_STATE_TYPE` (Linear, default: `backlog`). Configurable via `/clancy:settings`.

### 🎨 UX Improvements

- **Optional roles** — init now asks which optional roles to enable (Planner is the first). Stored as `CLANCY_ROLES` in `.clancy/.env`. Core roles (Implementer, Reviewer, Setup) are always installed. Roles can be toggled later via `/clancy:settings`.
- **Stable settings menu** — settings uses letter mnemonics (`G1`, `B2`, `P1`, `I1`, `S`, `X`) instead of dynamic numbers. Options no longer shift when boards change.
- **Natural language input** — init and settings workflows now instruct Claude to accept conversational responses ("jira" instead of "1", "yes please" instead of "y").
- **Progress indicators** — init welcome message now shows step count and estimated time.
- **Credential escape hatches** — board credential failures now offer `[2] Skip verification` alongside re-enter, instead of requiring Ctrl+C to exit.
- **Linear team auto-detection** — init auto-detects teams from the API after verifying the key, instead of requiring manual URL hunting.
- **Max iterations reordered** — moved to first optional enhancement (most universally relevant) with input validation.
- **Plan feedback instructions** — plan template footer now tells users how to request changes and re-plan.
- **Per-ticket progress** — `/clancy:plan` now shows progress per ticket during multi-ticket runs with Ctrl+C guidance.
- **Duplicate plan guard** — `/clancy:approve` checks for existing plans in the description before appending.
- **Transition guidance** — `/clancy:approve` now reminds users to move tickets to the implementation queue.
- **Linear exact match** — `/clancy:approve` verifies Linear `issueSearch` results match the provided key exactly.
- **Logs support new types** — `/clancy:logs` now parses and displays PLAN, APPROVE, and SKIPPED entries.
- **Update-docs personality** — added banner and Wiggum quote to `/clancy:update-docs`.
- **Review preflight inlined** — `/clancy:review` preflight is now self-contained instead of referencing status.md.
- **Update flow polish** — local patches info now shows before the completion banner; changelog format specified; network failure handled gracefully; restart instructions clarified.
- **Map-codebase interruptibility** — Ctrl+C note added to agent deployment message.
- **API error handling** — `/clancy:plan` now shows clear error messages when board API calls fail.
- **GitHub label clarity** — "no tickets" message explains the separate planning label for GitHub users.

### 📝 Documentation

- **Updated help output** — `/clancy:help` and the installer banner now include the Planner section with `plan` and `approve` commands.
- **Updated .env.example templates** — all 3 board templates include planner queue configuration and optional roles.
- **Updated settings workflow** — planner queue settings added per board, roles toggle section added.

---

## [0.4.0] — 2026-03-12

### ♻️ Refactor

- **Architecture refactor — role-based source structure** — commands and workflows are now organized by role under `src/roles/{planner,implementer,reviewer,setup}/`. The installer walks each role's `commands/` and `workflows/` subdirectories and merges them into the same flat output directories (`.claude/commands/clancy/` and `.claude/clancy/workflows/`), preserving all existing `/clancy:*` command names. No functional changes — all commands work identically.

### 📝 Documentation

- **Role-grouped help** — `/clancy:help` now displays commands grouped by role (Implementer, Reviewer, Setup & Maintenance) instead of a flat list.
- **Updated architecture docs** — `ARCHITECTURE.md`, `CONVENTIONS.md`, `CONTRIBUTING.md`, and `CLAUDE.md` updated to reflect the new `src/roles/` structure.

---

## [0.3.9] — 2026-03-12

### ⚡️ Performance

- **Optimized runtime bundle size** — `clancy-once.js` reduced from 508 KB to 125 KB (75% smaller). Strips ~243 KB of unused zod locale translations via an esbuild plugin, and minifies both bundles. Moved from inline esbuild CLI to `esbuild.config.js` for maintainability.

---

## [0.3.8] — 2026-03-12

### ✨ Features

- **Prettier ignore handling** — During init, if a `.prettierignore` file exists, Clancy now appends `.clancy/` and `.claude/commands/clancy/` to prevent Prettier from reformatting generated files. On uninstall, those entries are cleanly removed. Projects without Prettier are unaffected.

---

## [0.3.7] — 2026-03-12

### 🐛 Bug fixes

- **Fixed feasibility check nesting error** — The `claude -p` call in the feasibility check created a blocked nested session when running inside Claude Code via `/clancy:once`. The workflow now evaluates feasibility directly (no subprocess) using the dry-run output, then runs the script with `--skip-feasibility`. The script-level `claude -p` check is preserved for standalone/AFK mode where it works correctly.

---

## [0.3.6] — 2026-03-12

### ✨ Features

- **Feasibility check before branch creation** — The once orchestrator now runs a lightweight Claude evaluation before creating branches or transitioning tickets. If a ticket requires external tools, manual testing, or non-code work, it is skipped cleanly with no dangling branches or stuck tickets. Fails open — if Claude is unavailable, the ticket proceeds normally.

---

## [0.3.5] — 2026-03-12

### 🐛 Bug fixes

- **Fixed Jira search schema validation** — The `POST /rest/api/3/search/jql` endpoint returns `isLast` instead of `total` in its response. The Zod schema required `total` as a mandatory number, causing validation to fail at runtime. Both fields are now optional.

---

## [0.3.4] — 2026-03-12

### ✨ Features

- **Non-interactive installer** — Added `--global` and `--local` CLI flags to `npx chief-clancy`. When present, the installer skips the interactive install-type prompt and auto-accepts the overwrite confirmation. The `/clancy:update` workflow now passes the detected install type, so updates run without user interaction.

---

## [0.3.3] — 2026-03-12

### 🐛 Bug fixes

- **Republish with built bundles** — v0.3.2 was published without running the build step, so the bundled runtime scripts in `.clancy/` still contained the old JQL bug. This release is identical to 0.3.2 but with correctly built bundles.

---

## [0.3.2] — 2026-03-12

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
