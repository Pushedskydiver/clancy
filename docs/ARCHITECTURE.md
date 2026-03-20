# Architecture

## Overview

Clancy is an npm package that installs Claude Code slash commands, workflows, and hooks into a user's project. Board logic is implemented in TypeScript ESM modules. Hooks are pre-built CommonJS. Commands and workflows are markdown.

> For visual diagrams of roles, commands, flows, and board interactions, see [VISUAL-ARCHITECTURE.md](VISUAL-ARCHITECTURE.md).

## Directory Structure

```
clancy/
├── src/
│   ├── installer/              — TypeScript installer (compiled to dist/)
│   │   ├── install.ts          — npx entry point, global vs local install
│   │   ├── file-ops/           — file copy + directory operations
│   │   ├── hook-installer/     — hook registration in settings.json
│   │   ├── manifest/           — SHA-256 manifests for patch preservation
│   │   └── prompts/            — interactive install prompts
│   ├── roles/                  — commands and workflows organised by role
│   │   ├── strategist/         — idea decomposition (brief, approve-brief)
│   │   │   ├── commands/
│   │   │   └── workflows/
│   │   ├── planner/            — backlog refinement (plan, approve)
│   │   │   ├── commands/
│   │   │   └── workflows/
│   │   ├── implementer/        — ticket execution (once, run, dry-run)
│   │   │   ├── commands/
│   │   │   └── workflows/
│   │   ├── reviewer/           — quality checks (review, status, logs)
│   │   │   ├── commands/
│   │   │   └── workflows/
│   │   └── setup/              — configuration and maintenance
│   │       ├── commands/       — init, settings, doctor, help, etc.
│   │       └── workflows/      — scaffold, init, map-codebase, etc.
│   ├── scripts/
│   │   ├── once/               — once orchestrator (phase pipeline)
│   │   │   ├── context/        — RunContext type, Phase type, createContext factory
│   │   │   ├── phases/         — 13 phase functions (lock-check → cleanup)
│   │   │   ├── types.ts        — FetchedTicket type
│   │   │   ├── fetch-ticket.ts — ticket fetch with blocker checks + HITL/AFK filtering
│   │   │   ├── git-token.ts    — resolveGitToken
│   │   │   ├── pr-creation.ts  — attemptPrCreation, buildManualPrUrl
│   │   │   ├── deliver.ts      — deliverViaPullRequest, ensureEpicBranch, deliverEpicToBase
│   │   │   ├── rework.ts       — fetchReworkFromPrReview, postReworkActions, buildReworkComment
│   │   │   ├── lock/            — lock file management (acquire, release, stale detection)
│   │   │   ├── cost/            — duration-based token cost estimation + costs.log writer
│   │   │   ├── resume/          — crash recovery (resume detection, branch/ticket recovery)
│   │   │   ├── once.ts          — run() orchestrator entry point
│   │   │   └── once.test.ts     — integration tests
│   │   ├── afk/
│   │   │   ├── afk.ts           — AFK loop runner
│   │   │   └── report/          — session report generator (.clancy/session-report.md)
│   │   ├── board/              — board-specific modules (jira, github, linear)
│   │   └── shared/             — env-schema, branch, prompt, progress, etc.
│   │       ├── pull-request/   — PR creation (github, gitlab, bitbucket, post-pr, pr-body, rework-comment)
│   │       ├── remote/         — git host detection (parseRemote, detectRemote)
│   │       └── format/         — shared formatters (formatDuration)
│   ├── schemas/                — Zod schemas for API responses and env vars
│   ├── templates/
│   │   ├── CLAUDE.md           — template injected into user's CLAUDE.md
│   │   └── .env.example.*      — env templates per board
│   ├── utils/                  — shared utilities (ansi, parse-json)
│   └── agents/                 — 7 specialist agent prompts
│       ├── tech-agent.md       — writes STACK.md + INTEGRATIONS.md
│       ├── arch-agent.md       — writes ARCHITECTURE.md
│       ├── quality-agent.md    — writes CONVENTIONS.md + TESTING.md + GIT.md + DEFINITION-OF-DONE.md
│       ├── design-agent.md     — writes DESIGN-SYSTEM.md + ACCESSIBILITY.md
│       ├── concerns-agent.md   — writes CONCERNS.md
│       ├── devils-advocate.md  — AI-grill agent for /clancy:brief (interrogates codebase, board, web)
│       └── verification-gate.md — verification gate agent (interprets lint/test/type errors, applies fixes)
├── hooks/                      — Node.js hooks installed alongside commands (pre-built CommonJS)
│   ├── clancy-credential-guard.js  — PreToolUse: blocks credential writes
│   ├── clancy-context-monitor.js   — PostToolUse: warns on low context + time guard warnings
│   ├── clancy-statusline.js        — Statusline: context bar + update notice
│   ├── clancy-check-update.js      — SessionStart: background version check
│   ├── clancy-branch-guard.js      — PreToolUse: blocks force push, protected branches, destructive resets
│   └── clancy-post-compact.js      — PostCompact: re-injects ticket context after context compaction
├── registry/
│   └── boards.json             — board definitions for community extensions
└── docs/                       — project documentation (this directory)
```

