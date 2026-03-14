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

## v0.6.0 — Strategist role (next)

- `/clancy:brief` — take a vague idea (from a board ticket, inline text, or local file), research the codebase and web, produce a structured strategic brief with ticket decomposition
- `/clancy:approve-brief` — create tickets on the board from an approved brief (new capability: ticket creation via Jira, GitHub, Linear APIs)
- Input sources: board ticket (original becomes epic/parent), inline text, `--from` file, interactive prompt
- Adaptive research agents (1-4) — scales with idea complexity; codebase exploration + judgement-based web research
- `--research` flag to force web research; `--force` to re-brief with feedback
- `--list` flag to show all briefs with age, status, and stale warnings
- Brief selection via conversational inference, numeric index, or slug match
- Brief stored locally in `.clancy/briefs/` + as board comment when sourced from a ticket
- Stale brief detection — extends SessionStart hook to warn on unapproved drafts older than 7 days
- Dependency linking on ticket creation: Jira issueLinks, Linear issueRelations, GitHub cross-references
- New env vars: `CLANCY_BRIEF_ISSUE_TYPE`, `CLANCY_BRIEF_EPIC`

---

## v0.7.0 — Visual verification

- Playwright CLI integration — token-efficient alternative to Playwright MCP for visual checks. Init wizard offers CLI (recommended) or MCP mode. CLI uses `playwright-cli` commands (navigate, screenshot) instead of writing test scripts, with session isolation per ticket
- Lighthouse CI — optional enhancement to audit performance, accessibility, SEO, and best practices after UI ticket implementation. Returns a focused score summary, pairs with Playwright CLI for screenshot + audit in one pass
- axe-core CLI — optional enhancement for automated accessibility testing after UI changes. Verifies against `.clancy/docs/ACCESSIBILITY.md` conventions with specific violation reporting

---

## v0.8.0 — Board ecosystem

- Community board contributions
- Shortcut (formerly Clubhouse) support
- Notion database support
- Azure DevOps support
- Board auto-detection: Clancy detects which board is configured without asking
- `/clancy:reapply-patches` — guided restore of user-modified files backed up during updates

---

## v1.0.0 — Production-ready

- Stable API — no breaking changes to command signatures after this
- Full test coverage for all built-in boards
- Polished init wizard with auto-detection for common setups
- Complete documentation site
- npm package integrity checks
- Sentry CLI — optional enhancement to check for new errors after ticket completion. Flags regressions in the progress log and triggers notifications during AFK mode

---

## v1.1.0 — Review automation

- `/clancy:run --review` — confidence check before each ticket, pause if below threshold
- `CLANCY_AUTO_REVIEW=true` env var to enable by default
- `CLANCY_REVIEW_THRESHOLD=N` to set minimum score for auto-run
- Ticket quality trends in `/clancy:logs`

---

## v2.0.0 — Multi-agent

- Parallel ticket implementation (multiple tickets simultaneously)
- Dependency graph awareness — don't start a ticket blocked by another
- PR creation and review request automation
- Automatic test run after implementation
- Agent specialisation: frontend agent, backend agent, infra agent
- Team-mode: multiple Claude Code instances coordinating via shared queue

---

## Not on the roadmap

These have been considered and deliberately excluded:

- **GUI / web dashboard** — Clancy is a CLI tool. The terminal is the UI.
- **Built-in LLM** — Clancy uses Claude Code. It is not an LLM runtime.
- **Branch protection bypass** — Clancy follows your repo's git conventions as documented in GIT.md. It never bypasses hooks or protection rules.
