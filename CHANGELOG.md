# Changelog

All notable changes to Clancy are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [0.1.0] — 2025-03-07

### Added

- Initial release
- `npx clancy` installer — global or local install
- `/clancy:init` — full wizard with Jira, GitHub Issues, and Linear support
- `/clancy:run` — loop runner with optional iteration count override
- `/clancy:once` — single ticket implementation
- `/clancy:status` — read-only board check showing next 3 tickets
- `/clancy:review` — 7-criterion ticket scoring (0–100%) with actionable recommendations
- `/clancy:logs` — formatted progress log with ASCII epic progress bars
- `/clancy:map-codebase` — 5-agent parallel codebase scan writing 10 structured docs
- `/clancy:update-docs` — incremental doc refresh for changed areas
- `/clancy:update` — self-update via npx
- `/clancy:help` — command reference with lineage credit
- Jira support: POST `/rest/api/3/search/jql` endpoint, ADF description parsing, sprint filter, classic and next-gen epic detection
- GitHub Issues support: PR filtering, milestone as epic context, auto-close on complete
- Linear support: `viewer.assignedIssues` query, `state.type: unstarted` filter, personal API key auth (no Bearer prefix)
- CLAUDE.md merge strategy — append Clancy section, never overwrite existing content
- Preflight checks in all scripts: binary check, `.env` validation, git repo check, board reachability ping
- Optional Figma MCP integration with plan detection and three-tier fallback
- Optional Playwright visual checks with Storybook detection
- Optional Slack/Teams webhook notifications
- Board registry (`registry/boards.json`) for community extensibility
- Unit tests against fixture files for all three boards
- Smoke test for live API validation
- MIT license
- Credits to Geoffrey Huntley for the Ralph technique

---

## Unreleased

Nothing yet.
