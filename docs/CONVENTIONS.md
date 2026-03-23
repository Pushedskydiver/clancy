# Conventions

## Languages

| Language | Used for |
|---|---|
| TypeScript (ESM) | Board modules (`src/scripts/`), shared utilities, tests (`*.test.ts`) |
| Node.js (CommonJS) | Hooks (`hooks/`) — pre-built, not compiled from TS |
| Markdown | Commands, workflows, agent prompts, documentation |
| JSON | Board registry, package.json, tsconfig |

## TypeScript

- ESM with `NodeNext` module resolution — use `.js` extensions in imports
- `zod/mini` for runtime validation of env vars and API responses
- Discriminated unions for board config (`BoardConfig = { provider: 'jira'; env: JiraEnv } | ...`)
- Co-located tests: `<name>/<name>.ts` + `<name>/<name>.test.ts`
- Path aliases: `~/` maps to `src/` via `tsc-alias`
- Vitest as test runner with ~80% coverage thresholds
- Prefer pure functions — side effects only at the edges (CLI entry points)

## Node.js (Hooks only)

- `'use strict';` at the top of every file
- CommonJS only (`require`/`module.exports`) — hooks must work in ESM projects
- Zero dependencies — only Node.js built-ins (`fs`, `path`, `os`, `readline`, `child_process`, `crypto`)
- Best-effort error handling: `try/catch` at the top level, exit cleanly on failure
- Hooks read from stdin (JSON), write to stdout (JSON), and must respond within 3 seconds
- Hooks are pre-built CommonJS — they are NOT compiled from TypeScript

## Markdown (Commands + Workflows)

- Commands are thin wrappers that reference workflows via `@` paths
- Workflows contain the full implementation logic
- Agent prompts define the scanning instructions for `/clancy:map-codebase`
- Use ATX-style headings (`#`, `##`, `###`)
- Fenced code blocks with language identifiers

## Naming

| Thing | Convention | Example |
|---|---|---|
| TypeScript modules | `<name>/<name>.ts` | `env-schema/env-schema.ts` |
| Test files | `<name>/<name>.test.ts` | `env-schema/env-schema.test.ts` |
| JS shims (user project) | `clancy-<name>.js` | `clancy-once.js`, `clancy-afk.js` |
| Hook files | `clancy-<name>.js` | `clancy-credential-guard.js` |
| Command files | `<name>.md` | `once.md`, `settings.md` |
| Workflow files | `<name>.md` | `scaffold.md`, `init.md` |
| Env vars | `CLANCY_<NAME>` or `SCREAMING_SNAKE` | `CLANCY_BASE_BRANCH`, `JIRA_API_TOKEN` |
| Branches | `type/short-description` | `feature/context-monitor` |

## File Organisation

- Commands and workflows organised by role in `src/roles/{planner,implementer,reviewer,setup}/`
- One command per file in `src/roles/{role}/commands/`
- One workflow per file in `src/roles/{role}/workflows/`
- Commands reference workflows, except `help` (standalone command) and `scaffold` (internal workflow used by `init`)
- Agent prompts in `src/agents/` — one per specialist
- Board modules and shared utilities in `src/scripts/`
- All hooks in `hooks/` at the project root

## Error Handling

- **Board operations are best-effort** — label CRUD, transitions, and PR actions catch errors and `console.warn`. Never throw from a board method.
- **`safeLabel(fn, operation)`** — shared try-catch + warn wrapper for label operations (`src/scripts/board/label-helpers/`).
- **`fetchAndParse<T>()`** — returns `undefined` on any failure (network, HTTP status, invalid JSON, schema mismatch). Caller checks for `undefined`.
- **Delivery is push-first** — `deliverViaPullRequest` considers push success as delivery success. PR creation is best-effort.

## Patterns Introduced in v0.8.24

| Pattern | Location | Purpose |
|---|---|---|
| `fetchAndParse<T>()` | `src/scripts/shared/http/fetch-and-parse.ts` | Single-request + JSON + Zod validation. Optional `fetcher` param for custom fetch (e.g., Notion's `retryFetch`). |
| `DeliveryOutcome` | `src/scripts/once/deliver/outcome.ts` | Discriminated union for PR delivery results. `computeDeliveryOutcome()` is pure; `logOutcome()` and `progressForOutcome()` handle side effects. |
| `DeliveryParams` | `src/scripts/once/deliver/deliver.ts` | Options object replacing 9 positional parameters on `deliverViaPullRequest()`. |
| `PlatformReworkHandlers` | `src/scripts/once/rework/rework-handlers.ts` | Handler map replacing dual switches. Factory creates per-platform handler; callers use uniform methods. |
| `modifyLabelList<T>()` | `src/scripts/board/label-helpers/label-helpers.ts` | Generic read-modify-write with idempotence. `T extends string \| number`. |
| `buildRemoteInfo()` | `src/scripts/shared/remote/remote.ts` | Consolidated platform path extraction (was duplicated in `parseRemote` and `overrideRemotePlatform`). |

## Import Style

- ESM with `.js` extensions in all imports (TypeScript `NodeNext` resolution)
- Path alias `~/` → `src/` (resolved by `tsc-alias` at build time)
- Type imports use `import type { ... }` — enforced by `consistent-type-imports` ESLint rule
- Group imports: external packages first, then `~/` aliases, then relative paths
