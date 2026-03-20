# Technical Reference

Implementation details, conventions, and gotchas. Read this when working on specific features — not every session needs it.

For architecture overview, see [ARCHITECTURE.md](ARCHITECTURE.md). For code conventions, see [CONVENTIONS.md](CONVENTIONS.md).

---

## Board Integration

- Jira uses the new `POST /rest/api/3/search/jql` endpoint (old GET `/search` removed Aug 2025)
- Linear personal API keys do NOT use "Bearer" prefix (OAuth tokens do)
- Linear filters by `state.type: "unstarted"` (enum), not state name (team-specific)
- Setup workflows support 6 boards: Jira, GitHub Issues, Linear, Shortcut, Notion, Azure DevOps
- `fetchChildrenStatus` uses dual-mode: `Epic: {key}` text convention in ticket descriptions + native API fallback (Jira JQL, GitHub body search, Linear relations)
- `fetchBlockerStatus` checks blockers before ticket pickup — Jira issueLinks, GitHub body parsing (`Blocked by #N`), Linear relations
- Board label methods: `ensureLabel` (create-if-missing), `addLabel` (add to issue, calls ensureLabel internally), `removeLabel` (best-effort removal) on the Board type

## Hooks

- Hook files must run as CommonJS — the installer writes `{"type":"commonjs"}` package.json into the hooks directory
- Hooks are best-effort — they must never crash or block the user's workflow
- Verification gates: agent-based Stop hook runs lint/test/typecheck before delivery, self-healing retry up to `CLANCY_FIX_RETRIES` (default 2)
- Branch guard hook: PreToolUse hook blocks force push, protected branch push, destructive resets. Configurable via `CLANCY_BRANCH_GUARD`
- Time guard: PostToolUse warnings at 80%/100% of `CLANCY_TIME_LIMIT` (default 30 min), integrated into context-monitor hook
- PostCompact hook: re-injects ticket context (key, description, branch) after Claude Code compacts the context window
- Desktop notifications: `CLANCY_DESKTOP_NOTIFY` enables/disables native OS desktop notifications via the notification hook (macOS osascript, Linux notify-send, Windows PowerShell)
- Drift detector: PostToolUse hook compares `.clancy/version.json` against installed package VERSION file. Warns once per session when versions differ
- Version tracking: installer writes `.clancy/version.json` on install/update containing `{ version, installedAt }`

## Build & Runtime

- TypeScript modules use `zod/mini` for all runtime validation of external data
- Path aliases (`~/`) are resolved by `tsc-alias` at build time
- Runtime scripts (`clancy-once.js`, `clancy-afk.js`) are esbuild bundles — self-contained, zero runtime dependency on the npm package
- `dist/bundle/` contains the bundled scripts; the installer copies them to `.clancy/` during install

## Delivery & Git

- PR-based flow: all tickets create PRs — parented tickets target the epic branch (`epic/{key}` or `milestone/{slug}`), standalone tickets target the base branch. When all children are done, Clancy auto-creates the epic PR to the base branch
- Single-child parent auto-close: when single-child skip is active, the child PR body includes `Closes #{parent}` (GitHub only, valid issue refs only) so the parent auto-closes on merge
- PR retry phase (2a): retries PR creation for tickets that were pushed but failed to create a PR (network recovery). Scans progress.txt for PUSHED entries without PR_CREATED
- Remote detection: `parseRemote()` handles GitHub, GitLab, Bitbucket Cloud/Server, Azure DevOps, GHE, and self-hosted instances
- Git host auth: GitHub uses Bearer token, GitLab uses PRIVATE-TOKEN header, Bitbucket uses Basic Auth
- `CLANCY_GIT_PLATFORM` and `CLANCY_GIT_API_URL` override auto-detection for custom domains
- `CLANCY_STATUS_REVIEW` is used when creating a PR (falls back to `CLANCY_STATUS_DONE`)
- GitHub Issues reuse `GITHUB_TOKEN` for PR creation; Jira/Linear users configure a separate git host token
- Lock file (`.clancy/lock.json`): prevents double-runs, enables crash recovery via PID check + resume detection
- Cost logging: duration-based token estimate per ticket appended to `.clancy/costs.log` using `CLANCY_TOKEN_RATE` (default 6600 tokens/min)
- Session report: `.clancy/session-report.md` generated after `/clancy:run` summarises completed/failed tickets

## Pipeline Labels

- 3 labels (`CLANCY_LABEL_BRIEF`, `CLANCY_LABEL_PLAN`, `CLANCY_LABEL_BUILD`) control ticket flow through stages
- `CLANCY_LABEL` and `CLANCY_PLAN_LABEL` are deprecated but work as fallbacks
- Transitions use add-before-remove for crash safety
- `--skip-plan` flag on `/clancy:approve-brief` applies `CLANCY_LABEL_BUILD` directly, skipping the planning queue

## AFK / Autonomous Mode

- `CLANCY_MODE` env var (`interactive` | `afk`) controls grill mode and confirmation prompts — human grill + prompts in interactive, AI-grill + auto-confirm in AFK
- Per-invocation override: `--afk` flag (supported on `/clancy:brief`, `/clancy:approve-brief`, `/clancy:plan`, `/clancy:approve-plan`, `/clancy:update`)
- HITL/AFK queue filtering: tickets labelled `clancy:hitl` are skipped in AFK mode, ensuring human-in-the-loop tickets only run interactively
- AFK auto-pull: all workflows with branch freshness checks auto-pull in AFK mode instead of prompting
- Quiet hours: `CLANCY_QUIET_START` and `CLANCY_QUIET_END` (HH:MM 24h format) pause AFK runs during the configured window. Handles overnight windows.

## Strategist

- `Epic: {key}` description convention: child tickets include this text for cross-platform epic completion detection
- `CLANCY_BRIEF_ISSUE_TYPE`, `CLANCY_BRIEF_EPIC`, `CLANCY_COMPONENT` env vars configure strategist ticket creation
