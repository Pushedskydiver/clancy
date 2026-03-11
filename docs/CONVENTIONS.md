# Conventions

## Languages

| Language | Used for |
|---|---|
| Bash | Shell scripts (`src/templates/scripts/`), unit tests (`test/unit/`) |
| Node.js (CommonJS) | Installer (`bin/install.js`), hooks (`hooks/`) |
| Markdown | Commands, workflows, agent prompts, documentation |
| JSON | Fixtures, board registry, package.json, manifests |

## Shell Scripts

- Shebang: `#!/usr/bin/env bash`
- Always: `set -euo pipefail`
- Must pass `shellcheck` (enforced by CI)
- Use `jq` for all JSON parsing — never grep/sed/awk on JSON
- Use `readonly` for constants and flags after assignment
- Preflight checks at the top of every script: binary check, `.env` validation, git state, board reachability
- Quote all variable expansions: `"$VAR"` not `$VAR`
- Use `jq --arg` for safe JSON construction — never interpolate variables into JSON strings

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
| Shell scripts | `clancy-<name>.sh` | `clancy-once.sh`, `clancy-afk.sh` |
| Hook files | `clancy-<name>.js` | `clancy-credential-guard.js` |
| Command files | `<name>.md` | `once.md`, `settings.md` |
| Workflow files | `<name>.md` | `scaffold.md`, `init.md` |
| Test files | `<name>.test.sh` | `jira.test.sh`, `credential-guard.test.sh` |
| Fixture files | `<board>-<scenario>.json` | `jira-happy-path.json`, `github-empty.json` |
| Env vars | `CLANCY_<NAME>` or `SCREAMING_SNAKE` | `CLANCY_BASE_BRANCH`, `JIRA_API_TOKEN` |
| Branches | `type/short-description` | `feature/context-monitor` |

## File Organisation

- One command per file in `src/commands/`
- One workflow per file in `src/workflows/`
- Commands and workflows are 1:1 (command references workflow)
- Agent prompts in `src/agents/` — one per specialist
- Shell script templates in `src/templates/scripts/`
- All hooks in `hooks/` at the project root
- Test fixtures mirror board names: `jira-*.json`, `github-*.json`, `linear-*.json`

## Scaffold Sync Rule

The `scaffold.md` workflow embeds exact copies of shell scripts and `.env.example` files from `src/templates/`. If you change a source template, you must update the embedded copy in `src/workflows/scaffold.md`. The drift test (`test/unit/scaffold.test.sh`) will catch any divergence.
