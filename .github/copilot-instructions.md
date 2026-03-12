# Copilot Instructions — Clancy

Autonomous, board-driven development for Claude Code. npm package: `chief-clancy`.

## Project overview

Clancy is a CLI tool installed via `npx chief-clancy`. It scaffolds slash commands, hooks, and board integrations (Jira, GitHub Issues, Linear) into Claude Code projects. The runtime scripts (`once` orchestrator, `afk` loop) are TypeScript ESM modules imported from the installed package via thin JS shims.

## Tech stack

- **Language:** TypeScript (ESM, strict mode)
- **Runtime:** Node 22+
- **Build:** `tsc && tsc-alias` (path alias `~/` → `./src/`)
- **Test:** Vitest with v8 coverage (~80% thresholds)
- **Lint:** ESLint + Prettier
- **Validation:** `zod/mini` for all runtime validation of external data
- **Package:** `"type": "module"` in package.json

## Code conventions

- **File naming:** kebab-case (`git-ops.ts`, `env-schema.ts`)
- **Test co-location:** `<name>/<name>.ts` + `<name>/<name>.test.ts`
- **Imports:** Use `~/` path alias, always include `.js` extension
- **Types:** Prefer `type` over `interface`
- **Docs:** TSDoc with `@param`, `@returns`, `@example` where helpful
- **Error handling:** Separate try/catch for network, HTTP status, and JSON parse errors in API modules. Hooks and notifications are best-effort (never throw).
- **Security:** Use `execFileSync` (argument arrays), never `execSync` with string interpolation. Credential test values must be constructed at runtime to avoid GitHub push protection.

## Commit format

Gitmoji + conventional commit type:

```
<gitmoji> <type>(scope): description
```

Examples: `✨ feat:`, `🐛 fix:`, `♻️ refactor:`, `📝 docs:`, `📦 chore:`, `✅ test:`, `💄 style:`

## Branch strategy

- `main` — production, tagged releases, never commit directly
- `develop` — integration branch, never commit directly
- `feature/`, `fix/`, `chore/` — branch from `develop`
- `hotfix/` — branch from `main`
- `release/` — branch from `develop` for release prep

## Key technical details

- Jira uses `POST /rest/api/3/search/jql` (old GET `/search` was removed Aug 2025)
- Linear personal API keys do NOT use "Bearer" prefix (OAuth tokens do)
- Linear filters by `state.type: "unstarted"` (enum), not state name (team-specific)
- Hook files run as CommonJS (installer writes `{"type":"commonjs"}` package.json into hooks dir)
- Git branch deletion uses `-D` (force) because squash merges leave branches "unmerged" from git's perspective
- GitHub Issues endpoint returns PRs too — results are filtered client-side

## Key paths

| Path | Purpose |
|---|---|
| `src/installer/install.ts` | Entry point (compiled to `dist/installer/install.js`) |
| `src/scripts/once/once.ts` | Unified once orchestrator (all 3 boards) |
| `src/scripts/afk/afk.ts` | AFK loop runner |
| `src/scripts/board/` | Board-specific modules (jira, github, linear) |
| `src/scripts/shared/` | Shared utilities (env-schema, branch, git-ops, etc.) |
| `src/schemas/` | Zod schemas for API responses and env validation |
| `src/roles/` | Commands and workflows organised by role (planner, implementer, reviewer, setup) |
| `hooks/` | 4 pre-built CommonJS hooks |

## Running checks

```bash
npm test          # vitest (all unit tests)
npm run typecheck # tsc --noEmit
npm run lint      # eslint + prettier
```
