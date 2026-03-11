# Clancy — Project Guide

Autonomous, board-driven development for Claude Code. npm package: `chief-clancy`.

## Key paths

| Path | Purpose |
|---|---|
| `bin/install.js` | Entry point — `npx chief-clancy` runs this |
| `src/commands/*.md` | 14 slash commands installed to `.claude/commands/clancy/` |
| `src/workflows/*.md` | Implementation workflows referenced by commands |
| `src/templates/scripts/` | 4 shell scripts (clancy-once Jira/GitHub/Linear + clancy-afk) |
| `src/templates/CLAUDE.md` | CLAUDE.md template injected into user projects |
| `src/agents/` | 5 specialist agent prompts for `/clancy:map-codebase` |
| `hooks/` | 4 Node.js hooks (credential guard, context monitor, statusline, update check) |
| `registry/boards.json` | Board registry for community board integrations |
| `test/unit/` | Unit tests (bash) |
| `test/fixtures/` | JSON API response fixtures for all three boards |
| `test/smoke/` | Live API smoke tests |

## Running tests

```bash
npm test                      # all unit tests (94 total)
bash test/unit/jira.test.sh   # individual suite
bash test/smoke/smoke.sh      # live API (requires configured .env)
```

All tests are bash scripts that parse JSON fixtures with `jq` and assert expected values. The credential guard tests invoke the Node.js hook directly.

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

## Shell script conventions

- `#!/usr/bin/env bash` + `set -euo pipefail`
- All scripts must pass `shellcheck`
- Use `jq` for JSON parsing — never parse JSON with grep/sed/awk
- Preflight checks at the top: binary check, `.env` validation, git state, board reachability
- `readonly` for constants and flags set during argument parsing

## Important technical details

- Jira uses the new `POST /rest/api/3/search/jql` endpoint (old GET `/search` removed Aug 2025)
- Linear personal API keys do NOT use "Bearer" prefix (OAuth tokens do)
- Linear filters by `state.type: "unstarted"` (enum), not state name (team-specific)
- Hook files must run as CommonJS — the installer writes `{"type":"commonjs"}` package.json into the hooks directory
- Hooks are best-effort — they must never crash or block the user's workflow
- The `scaffold.md` workflow embeds exact script content. If you change a shell script in `src/templates/scripts/`, update the embedded copy in `src/workflows/scaffold.md` too — the drift test will catch it if you forget
