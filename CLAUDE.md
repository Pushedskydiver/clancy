# Clancy — Project Guide

Autonomous, board-driven development for Claude Code. npm package: `chief-clancy`.

## Key paths

| Path | Purpose |
|---|---|
| `src/installer/install.ts` | Entry point — compiled to `dist/installer/install.js`, run via `npx chief-clancy` |
| `src/installer/` | Installer modules (file-ops, hook-installer, manifest, prompts) |
| `src/commands/*.md` | 14 slash commands installed to `.claude/commands/clancy/` |
| `src/workflows/*.md` | Implementation workflows referenced by commands |
| `src/scripts/once/once.ts` | Unified once orchestrator (all 3 boards) |
| `src/scripts/afk/afk.ts` | AFK loop runner |
| `src/scripts/shared/` | Shared utilities (env-schema, branch, prompt, progress, etc.) |
| `src/scripts/board/` | Board-specific modules (jira, github, linear) |
| `src/schemas/` | Zod schemas for API responses and env validation |
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
- `develop` — integration branch. Never commit directly.
- `feature/`, `fix/`, `chore/` — branch from `develop`
- `hotfix/` — branch from `main` for urgent production fixes
- `release/` — branch from `develop` for release prep

## Release checklist

1. Create `release/vX.Y.Z` from `develop`
2. Update `CHANGELOG.md` with the new version entry
3. Bump version in `package.json`
4. Merge release branch to `main`
5. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`
6. Verify the GitHub Actions release workflow completed
7. Publish to npm: `npm publish` (or `npm publish --tag beta` for pre-releases)
8. Merge `main` back into `develop`

## Important technical details

- Jira uses the new `POST /rest/api/3/search/jql` endpoint (old GET `/search` removed Aug 2025)
- Linear personal API keys do NOT use "Bearer" prefix (OAuth tokens do)
- Linear filters by `state.type: "unstarted"` (enum), not state name (team-specific)
- Hook files must run as CommonJS — the installer writes `{"type":"commonjs"}` package.json into the hooks directory
- Hooks are best-effort — they must never crash or block the user's workflow
- TypeScript modules use `zod/mini` for all runtime validation of external data
- Path aliases (`~/`) are resolved by `tsc-alias` at build time
- User projects get board-agnostic JS shims that `import('chief-clancy/scripts/once')` from the installed package
