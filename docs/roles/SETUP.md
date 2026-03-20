# Setup & Maintenance Role

Setup commands configure Clancy and keep it healthy.

## Commands

| Command | What it does |
| --- | --- |
| `/clancy:init` | Wizard — choose board, collect credentials, scaffold everything |
| `/clancy:settings` | View and modify configuration (board filters, status transitions, roles) |
| `/clancy:doctor` | Diagnose issues — checks credentials, board connectivity, file integrity |
| `/clancy:map-codebase` | Generate structured docs in `.clancy/docs/` using 5 parallel specialist agents |
| `/clancy:update-docs` | Refresh codebase docs after significant changes |
| `/clancy:update` | Update Clancy to the latest version |
| `/clancy:uninstall` | Remove Clancy from the project |
| `/clancy:help` | Show all available commands |

## Init wizard

`/clancy:init` walks you through first-time setup:

1. **Choose board** — Jira, GitHub Issues, Linear, Shortcut, Notion, or Azure DevOps
2. **Enter credentials** — API keys, project keys, team IDs (stored in `.clancy/.env`)
3. **Configure filters** — label, sprint, status transitions
4. **Optional roles** — enable Strategist, Planner, or other optional roles via `CLANCY_ROLES`
5. **Scaffold** — creates `.clancy/` directory, copies runtime scripts, merges CLAUDE.md

## Settings

`/clancy:settings` provides a menu-driven interface to modify any configuration after init:

- Board filters (label, sprint, status)
- Status transitions (in-progress, done)
- Optional roles (enable/disable Strategist, Planner)
- Grill mode (`CLANCY_MODE` — interactive or afk)
- Figma integration
- Playwright visual checks
- Save as defaults for future projects

## Map codebase

`/clancy:map-codebase` spins up 5 parallel specialist agents that analyse your codebase and generate structured documentation in `.clancy/docs/`:

| Doc | What it covers |
| --- | --- |
| `STACK.md` | Languages, frameworks, dependencies |
| `ARCHITECTURE.md` | Project structure, key modules, data flow |
| `CONVENTIONS.md` | Coding patterns, naming, style |
| `TESTING.md` | Test setup, frameworks, how to run |
| `GIT.md` | Branch strategy, commit format |
| `INTEGRATIONS.md` | External APIs, services, databases |
| `DESIGN-SYSTEM.md` | UI components, tokens, patterns |
| `ACCESSIBILITY.md` | a11y approach, ARIA, testing |
| `DEFINITION-OF-DONE.md` | What "done" means for this project |
| `CONCERNS.md` | Known issues, tech debt, risks |

These docs are read by the implementer before every run, giving it full codebase context.

## Doctor

`/clancy:doctor` runs diagnostic checks:

- Board credentials are valid (makes a test API call)
- Required env vars are present
- Runtime scripts exist
- Codebase docs are populated
- Hooks are registered

## Update

`/clancy:update` checks npm for a newer version of `chief-clancy`, shows what's new from the changelog, and re-runs the installer to update commands, workflows, and runtime scripts. It detects and backs up any user-modified command and workflow files (under `.claude/commands/clancy/` and `.claude/clancy/workflows/`) before overwriting. Runtime scripts in `.clancy/` are always overwritten without backup.
