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
│   │   ├── once/               — once orchestrator (8 modules)
│   │   │   ├── types.ts        — FetchedTicket type
│   │   │   ├── board-ops.ts    — sharedEnv, pingBoard, validateInputs, transitionToStatus, fetchEpicChildrenStatus
│   │   │   ├── fetch-ticket.ts — board-specific ticket fetch dispatch
│   │   │   ├── git-token.ts    — resolveGitToken
│   │   │   ├── pr-creation.ts  — attemptPrCreation, buildManualPrUrl
│   │   │   ├── deliver.ts      — deliverViaPullRequest, ensureEpicBranch, deliverEpicToBase
│   │   │   ├── rework.ts       — fetchReworkFromPrReview, postReworkActions, buildReworkComment
│   │   │   ├── once.ts         — run() orchestrator entry point
│   │   │   └── once.test.ts    — integration tests
│   │   ├── afk/afk.ts          — AFK loop runner
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
│   └── agents/                 — 5 specialist agent prompts
│       ├── tech-agent.md       — writes STACK.md + INTEGRATIONS.md
│       ├── arch-agent.md       — writes ARCHITECTURE.md
│       ├── quality-agent.md    — writes CONVENTIONS.md + TESTING.md + GIT.md + DEFINITION-OF-DONE.md
│       ├── design-agent.md     — writes DESIGN-SYSTEM.md + ACCESSIBILITY.md
│       └── concerns-agent.md   — writes CONCERNS.md
├── hooks/                      — Node.js hooks installed alongside commands (pre-built CommonJS)
│   ├── clancy-credential-guard.js  — PreToolUse: blocks credential writes
│   ├── clancy-context-monitor.js   — PostToolUse: warns on low context
│   ├── clancy-statusline.js        — Statusline: context bar + update notice
│   └── clancy-check-update.js      — SessionStart: background version check
├── registry/
│   └── boards.json             — board definitions for community extensions
└── docs/                       — project documentation (this directory)
```

## How the Installer Works

`src/installer/install.ts` is the entry point for `npx chief-clancy` (compiled to `dist/installer/install.js`):

1. Prompts for global (`~/.claude`) or local (`./.claude`) install
2. Walks `src/roles/*/commands/` and copies command files flat → `{dest}/commands/clancy/`
   - Core roles (implementer, reviewer, setup) are always installed
   - Optional roles (planner, etc.) are only installed if listed in `CLANCY_ROLES` env var in `.clancy/.env`, or if no `.clancy/.env` exists yet (first install = install all)
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

## Hook Architecture

Four hooks run at different points in the Claude Code lifecycle:

| Hook | Event | Purpose |
|---|---|---|
| `clancy-credential-guard.js` | PreToolUse | Scans Write/Edit/MultiEdit for credentials, blocks if found |
| `clancy-context-monitor.js` | PostToolUse | Reads bridge file, injects warning when context ≤ 35% |
| `clancy-statusline.js` | Statusline | Writes context metrics to bridge file, renders status bar |
| `clancy-check-update.js` | SessionStart | Spawns background process to check npm for updates |

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
              1.  Preflight checks (node, git, connectivity)
              2.  Parse .clancy/.env → detectBoard() → BoardConfig
              3.  Validate board-specific inputs (JQL, repo format, team ID)
              4.  Ping board (connectivity + credentials)
              4a. Epic completion scan — check if any epics have all children done → create epic PR
              5.  Check rework (scan PRs for review feedback) OR fetch fresh ticket
              5a. Max rework guard (default: 3 cycles)
              6.  Compute branches (ticket branch, target branch — epic or base)
              7.  [dry-run gate — exit here if --dry-run]
              8.  Feasibility check — can this be implemented as code? (skipped for rework)
              9.  Git: ensure epic branch (if parent), create feature branch
             10.  Transition ticket to In Progress
             11.  Build prompt + invoke Claude (claude --dangerously-skip-permissions)
             12.  Push branch → create PR/MR (targets epic branch if parent, base branch otherwise)
             13.  Log to .clancy/progress.txt (with parent:KEY for epic children)
             14.  Send notification (if configured)
            if "No tickets found": break
```

## What Gets Created in User Projects

After `/clancy:init` + `/clancy:map-codebase`:

```
.clancy/
  clancy-once.js        — bundled once orchestrator (self-contained, copied by installer)
  clancy-afk.js         — bundled AFK loop runner (self-contained, copied by installer)
  docs/                 — 10 structured docs (read before every run)
  progress.txt          — append-only completion log
  .env                  — board credentials (gitignored)
  .env.example          — credential template
```

Plus a `<!-- clancy:start -->` / `<!-- clancy:end -->` block in the project's `CLAUDE.md`.
