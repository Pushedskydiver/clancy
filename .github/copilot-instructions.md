# Copilot Instructions — Clancy

Autonomous, board-driven development for Claude Code. npm package: `chief-clancy`.

## Project overview

Clancy is a CLI tool installed via `npx chief-clancy`. It scaffolds slash commands, hooks, and board integrations (Jira, GitHub Issues, Linear, Shortcut, Notion, Azure DevOps) into Claude Code projects. The runtime scripts (`once` orchestrator, `afk` loop) are self-contained esbuild bundles with zero runtime npm dependency.

## Tech stack

- **Language:** TypeScript (ESM, strict mode)
- **Runtime:** Node 22+
- **Build:** `tsc && tsc-alias && esbuild` (path alias `~/` → `./src/`)
- **Test:** Vitest (co-located unit tests + MSW integration tests + real-API E2E tests)
- **Lint:** ESLint + Prettier
- **Validation:** `zod/mini` for all runtime validation of external data
- **Package:** `"type": "module"` in package.json

## Code conventions

- **File naming:** kebab-case (`git-ops.ts`, `env-schema.ts`)
- **Test co-location:** `<name>/<name>.ts` + `<name>/<name>.test.ts`
- **Imports:** Use `~/` path alias, always include `.js` extension
- **Types:** Prefer `type` over `interface`
- **Error handling:** Separate try/catch for network, HTTP status, and JSON parse errors in API modules. Hooks and notifications are best-effort (never throw).
- **Security:** Use `execFileSync` (argument arrays), never `execSync` with string interpolation. Credential test values must be constructed at runtime to avoid GitHub push protection.

## Commit format

Gitmoji + conventional commit type:

```
<gitmoji> <type>(scope): description
```

Examples: `✨ feat:`, `🐛 fix:`, `♻️ refactor:`, `📝 docs:`, `📦 chore:`, `✅ test:`, `💄 style:`

## Branch strategy

- `main` — production, tagged releases
- `feature/`, `fix/`, `chore/` — branch from `main`, PR back to `main`
- **Direct to main:** docs only (`docs/`, CLAUDE.md doc links, README badges). If it runs, it needs a PR.

## Architecture

- **Phase pipeline:** `src/scripts/once/once.ts` (~115 lines) is a thin runner calling phase functions in `src/scripts/once/phases/`
- **Board type:** `src/scripts/board/board.ts` defines a unified `Board` interface. 6 board wrappers + factory in `src/scripts/board/factory/`
- **Hooks:** 8 command hooks + 1 agent hook in `hooks/` (CommonJS, pre-built)
- **Roles:** 5 roles in `src/roles/` — Planner (optional), Strategist (optional), Implementer, Reviewer, Setup
- **Agents:** 7 agent prompts in `src/agents/` (5 map-codebase specialists, devils-advocate, verification-gate)

## Key technical details

- 6 boards: Jira, GitHub Issues, Linear, Shortcut, Notion, Azure DevOps
- Jira uses `POST /rest/api/3/search/jql` (old GET `/search` removed Aug 2025)
- Linear personal API keys do NOT use "Bearer" prefix (OAuth tokens do)
- Notion has 3 req/s rate limit — all calls use `retryFetch` utility
- Azure DevOps uses WIQL queries — `isSafeWiqlValue()` for injection defence
- Hook files run as CommonJS (installer writes `{"type":"commonjs"}` into hooks dir)
- Pipeline labels: `clancy:brief` → `clancy:plan` → `clancy:build` control ticket flow
- `FetchedTicket` type lives in `src/types/board.ts` (shared across boards and orchestrator)
- PR-based delivery for ALL tickets — parented tickets target epic branch, standalone target base branch
- Epic completion: auto-creates PR from `epic/{key}` → base when all children done
- Single-child skip: if only 1 child, PR targets base directly with `Closes #{parent}`

## Key paths

| Path | Purpose |
|---|---|
| `src/installer/install.ts` | Entry point |
| `src/scripts/once/once.ts` | Phase pipeline orchestrator (~115 lines) |
| `src/scripts/once/phases/` | Phase functions (lock-check → cleanup) |
| `src/scripts/once/context/` | RunContext type |
| `src/scripts/afk/afk.ts` | AFK loop runner |
| `src/scripts/board/` | 6 board modules + Board type + factory |
| `src/scripts/shared/` | Shared utilities |
| `src/schemas/` | Zod schemas |
| `src/roles/` | Slash commands and workflows by role |
| `src/agents/` | 7 agent prompts |
| `hooks/` | 8+1 pre-built CommonJS hooks |
| `test/integration/` | MSW-backed integration tests (Claude simulator, temp repo, env fixtures) |
| `test/e2e/` | Real-API E2E tests (ticket factory, cleanup, orphan GC) |

## Testing

```bash
npm test                      # unit tests (co-located vitest)
npm run test:integration      # integration tests (MSW + Claude simulator)
npm run test:all              # unit + integration
npm run test:e2e              # E2E tests (real APIs — needs .env.e2e credentials)
npm run test:e2e -- github    # E2E for a single board
npm run test:e2e:gc           # orphan ticket cleanup
npm run test:fixtures:validate  # validate MSW fixtures against Zod schemas (offline)
npm run test:fixtures:live      # validate real API auth endpoints against Zod schemas
npm run typecheck             # tsc --noEmit
npm run lint                  # eslint + prettier
```

## CI

- **CI** (`.github/workflows/ci.yml`): unit tests + integration tests on push/PR to main
- **E2E** (`.github/workflows/e2e-tests.yml`): weekly (Monday 6am UTC) + manual dispatch. Orphan GC → per-board matrix (6 boards) + live schema validation. Uses `QA_GITHUB_TOKEN` / `QA_GITHUB_REPO` secrets (not the built-in `GITHUB_TOKEN`).
- **Release** (`.github/workflows/release.yml`): auto-tag + GitHub Release on version bump
