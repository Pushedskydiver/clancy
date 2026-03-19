# Clancy — Project Guide

Autonomous, board-driven development for Claude Code. npm package: `chief-clancy`.

## Key paths

| Path | Purpose |
|---|---|
| `src/installer/install.ts` | Entry point — compiled to `dist/installer/install.js`, run via `npx chief-clancy` |
| `src/installer/` | Installer modules (file-ops, hook-installer, manifest, prompts) |
| `src/roles/` | Slash commands and workflows organised by role (planner, implementer, reviewer, setup, strategist) |
| `src/roles/strategist/` | Strategist role — `/clancy:brief` and `/clancy:approve-brief` commands |
| `src/scripts/once/` | Once orchestrator — 8 modules: types, board-ops, fetch-ticket, git-token, pr-creation, deliver, rework, once (runner) |
| `src/scripts/afk/afk.ts` | AFK loop runner |
| `src/scripts/shared/` | Shared utilities (env-schema, branch, prompt, progress, etc.) |
| `src/scripts/shared/pull-request/` | PR creation + rework comment detection (github, gitlab, bitbucket, post-pr, pr-body, rework-comment) |
| `src/scripts/shared/remote/` | Remote git host detection (parseRemote, detectRemote, buildApiBaseUrl) |
| `src/scripts/shared/format/` | Shared formatters (formatDuration) |
| `src/scripts/board/` | Board-specific modules (jira, github, linear) |
| `src/schemas/` | Zod schemas for API responses and env validation |
| `src/types/` | Shared TypeScript types (board, remote, index) |
| `src/templates/CLAUDE.md` | CLAUDE.md template injected into user projects |
| `src/agents/` | 6 agent prompts — 5 specialists for `/clancy:map-codebase` + devil's advocate for `/clancy:brief` |
| `src/agents/devils-advocate.md` | Devil's advocate agent prompt for AI-grill mode in `/clancy:brief` |
| `hooks/` | 4 Node.js hooks (credential guard, context monitor, statusline, update check) |
| `registry/boards.json` | Board registry for community board integrations |

## Key documentation

| Doc | Purpose |
|---|---|
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | Ubiquitous language — term definitions for roles, delivery, orchestrator, strategist |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, module map, function inventory |
| [docs/VISUAL-ARCHITECTURE.md](docs/VISUAL-ARCHITECTURE.md) | Mermaid diagrams — role interactions, ticket lifecycle, delivery paths |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Code conventions, naming patterns, TypeScript/hook rules |
| [docs/TESTING.md](docs/TESTING.md) | Testing strategy, co-location rules, coverage thresholds |
| [docs/GIT.md](docs/GIT.md) | Branch strategy, merge conventions |
| [docs/design/](docs/design/) | Design docs — strategist flows, epic branch workflow |
| [docs/roles/](docs/roles/) | Role descriptions (implementer, reviewer, setup, planner, strategist) |
| [docs/guides/](docs/guides/) | Configuration, security, troubleshooting guides |

## Running tests

```bash
npm test          # all unit tests (vitest)
npm run typecheck # tsc --noEmit
npm run lint      # eslint
```

Tests are co-located TypeScript files (`<name>/<name>.test.ts`) using Vitest.

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

Direct to main (no PR): design docs (`docs/design/`), glossary, architecture docs (`docs/`), CLAUDE.md doc link updates, README badge/link fixes, typo corrections.

Always via branch + PR: TypeScript (`src/`, `hooks/`), tests, executable markdown (`src/roles/`, `src/templates/`, `src/agents/`), package.json, CHANGELOG.md, CI config (`.github/`).

## Release checklist

1. Include version bump (`package.json`) and `CHANGELOG.md` entry in the PR
2. Squash merge PR to `main`
3. GitHub Actions automatically: creates tag → builds → creates GitHub Release
4. Publish to npm: `npm publish` (or `npm publish --tag beta` for pre-releases)

## Important technical details

- Jira uses the new `POST /rest/api/3/search/jql` endpoint (old GET `/search` removed Aug 2025)
- Linear personal API keys do NOT use "Bearer" prefix (OAuth tokens do)
- Linear filters by `state.type: "unstarted"` (enum), not state name (team-specific)
- Hook files must run as CommonJS — the installer writes `{"type":"commonjs"}` package.json into the hooks directory
- Hooks are best-effort — they must never crash or block the user's workflow
- TypeScript modules use `zod/mini` for all runtime validation of external data
- Path aliases (`~/`) are resolved by `tsc-alias` at build time
- Runtime scripts (`clancy-once.js`, `clancy-afk.js`) are esbuild bundles — self-contained, zero runtime dependency on the npm package
- `dist/bundle/` contains the bundled scripts; the installer copies them to `.clancy/` during install
- PR-based flow: all tickets create PRs — parented tickets target the epic branch (`epic/{key}` or `milestone/{slug}`), standalone tickets target the base branch. When all children are done, Clancy auto-creates the epic PR to the base branch
- Remote detection: `parseRemote()` handles GitHub, GitLab, Bitbucket Cloud/Server, Azure DevOps, GHE, and self-hosted instances
- Git host auth: GitHub uses Bearer token, GitLab uses PRIVATE-TOKEN header, Bitbucket uses Basic Auth
- `CLANCY_GIT_PLATFORM` and `CLANCY_GIT_API_URL` override auto-detection for custom domains
- `CLANCY_STATUS_REVIEW` is used when creating a PR (falls back to `CLANCY_STATUS_DONE`)
- GitHub Issues reuse `GITHUB_TOKEN` for PR creation; Jira/Linear users configure a separate git host token
- `fetchChildrenStatus` uses dual-mode: `Epic: {key}` text convention in ticket descriptions + native API fallback (Jira JQL, GitHub body search, Linear relations)
- `fetchBlockerStatus` checks blockers before ticket pickup — Jira issueLinks, GitHub body parsing (`Blocked by #N`), Linear relations
- HITL/AFK queue filtering: tickets labelled `clancy:hitl` are skipped in AFK mode, ensuring human-in-the-loop tickets only run interactively
- `CLANCY_MODE` env var (`interactive` | `afk`) controls grill mode detection — human grill in interactive, AI-grill (devil's advocate agent) in AFK
- `Epic: {key}` description convention: child tickets include this text for cross-platform epic completion detection
- `CLANCY_BRIEF_ISSUE_TYPE`, `CLANCY_BRIEF_EPIC`, `CLANCY_COMPONENT` env vars configure strategist ticket creation
