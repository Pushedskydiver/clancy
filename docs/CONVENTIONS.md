# Conventions

## Languages

| Language | Used for |
|---|---|
| TypeScript (ESM) | Board modules (`src/scripts/`), shared utilities, tests (`*.test.ts`) |
| Node.js (CommonJS) | Installer (`bin/install.js`), hooks (`hooks/`) |
| Markdown | Commands, workflows, agent prompts, documentation |
| JSON | Fixtures, board registry, package.json, manifests |

## TypeScript

- ESM with `NodeNext` module resolution — use `.js` extensions in imports
- `zod/mini` for runtime validation of env vars and API responses
- Discriminated unions for board config (`BoardConfig = { provider: 'jira'; env: JiraEnv } | ...`)
- Co-located tests: `<name>/<name>.ts` + `<name>/<name>.test.ts`
- Path aliases: `~/` maps to `src/` via `tsc-alias`
- Vitest as test runner with ~80% coverage thresholds
- Prefer pure functions — side effects only at the edges (CLI entry points)

## Node.js (Hooks + Installer)

- `'use strict';` at the top of every file
- CommonJS only (`require`/`module.exports`) — hooks must work in ESM projects
- Zero dependencies — only Node.js built-ins (`fs`, `path`, `os`, `readline`, `child_process`, `crypto`)
- Best-effort error handling: `try/catch` at the top level, exit cleanly on failure
- Hooks read from stdin (JSON), write to stdout (JSON), and must respond within 3 seconds

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
| Fixture files | `<board>-<scenario>.json` | `jira-happy-path.json`, `github-empty.json` |
| Env vars | `CLANCY_<NAME>` or `SCREAMING_SNAKE` | `CLANCY_BASE_BRANCH`, `JIRA_API_TOKEN` |
| Branches | `type/short-description` | `feature/context-monitor` |

## File Organisation

- One command per file in `src/commands/`
- One workflow per file in `src/workflows/`
- Commands and workflows are 1:1 (command references workflow)
- Agent prompts in `src/agents/` — one per specialist
- Board modules and shared utilities in `src/scripts/`
- All hooks in `hooks/` at the project root
- Test fixtures mirror board names: `jira-*.json`, `github-*.json`, `linear-*.json`
