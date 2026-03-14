# Clancy — Project Guide

Autonomous, board-driven development for Claude Code. npm package: `chief-clancy`.

## Key paths

| Path | Purpose |
|---|---|
| `src/installer/install.ts` | Entry point — compiled to `dist/installer/install.js`, run via `npx chief-clancy` |
| `src/installer/` | Installer modules (file-ops, hook-installer, manifest, prompts) |
| `src/roles/` | Slash commands and workflows organised by role (planner, implementer, reviewer, setup) |
| `src/scripts/once/once.ts` | Unified once orchestrator (all 3 boards) |
| `src/scripts/afk/afk.ts` | AFK loop runner |
| `src/scripts/shared/` | Shared utilities (env-schema, branch, prompt, progress, etc.) |
| `src/scripts/shared/feedback/` | Board-agnostic reviewer feedback fetching |
| `src/scripts/shared/pull-request/` | PR creation modules (github, gitlab, bitbucket, post-pr, pr-body, rework-comment) |
| `src/scripts/shared/remote/` | Remote git host detection (parseRemote, detectRemote, buildApiBaseUrl) |
| `src/scripts/shared/format/` | Shared formatters (formatDuration) |
| `src/scripts/board/` | Board-specific modules (jira, github, linear) |
| `src/schemas/` | Zod schemas for API responses and env validation |
| `src/types/` | Shared TypeScript types (board, remote, index) |
| `src/templates/CLAUDE.md` | CLAUDE.md template injected into user projects |
| `src/agents/` | 5 specialist agent prompts for `/clancy:map-codebase` |
| `hooks/` | 4 Node.js hooks (credential guard, context monitor, statusline, update check) |
| `registry/boards.json` | Board registry for community board integrations |

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

- `main` — production. Tagged releases. Never commit directly.
- `feature/`, `fix/`, `chore/` — branch from `main`, PR back to `main`

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
- PR-based flow: when a ticket has no parent (epic/milestone), Clancy pushes the feature branch and creates a PR instead of squash-merging locally
- Remote detection: `parseRemote()` handles GitHub, GitLab, Bitbucket Cloud/Server, Azure DevOps, GHE, and self-hosted instances
- Git host auth: GitHub uses Bearer token, GitLab uses PRIVATE-TOKEN header, Bitbucket uses Basic Auth
- `CLANCY_GIT_PLATFORM` and `CLANCY_GIT_API_URL` override auto-detection for custom domains
- `CLANCY_STATUS_REVIEW` is used when creating a PR (falls back to `CLANCY_STATUS_DONE`)
- GitHub Issues reuse `GITHUB_TOKEN` for PR creation; Jira/Linear users configure a separate git host token
