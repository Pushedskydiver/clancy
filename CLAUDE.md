# Clancy — Project Guide

Autonomous, board-driven development for Claude Code. npm package: `chief-clancy`.

## Key paths

| Path | Purpose |
|---|---|
| `src/installer/install.ts` | Entry point — compiled to `dist/installer/install.js`, run via `npx chief-clancy` |
| `src/installer/` | Installer modules (file-ops, hook-installer, manifest, prompts) |
| `src/roles/` | Slash commands and workflows organised by role (planner, implementer, reviewer, setup, strategist) |
| `src/roles/strategist/` | Strategist role — `/clancy:brief` and `/clancy:approve-brief` commands |
| `src/scripts/once/` | Once orchestrator — phase pipeline (13 phases in `phases/`), context (`context/`), plus modules: types, fetch-ticket, git-token, pr-creation, deliver, rework, lock, cost, resume |
| `src/scripts/once/lock/` | Lock file management (acquire, release, stale detection) |
| `src/scripts/once/cost/` | Duration-based token cost estimation + costs.log writer |
| `src/scripts/once/resume/` | Crash recovery (resume detection, branch/ticket recovery) |
| `src/scripts/afk/afk.ts` | AFK loop runner |
| `src/scripts/afk/report/` | Session report generator (.clancy/session-report.md) |
| `src/scripts/shared/` | Shared utilities (env-schema, branch, prompt, progress, etc.) |
| `src/scripts/shared/pull-request/` | PR creation + rework comment detection (github, gitlab, bitbucket, post-pr, pr-body, rework-comment) |
| `src/scripts/shared/remote/` | Remote git host detection (parseRemote, detectRemote, buildApiBaseUrl) |
| `src/scripts/shared/format/` | Shared formatters (formatDuration) |
| `src/scripts/board/` | Board-specific modules (jira, github, linear, shortcut, notion, azdo) |
| `src/schemas/` | Zod schemas for API responses and env validation |
| `src/types/` | Shared TypeScript types (board, remote, index) |
| `src/templates/CLAUDE.md` | CLAUDE.md template injected into user projects |
| `src/agents/` | 7 agent prompts — 5 specialists for `/clancy:map-codebase` + devil's advocate for `/clancy:brief` + verification gate |
| `src/agents/devils-advocate.md` | Devil's advocate agent prompt for AI-grill mode in `/clancy:brief` |
| `src/agents/verification-gate.md` | Verification gate agent — interprets lint/test/type errors, applies targeted fixes |
| `hooks/` | 8 Node.js hooks + 1 agent hook (credential guard, branch guard, context monitor, statusline, update check, post-compact, notification, drift detector, verification gate) |
| `registry/boards.json` | Board registry for community board integrations |
| `test/integration/` | Integration tests — MSW-backed flow tests (helpers, mocks/handlers, mocks/fixtures, flows) |

## Key documentation

| Doc | Purpose |
|---|---|
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | Ubiquitous language — term definitions for roles, delivery, orchestrator, strategist |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, module map, function inventory |
| [docs/VISUAL-ARCHITECTURE.md](docs/VISUAL-ARCHITECTURE.md) | Mermaid diagrams — role interactions, ticket lifecycle, delivery paths |
| [docs/LIFECYCLE.md](docs/LIFECYCLE.md) | End-to-end ticket flow — strategy → planning → implementation → epic completion, with human touchpoints |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Code conventions, naming patterns, TypeScript/hook rules |
| [docs/TESTING.md](docs/TESTING.md) | Testing strategy, co-location rules, coverage thresholds |
| [docs/GIT.md](docs/GIT.md) | Branch strategy, merge conventions |
| [docs/decisions/](docs/decisions/) | Decision docs — design decisions organised by version |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Development process — version lifecycle, DA reviews, pre-merge sweep checklist |
| [docs/TECHNICAL-REFERENCE.md](docs/TECHNICAL-REFERENCE.md) | Implementation details — boards, hooks, delivery, pipeline labels, AFK mode, build system |
| [docs/COMPARISON.md](docs/COMPARISON.md) | Clancy vs GSD vs PAUL comparison |
| [docs/roles/](docs/roles/) | Role descriptions (implementer, reviewer, setup, planner, strategist) |
| [docs/guides/](docs/guides/) | Configuration, security, troubleshooting guides |

## Running tests

```bash
npm test               # unit tests only (vitest)
npm run test:integration  # integration tests (MSW-backed, separate config)
npm run test:all       # both unit + integration
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
```

Unit tests are co-located TypeScript files (`<name>/<name>.test.ts`) using Vitest. Integration tests live in `test/integration/` with a separate Vitest config and are excluded from `npm test`.

## Commit format

This project uses gitmoji + conventional commit type:

```
<gitmoji> <type>(scope): description
```

Examples:
- `✨ feat: add credential guard hook`
- `🐛 fix: construct test values at runtime`
- `📝 docs: update CHANGELOG for 0.2.0`
- `💄 style: update badges to for-the-badge`
- `✅ test: add credential guard unit tests`
- `♻️ refactor: extract preflight into function`
- `📦 chore: bump version to 0.2.0`

## Branch strategy

See [docs/GIT.md](docs/GIT.md) for full details. Summary:

- `main` — production. Tagged releases.
- `feature/`, `fix/`, `chore/` — branch from `main`, PR back to `main`

### Direct-to-main rule

**If it runs, it needs a PR. If it's only read, direct to main is fine.**

Direct to main (no PR): decision docs (`docs/decisions/`), glossary, architecture docs (`docs/`), CLAUDE.md doc link updates, README badge/link fixes, typo corrections.

Always via branch + PR: TypeScript (`src/`, `hooks/`), tests, executable markdown (`src/roles/`, `src/templates/`, `src/agents/`), package.json, CHANGELOG.md, CI config (`.github/`).

### Development process

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full version lifecycle (brief → design → plan → build → doc sweep → self-review → ship), devil's advocate review rules, pre-merge sweep checklist, and memory hygiene rules.

## Release checklist

1. Include version bump (`package.json`) and `CHANGELOG.md` entry in the PR
2. Squash merge PR to `main`
3. GitHub Actions automatically: creates tag → builds → creates GitHub Release
4. Publish to npm: `npm publish` (or `npm publish --tag beta` for pre-releases)

## Important technical details

See [docs/TECHNICAL-REFERENCE.md](docs/TECHNICAL-REFERENCE.md) for the full reference (boards, hooks, delivery, pipeline labels, AFK mode, build system). Key items that affect daily work:

- Hook files must run as CommonJS — hooks are best-effort and must never crash
- Runtime scripts are esbuild bundles — self-contained, zero npm dependency
- `zod/mini` for all runtime validation of external data
- PR-based flow for ALL tickets — parented → epic branch, standalone → base branch
- 6 boards: Jira, GitHub Issues, Linear, Shortcut, Notion, Azure DevOps
- `--afk` flag supported on `/clancy:brief`, `/clancy:approve-brief`, `/clancy:plan`, `/clancy:approve-plan`, `/clancy:update`