## How the Installer Works

`src/installer/install.ts` is the entry point for `npx chief-clancy` (compiled to `dist/installer/install.js`):

1. Prompts for global (`~/.claude`) or local (`./.claude`) install
2. Walks `src/roles/*/commands/` and copies command files flat → `{dest}/commands/clancy/`
   - Core roles (implementer, reviewer, setup) are always installed
   - Optional roles (planner, strategist, etc.) are only installed if listed in `CLANCY_ROLES` env var in `.clancy/.env`, or if no `.clancy/.env` exists yet (first install = install all)
3. Walks `src/roles/*/workflows/` and copies workflow files flat → `{dest}/clancy/workflows/` (same filtering)
4. Copies `hooks/*.js` → `{dest}/hooks/` (pre-built CommonJS, not compiled from TS)
5. Copies bundled runtime scripts (`dist/bundle/clancy-once.js`, `clancy-afk.js`) → `.clancy/`
6. Registers hooks in `settings.json` (PreToolUse, PostToolUse, SessionStart, statusLine)
7. Writes `{"type":"commonjs"}` package.json into hooks dir (ESM compatibility)
8. Generates SHA-256 manifests for patch preservation on future updates
9. For global installs: inlines workflow content into command files (@ paths don't resolve globally)

The installer is split into focused modules: `file-ops` (copy/mkdir), `hook-installer` (settings.json registration), `manifest` (SHA-256 checksums), and `prompts` (interactive install questions).

## Command → Workflow Relationship

Commands are thin wrappers. Each command file references a workflow:

```
/clancy:once  →  src/roles/implementer/commands/once.md  →  @clancy/workflows/once.md
```

Commands are user-facing (appear in Claude Code's `/` menu). Workflows contain the actual implementation logic and are never exposed directly.

## Planner Lifecycle

The Planner role (`/clancy:plan` and `/clancy:approve-plan`) operates as a pure workflow — no runtime script, no git operations:

```
Backlog ticket
  │
  ▼
/clancy:plan ──── preflight → fetch from planning queue → explore codebase → generate plan → post as comment
  │
  ▼
Human reviews plan on the board
  │
  ├─ Approves → /clancy:approve-plan {KEY} → plan promoted to ticket description → ticket transitioned → ready for /clancy:once
  │
  └─ Rejects (leaves feedback) → /clancy:plan → auto-detects feedback, generates improved plan
```

The planner and implementer work on **separate queues** (e.g. Jira: `Backlog` vs `To Do`, GitHub: `needs-refinement` vs `clancy` label, Linear: `backlog` vs `unstarted` state type). They never compete for the same tickets.

## Strategist Lifecycle

The Strategist role (`/clancy:brief` and `/clancy:approve-brief`) operates as a pure workflow — no runtime script, no git operations:

```
Vague idea (ticket / text / file)
  │
  ▼
/clancy:brief ──── parse input → grill phase → research → generate brief → save to .clancy/briefs/
  │
  ▼
Human reviews brief (on board or in briefs/)
  │
  ├─ Approves → /clancy:approve-brief → topo-sort → create tickets on board → link dependencies → ready for /clancy:plan or /clancy:once
  │
  └─ Leaves feedback → /clancy:brief → auto-detects feedback, revises brief
```

The grill phase has two modes:
- **Human grill** (default / `CLANCY_MODE=interactive`) — multi-round interactive Q&A
- **AI-grill** (`--afk` or `CLANCY_MODE=afk`) — devil's advocate agent (`src/agents/devils-advocate.md`) interrogates codebase, board, and web autonomously

### Key functions (strategist pipeline)

| Function | Module | Purpose |
|---|---|---|
| `fetchBlockerStatus` | `src/scripts/board/{jira,github,linear}/` | Per-board blocker check — returns whether a ticket's blocking dependencies are resolved |
| `fetchTickets` / `fetchIssues` | `src/scripts/board/{jira,github,linear}/` | Plural variants — fetch multiple candidate tickets (used by batch mode and queue filtering) |
| `fetchChildrenStatus` | `src/scripts/board/{jira,github,linear}/` + Board type | Dual-mode: returns children statuses for epic completion detection. Accessed via `Board.fetchChildrenStatus()` |
| `createBoard` | `src/scripts/board/factory/` | Factory — single switch on `config.provider`, returns a Board instance |
| `fetchCandidates` | `src/scripts/once/fetch-ticket/` | Dispatches to per-board fetch, applies HITL/AFK filtering based on `isAfk` option |

## Hook Architecture

Six hook files plus one agent-based hook run at different points in the Claude Code lifecycle:

| Hook | Event | Purpose |
|---|---|---|
| `clancy-credential-guard.js` | PreToolUse | Scans Write/Edit/MultiEdit for credentials, blocks if found |
| `clancy-branch-guard.js` | PreToolUse | Blocks force push, protected branch push, destructive resets |
| `clancy-context-monitor.js` | PostToolUse | Reads bridge file, injects warning when context ≤ 35% + time guard warnings at 80%/100% of `CLANCY_TIME_LIMIT` |
| `clancy-statusline.js` | Statusline | Writes context metrics to bridge file, renders status bar |
| `clancy-check-update.js` | SessionStart | Spawns background process to check npm for updates |
| `clancy-post-compact.js` | PostCompact | Re-injects ticket context (key, description, branch) after context compaction |
| Verification gate (agent) | Stop | Runs lint/test/typecheck before delivery, triggers self-healing retry on failure |

The statusline and context monitor communicate via a bridge file in `$TMPDIR`:
```
statusline writes → /tmp/clancy-ctx-{session}.json → context monitor reads
```

All hooks are best-effort — they catch all errors and exit cleanly rather than blocking the user.

## Script Flow

The core work happens in TypeScript modules, bundled into self-contained scripts by esbuild:

```
clancy-afk.js (loop runner — bundled, self-contained)
  └─ while i < MAX_ITERATIONS:
            run(argv)  ← once orchestrator
              0.  Lock file check (acquire lock or resume crashed session)
              1.  Preflight checks (node, git, connectivity)
              3.  Validate board-specific inputs (JQL, repo format, team ID)
              4.  Ping board (connectivity + credentials)
              4a. Epic completion scan — check if any epics have all children done → create epic PR
              5.  Check rework (scan PRs for review feedback) OR fetch fresh ticket
              5a. Max rework guard (default: 3 cycles)
              5b. Blocker check — skip tickets with unresolved blocking dependencies
              5c. HITL/AFK filtering — in AFK mode, exclude clancy:hitl tickets
              6.  Compute branches (ticket branch, target branch — epic or base)
              7.  [dry-run gate — exit here if --dry-run]
              8.  Feasibility check — can this be implemented as code? (skipped for rework)
              9.  Git: ensure epic branch (if parent), create feature branch
             10.  Transition ticket to In Progress
             11.  Build prompt + invoke Claude (claude --dangerously-skip-permissions)
             12.  Verification gate — run lint/test/typecheck, self-healing retry on failure
             13.  Push branch → create PR/MR (targets epic branch if parent, base branch otherwise)
             14.  Log to .clancy/progress.txt (with parent:KEY for epic children)
             15.  Cost log — append duration-based token estimate to .clancy/costs.log
             16.  Release lock file
             17.  Send notification (if configured)
            if "No tickets found": break
       └─ Generate session report (.clancy/session-report.md)
```

## Phase Pipeline (v0.7.1)

The once orchestrator (`src/scripts/once/once.ts`, 110 lines) is a thin pipeline runner. Business logic lives in 13 composable phase functions under `src/scripts/once/phases/`:

```
RunContext (mutable shared state)
  │
  ├── Phase 0:  lock-check      — startup lock, stale detection, AFK resume
  ├── Phase 1:  preflight       — env, board detection, validation, ping, banner
  ├── Phase 2:  epic-completion  — scan for completed epics → auto-create epic PR
  ├── Phase 3:  rework-detection — PR review feedback → rework ticket
  ├── Phase 4:  ticket-fetch     — fetch unblocked ticket, compute branches, print info
  ├── Phase 5:  dry-run          — print preview and exit if --dry-run
  ├── Phase 6:  feasibility      — can this be implemented as code?
  ├── Phase 7:  branch-setup     — git ops (epic branch, feature branch, lock write)
  ├── Phase 8:  transition       — move ticket to In Progress
  ├── Phase 9:  invoke           — build prompt, run Claude session
  ├── Phase 10: deliver          — push branch, create PR, log progress
  ├── Phase 11: cost             — duration-based token estimate → costs.log
  └── Phase 12: cleanup          — completion print, webhook notification
```

Each phase has signature `(ctx: RunContext) => Promise<boolean> | boolean`. Returns `true` to continue, `false` for early exit. The `try/catch/finally` in `once.ts` handles branch restoration (`ctx.originalBranch`) and lock cleanup (`ctx.lockOwner`).

## Board Type Abstraction (v0.7.1)

All board operations go through a unified `Board` type (`src/scripts/board/board.ts`):

```
Board type (10 methods)
  │
  ├── ping()                → { ok, error? }
  ├── validateInputs()      → string | undefined
  ├── fetchTicket(opts)     → FetchedTicket | undefined
  ├── fetchTickets(opts)    → FetchedTicket[]
  ├── fetchBlockerStatus(t) → boolean
  ├── fetchChildrenStatus() → { total, incomplete } | undefined
  ├── transitionTicket()    → boolean
  ├── ensureLabel(label)    → Promise<void>     (create label on board if missing)
  ├── addLabel(key, label)  → Promise<void>     (add label to issue, calls ensureLabel internally)
  ├── removeLabel(key, label) → Promise<void>   (remove label from issue, best-effort)
  └── sharedEnv()           → Record<string, string | undefined>

createBoard(config) — single switch on config.provider
  │
  ├── 'jira'   → createJiraBoard(env)    → plain object
  ├── 'github' → createGitHubBoard(env)  → plain object
  └── 'linear' → createLinearBoard(env)  → plain object
```

Each wrapper returns a plain object (no classes) that delegates to existing board module functions. The factory in `src/scripts/board/factory/factory.ts` is the **only** switch statement on `config.provider` in the system. Phases access the board via `ctx.board`.

Adding a new board (v0.8.0) requires: one `*-board.ts` wrapper, one case in the factory, and the board module itself. No other files touched.

## What Gets Created in User Projects

After `/clancy:init` + `/clancy:map-codebase`:

```
.clancy/
  clancy-once.js        — bundled once orchestrator (self-contained, copied by installer)
  clancy-afk.js         — bundled AFK loop runner (self-contained, copied by installer)
  docs/                 — 10 structured docs (read before every run)
  progress.txt          — append-only completion log
  costs.log             — duration-based token cost estimates per ticket
  lock.json           — lock file for crash recovery (transient, deleted on success)
  session-report.md     — AFK session summary (generated after /clancy:run)
  .env                  — board credentials (gitignored)
  .env.example          — credential template
```

Plus a `<!-- clancy:start -->` / `<!-- clancy:end -->` block in the project's `CLAUDE.md`.
