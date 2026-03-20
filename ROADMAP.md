# Roadmap

Clancy follows a deliberate, minimal-by-default release philosophy. Features are added when they're genuinely needed, not speculatively.

---

## v0.1.x — Foundation ✅

- `npx chief-clancy` installer
- Jira, GitHub Issues, Linear board support
- `/clancy:init`, `/clancy:run`, `/clancy:once`, `/clancy:status`, `/clancy:review`, `/clancy:logs`
- `/clancy:map-codebase` with 5 parallel specialist agents (10 docs)
- `/clancy:update-docs` incremental refresh
- `/clancy:settings` — view and change config, switch boards without re-running init
- `/clancy:doctor` — diagnose your setup, test every configured integration
- `/clancy:uninstall`, `/clancy:update`, `/clancy:help`
- `CLANCY_LABEL` filter for all three boards — limit pickup to labelled tickets in mixed backlogs
- Pre-implementation executability check — Clancy self-assesses tickets before executing, skips non-codebase work
- Figma MCP three-tier integration
- Playwright visual checks with Storybook detection and Figma design compliance comparison
- Slack/Teams webhook notifications
- Board registry for community extensibility
- Patch preservation on update — SHA-256 manifests detect user-modified files, backs them up before overwriting
- Global defaults — save settings to `~/.clancy/defaults.json`, inherited by new projects
- `/clancy:update` changelog preview and confirmation before updating
- `/clancy:uninstall` cleanup of CLAUDE.md markers and .gitignore entries

---

## v0.2.0 — Stability and DX ✅

