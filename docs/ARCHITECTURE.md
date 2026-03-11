# Architecture

## Overview

Clancy is an npm package that installs Claude Code slash commands, workflows, and hooks into a user's project. It has no runtime dependencies — everything is markdown, shell scripts, and vanilla Node.js.

## Directory Structure

```
clancy/
├── bin/
│   └── install.js              — npx entry point, global vs local install
├── src/
│   ├── commands/               — 14 slash command files (.md)
│   │   ├── init.md
│   │   ├── run.md
│   │   ├── once.md
│   │   ├── dry-run.md
│   │   ├── status.md
│   │   ├── review.md
│   │   ├── logs.md
│   │   ├── map-codebase.md
│   │   ├── update-docs.md
│   │   ├── settings.md
│   │   ├── doctor.md
│   │   ├── update.md
│   │   ├── uninstall.md
│   │   └── help.md
│   ├── workflows/              — implementation workflows referenced by commands
│   │   ├── scaffold.md         — writes .clancy/ structure during init
│   │   ├── init.md             — setup wizard
│   │   ├── map-codebase.md     — orchestrates 5 parallel agents
│   │   └── ...                 — one workflow per command
│   ├── templates/
│   │   ├── CLAUDE.md           — template injected into user's CLAUDE.md
│   │   └── scripts/            — 4 shell scripts
│   │       ├── clancy-once.sh          — Jira board script
│   │       ├── clancy-once-github.sh   — GitHub Issues board script
│   │       ├── clancy-once-linear.sh   — Linear board script
│   │       └── clancy-afk.sh          — loop runner (board-agnostic)
│   └── agents/                 — 5 specialist agent prompts
│       ├── tech-agent.md       — writes STACK.md + INTEGRATIONS.md
│       ├── arch-agent.md       — writes ARCHITECTURE.md
│       ├── quality-agent.md    — writes CONVENTIONS.md + TESTING.md + GIT.md + DEFINITION-OF-DONE.md
│       ├── design-agent.md     — writes DESIGN-SYSTEM.md + ACCESSIBILITY.md
│       └── concerns-agent.md   — writes CONCERNS.md
├── hooks/                      — Node.js hooks installed alongside commands
│   ├── clancy-credential-guard.js  — PreToolUse: blocks credential writes
│   ├── clancy-context-monitor.js   — PostToolUse: warns on low context
│   ├── clancy-statusline.js        — Statusline: context bar + update notice
│   └── clancy-check-update.js      — SessionStart: background version check
├── registry/
│   └── boards.json             — board definitions for community extensions
├── test/
│   ├── unit/                   — bash test scripts
│   ├── fixtures/               — JSON API response fixtures
│   └── smoke/                  — live API validation
└── docs/                       — project documentation (this directory)
```

## How the Installer Works

`bin/install.js` is the entry point for `npx chief-clancy`:

1. Prompts for global (`~/.claude`) or local (`./.claude`) install
2. Copies `src/commands/*.md` → `{dest}/commands/clancy/`
3. Copies `src/workflows/*.md` → `{dest}/clancy/workflows/`
4. Copies `hooks/*.js` → `{dest}/clancy/hooks/`
5. Registers hooks in `settings.json` (PreToolUse, PostToolUse, SessionStart, statusLine)
6. Writes `{"type":"commonjs"}` package.json into hooks dir (ESM compatibility)
7. Generates SHA-256 manifests for patch preservation on future updates
8. For global installs: inlines workflow content into command files (@ paths don't resolve globally)

## Command → Workflow Relationship

Commands are thin wrappers. Each command file references a workflow:

```
/clancy:once  →  src/commands/once.md  →  @clancy/workflows/once.md
```

Commands are user-facing (appear in Claude Code's `/` menu). Workflows contain the actual implementation logic and are never exposed directly.

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

## Shell Script Flow

The core work happens in shell scripts, not in Claude Code directly:

```
clancy-afk.sh (loop runner)
  └─ while i < MAX_ITERATIONS:
       bash clancy-once.sh          (or -github.sh / -linear.sh)
         1. Preflight checks
         2. Fetch next ticket from board API (curl + jq)
         3. Create feature branch from epic/base branch
         4. Pipe prompt to: claude --dangerously-skip-permissions
         5. Squash merge back to parent branch
         6. Delete ticket branch
         7. Log to .clancy/progress.txt
       if "No tickets found": break
```

## What Gets Created in User Projects

After `/clancy:init` + `/clancy:map-codebase`:

```
.clancy/
  clancy-once.sh        — board-specific ticket script
  clancy-afk.sh         — loop runner
  docs/                 — 10 structured docs (read before every run)
  progress.txt          — append-only completion log
  .env                  — board credentials (gitignored)
  .env.example          — credential template
```

Plus a `<!-- clancy:start -->` / `<!-- clancy:end -->` block in the project's `CLAUDE.md`.
