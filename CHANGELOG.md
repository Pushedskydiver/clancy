# Changelog

All notable changes to Clancy are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [0.1.0] — 2026-03-07

### Added

- Initial release
- `npx chief-clancy` installer — global or local install
- `/clancy:init` — full wizard with Jira, GitHub Issues, and Linear support; explicit Figma key verification with retry/skip menu on failure
- `/clancy:run` — loop runner with optional iteration count override; cost warning for 10+ iterations
- `/clancy:once` — single ticket implementation
- `/clancy:status` — read-only board check showing next 3 tickets (assignee-filtered)
- `/clancy:review` — 7-criterion ticket scoring (0–100%) with actionable recommendations
- `/clancy:logs` — formatted progress log with ASCII epic progress bars
- `/clancy:map-codebase` — 5-agent parallel codebase scan writing 10 structured docs
- `/clancy:update-docs` — incremental doc refresh for changed areas
- `/clancy:update` — self-update via npx (updates slash commands only; re-run `/clancy:init` to update shell scripts)
- `/clancy:doctor` — diagnose your Clancy setup; tests all integrations and reports what's working, broken, and how to fix it
- `/clancy:settings` — interactive settings menu; view and change config including board, model, iterations, label filter, and optional enhancements
- `/clancy:uninstall` — remove Clancy commands from global or local install
- `/clancy:help` — command reference with lineage credit
- Jira support: POST `/rest/api/3/search/jql` endpoint, ADF description parsing, sprint filter, optional label filter (`CLANCY_LABEL`), classic and next-gen epic detection
- GitHub Issues support: PR filtering, milestone as epic context, auto-close on complete
- Linear support: `viewer.assignedIssues` query, `state.type: unstarted` filter, personal API key auth (no Bearer prefix)
- Epic branch auto-detection — tickets with a parent epic automatically branch from and merge into `epic/{epic-key}` (created from `CLANCY_BASE_BRANCH` if needed); tickets without a parent use `CLANCY_BASE_BRANCH` directly
- Progress logging to `.clancy/progress.txt` — each completed ticket is appended with timestamp, key, summary, and status
- Version check at workflow startup — compares installed version against npm registry; prompts to update if a newer version is available, continues silently otherwise
- CLAUDE.md merge strategy — append Clancy section, never overwrite existing content
- Preflight checks in all scripts: binary check, `.env` validation, git repo check, board reachability ping
- Optional Figma MCP integration with key verification and three-tier fallback (plan info not available via API — check figma.com/settings)
- Optional Playwright visual checks with Storybook detection
- Optional Slack/Teams webhook notifications
- Board registry (`registry/boards.json`) for community extensibility
- Unit tests against fixture files for all three boards
- Smoke test for live API validation
- `COMPARISON.md` — Clancy vs GSD vs PAUL feature comparison
- MIT license
- Credits to Geoffrey Huntley for the Ralph technique