- Jira/Linear ticket status transitions — move ticket to In Progress on pickup, Done on completion
- `/clancy:dry-run` command — dedicated dropdown command to preview the next ticket without making any changes (no git ops, no Claude call)
- Credential guard hook — PreToolUse hook that blocks writing API keys, tokens, and passwords to code files
- Targeted doc loading — load only relevant `.clancy/docs/` files per ticket rather than all 10 every run (token optimisation)
- Shellcheck CI for all shell scripts
- More test fixtures (edge cases discovered post-release)
- Auto update check via `SessionStart` hook — background npm version check at session start, surfaces notification when a newer version of `chief-clancy` is available (same pattern as GSD's `gsd-check-update.js`)
- Context window monitor via `PostToolUse` hook — warns Claude when context is running low (≤35% remaining: wrap up analysis, ≤25%: commit current work and log progress to `.clancy/progress.txt`); most valuable during `/clancy:map-codebase` and large ticket implementations. Hook infrastructure shared with the update check.

---

## v0.3.0 — TypeScript rewrite ✅

- Rewrite all Node.js code (installer, hooks) from CommonJS JavaScript to TypeScript
- Replace all bash shell scripts with TypeScript equivalents — removes bash/jq/curl as runtime dependencies
- ESM output — compile to modern ES modules
- Vitest test suite replacing bash test scripts
- Bump minimum Node.js version to latest stable (currently 22.x)
- Native Windows support — no WSL required (bash dependency removed)
- Ship compiled JS in the npm package — users never need TypeScript installed

---

## v0.4.0 — Architecture refactor ✅

- Formalize roles: Implementer, Reviewer, Setup & Maintenance (Planner added in v0.5.0)
- Restructure project source by role (`src/roles/{planner,implementer,reviewer,setup}/`)
- Installed output remains flat (`.claude/commands/clancy/`) — preserves existing `/clancy:*` command names
- Role-grouped `/clancy:help` output
- Installer walks `src/roles/*/commands/` and `src/roles/*/workflows/` and merges into flat destination
- No functional changes — existing commands work identically, all tests pass

---

## v0.5.0 — Planner role + UX improvements ✅

- `/clancy:plan` — fetch backlog tickets, explore codebase, generate structured implementation plans, post as comments to the board
- `/clancy:approve` — promote an approved plan to the ticket description (with confirmation prompt)
- Board write-back for all 3 boards: Jira (ADF comments), GitHub (Markdown comments), Linear (GraphQL comments)
- Feedback loop: `--force` re-plans by reading PO/team feedback comments from the board
- Batch mode: `/clancy:plan N` plans up to N tickets (max 10)
- Pre-exploration feasibility scan — skips non-codebase tickets from title alone before exploring files
- QA return detection — checks progress log for previously-implemented tickets, focuses plan on what needs fixing
- Figma design context — fetches Figma specs when ticket contains a URL (uses existing integration)
- Parallel Explore subagents for M/L tickets (2-3 agents, same pattern as `/clancy:map-codebase`)
- Dependency detection: blocking tickets, external APIs, unfinished designs, library upgrades
- Plan template: Summary, Acceptance Criteria, Technical Approach, Affected Files, Edge Cases, Test Plan, Dependencies, Size Estimate (S/M/L)
- New env vars: `CLANCY_PLAN_STATUS`, `CLANCY_PLAN_LABEL`, `CLANCY_PLAN_STATE_TYPE`
- Optional roles — core roles (implementer, reviewer, setup) always install; optional roles (planner) opt-in via `CLANCY_ROLES` env var
- UX improvements across all workflows — natural language input handling, stable menu mnemonics in settings, Linear team auto-detection, self-contained preflight checks, progress indicators, input validation

---

## v0.6.0 — Strategist role ✅

- `/clancy:brief` — take a vague idea (from a board ticket, inline text, or local file), research the codebase and web, produce a structured strategic brief with ticket decomposition
- `/clancy:approve-brief` — create tickets on the board from an approved brief (ticket creation via Jira, GitHub, Linear APIs)
- Grill phase — human grill (interactive, relentless, two-way) and AI-grill (devil's advocate agent, `--afk` flag / `CLANCY_MODE=afk`)
- Discovery section with source tags (human/codebase/board/web) in every brief
- Vertical slice decomposition with validation rule against horizontal layers
- HITL/AFK classification per ticket with `clancy:afk`/`clancy:hitl` labels
- Blocker-aware ticket pickup — `fetchBlockerStatus` on all 3 boards, skip blocked tickets
- `fetchChildrenStatus` dual-mode — `Epic: {key}` text convention + native API fallback
- HITL/AFK queue filtering — AFK mode skips `clancy:hitl` tickets
- Stale brief detection hook, new role hints in `/clancy:update`
- New env vars: `CLANCY_MODE`, `CLANCY_BRIEF_ISSUE_TYPE`, `CLANCY_BRIEF_EPIC`, `CLANCY_COMPONENT`

---

## v0.7.0 — Reliable autonomous mode ✅

Make AFK mode production-grade. Every feature in this version makes autonomous operation safer and higher quality. Inspired by GSD 1/2 verification gates, Claude Code's new hook types, and Devin's self-healing.

**v0.7.1** — Codebase refactor: phase pipeline (once.ts 650→110 lines, 13 phases), Board type abstraction + factory, board-ops.ts deleted, npm package trimmed. Prepares architecture for v0.8.0 board ecosystem expansion.

### Verification gates
- **Agent-based Stop hook** — runs lint/test/typecheck after implementation, before delivery. Uses Claude Code's `type: "agent"` hook on `Stop` event. Auto-detects commands from `package.json` scripts
- **Self-healing retry** — if tests fail, attempt a fix cycle (up to N retries, configurable via `CLANCY_FIX_RETRIES`, default 2). If still failing, deliver with a warning in the PR body. Inspired by GSD 1's node repair (RETRY/DECOMPOSE/PRUNE strategy)
- **PostCompact hook** — re-inject current ticket key, branch, and requirements after context compaction. Uses Claude Code's `PostCompact` event. Prevents context loss mid-ticket

### Safety hooks
- **Cost tracker** — per-ticket token usage logged to `.clancy/costs.log`. Configurable budget alert via `CLANCY_COST_LIMIT`. Summary in progress entries
- **Branch guard** — `PreToolUse` hook blocking `git push --force`, pushes to protected branches, destructive resets (`git reset --hard`, `git clean -fd`). Essential for `--dangerously-skip-permissions`
- **Time guard** — configurable per-ticket time limit via `CLANCY_TIME_LIMIT` (default 30 min). Warn at 80%, abort at 100%. Prevents runaway sessions burning tokens on infeasible work

### Crash recovery
- **Lock file** — `.clancy/lock.json` with PID, ticket key, and timestamp. On startup: if PID is dead, clean up and proceed; if alive, abort with message
- **Resume detection** — check for in-progress feature branches with uncommitted/unpushed work. Offer to resume instead of picking a new ticket
- **AFK session report** — after completing N tickets, generate a summary: what was done, what failed, estimated cost, next steps. Useful for async teams to review overnight AFK runs

---

## v0.8.0 — Team readiness (next)

Make Clancy work for teams, not just solo developers.

### Pre-requisite (Wave 0)
- **Migrate `fetch-ticket.ts` to Board type** — eliminate the dual-switch pattern (`fetch-ticket.ts` has its own board dispatch parallel to the Board wrappers). Required before adding 3 new boards to avoid maintaining 6 switch cases in two places
- **`retryFetch()` utility** — shared HTTP wrapper with exponential backoff and `Retry-After` header support in `src/scripts/shared/http/`. Required by Notion's 3 req/s rate limit, available to all boards

### Board ecosystem
- Shortcut (formerly Clubhouse) support — REST API v3, workflow state caching, `blocked` flag + story_links for blockers
- Notion database support — REST API with retry-with-backoff for 3 req/s rate limit, configurable property names (`CLANCY_NOTION_STATUS`, `CLANCY_NOTION_ASSIGNEE`, etc.)
- Azure DevOps support — WIQL queries, JSON Patch updates, two-step fetch, WIQL-specific injection validator
- Board auto-detection: extend existing `detectBoard()` with new board signals, priority ordering with prompt fallback on conflict
- `/clancy:reapply-patches` — guided restore of user-modified files backed up during updates

### Team features
- **Ticket claim check** — re-fetch guard before pickup to verify ticket is not already "In Progress" (claimed by another instance or human). Skip if claimed. Narrows race window to milliseconds
- **Quality feedback tracking** — record review cycles, CI pass rate, and rework count per ticket in `.clancy/quality.json`. Surface in `/clancy:logs` as quality trends
- **Desktop notifications** — orchestrator-level calls (`osascript`/`notify-send`/PowerShell) on ticket completion/failure/session end. Supplementary `Notification` event hook. Controlled by `CLANCY_DESKTOP_NOTIFY`
- **Quiet hours** — AFK runner check (primary) prevents new iterations during configured hours (`CLANCY_QUIET_START`/`CLANCY_QUIET_END`). PreToolUse hook (fail-safe) blocks tool execution during quiet hours — causes session to wind down, not sleep
- **Drift detector hook** — compare `.clancy/version.json` against installed npm package version. Warn if hooks or scripts are stale. Suppressed via `CLANCY_SKIP_DRIFT_CHECK`

---

## v0.9.0 — Design sub-phase in planner

Make Clancy produce design-quality UI code. Extends the planner with conditional design specifications for UI tickets. Zero external dependencies.

- **Design specifications** — planner conditionally produces `## Design Specifications` section for UI tickets: component specs, accessibility specs, content specs, user flow state machines (Mermaid), layout descriptions, pages (URL mapping)
- **2-path feedback classification** — when re-running `/clancy:plan`, classify comments as technical-only (revise plan) or everything else (revise specs + regenerate Stitch if enabled)
- **Figma MCP preserved** — Stitch is additive, not a replacement. Both optional, neither required

## v0.9.1 — Stitch + visual verification

External tool integrations isolated from the core design sub-phase.

### Google Stitch integration
- **Optional** (`CLANCY_STITCH=true`) — inside `/clancy:plan` (before approval), generate UI designs from specs via Stitch MCP. Post screenshot + prototype link as board comment. All 6 boards supported.
- **Usage tracking** — `.clancy/stitch-usage.json`, warn at 50%, skip at 100%

### Visual and accessibility verification
- **Playwright CLI** — post-delivery visual checks (phase 10a). Compare rendered output against Stitch design or spec descriptions. 3-tier URL fallback: `CLANCY_DEV_URLS` → `### Pages` → Storybook auto-detection
- **axe-core CLI** — automated WCAG compliance. A-level violations auto-fixed via follow-up commit. Time-guard aware (skips auto-fix at >= 80% budget)
- **Lighthouse CI** — performance/a11y/SEO scores. Configurable threshold (`CLANCY_LIGHTHOUSE_THRESHOLD`, default: 0 = disabled)

### v0.10.0 — Quality & triage (split from v0.9.0)
- **Security scanning pre-PR gate** — `npm audit`, secret scanning, CodeQL/Semgrep
- **Bug triage role** — investigates bug reports, creates actionable tickets with TDD fix plans
- **Auto-refresh docs** — periodic `/clancy:update-docs` after N tickets
- **Review automation** — confidence self-check before delivery

---

## v1.0.0 — Production-ready

- Stable API — no breaking changes to command signatures after this
- Full test coverage for all built-in boards
- Polished init wizard with auto-detection for common setups
- Complete documentation site
- npm package integrity checks
- Sentry CLI — optional error monitoring after ticket completion

---

## v2.0.0 — Multi-agent + platform

- **Worktree-based parallel execution** — use Claude Code's native `--worktree` flag to run multiple tickets simultaneously. Each ticket gets an isolated branch and working directory
- **Remote question routing** — route HITL questions to Slack/Telegram/webhook during AFK mode instead of skipping HITL tickets. Inspired by GSD 2's Telegram adapter
- **Claude Code plugin distribution** — repackage Clancy as a native Claude Code plugin (`claude plugin install chief-clancy`)
- **Agent teams coordination** — lead agent delegates to specialist teammates (frontend, backend, infra) using Claude Code's agent teams feature
- **Model profiles** — `CLANCY_MODEL_PROFILE=quality|balanced|budget` controls which model tier each phase uses (cheap for research, expensive for implementation)
- **Subagent persistent memory** — accumulated codebase knowledge persists across tickets, reducing re-exploration

---

## Not on the roadmap

These have been considered and deliberately excluded:

- **GUI / web dashboard** — Clancy is a CLI tool. The terminal is the UI.
- **Built-in LLM** — Clancy uses Claude Code. It is not an LLM runtime.
- **Branch protection bypass** — Clancy follows your repo's git conventions as documented in GIT.md. It never bypasses hooks or protection rules.
- **Standalone CLI rewrite** — Clancy runs inside Claude Code where the user already is. A standalone binary (like GSD 2) would lose this advantage and require maintaining a separate agent loop.
