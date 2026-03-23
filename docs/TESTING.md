# Testing

Clancy uses a 3-layer QA architecture: unit tests, integration tests, and E2E tests. All layers use Vitest.

Run `npm run test:all` and `npm run test:e2e` to see current counts.

## Quick reference

```bash
npm test                        # Layer 1: unit tests
npm run test:integration        # Layer 2: integration tests (MSW)
npm run test:all                # Layer 1 + 2
npm run test:e2e                # Layer 3: E2E tests (real APIs — needs credentials)
npm run test:e2e -- github      # E2E for a single board
npm run test:e2e:gc             # orphan ticket cleanup
npm run test:fixtures:validate  # validate MSW fixtures against Zod schemas (offline)
npm run test:fixtures:live      # validate real API auth endpoints against Zod schemas
npm run test:coverage           # unit tests with coverage report
npm run typecheck               # tsc --noEmit
npm run lint                    # eslint
```

---

## Layer 1: Unit tests

Module-level tests with `vi.mock()`. Co-located with source files.

### How to run

```bash
npm test                          # all unit tests
npx vitest run src/scripts/board  # subset by path
npm run test:coverage             # with coverage report
```

### File structure

Tests are co-located: `<name>/<name>.ts` + `<name>/<name>.test.ts`.

```
src/
├── scripts/
│   ├── once/
│   │   ├── once.test.ts                      — orchestrator lifecycle (37 tests)
│   │   ├── deliver/deliver.test.ts           — PR delivery + epic completion
│   │   ├── fetch-ticket/fetch-ticket.test.ts — label resolution + ticket fetch
│   │   ├── lock/lock.test.ts                 — lock file management
│   │   ├── cost/cost.test.ts                 — duration-based cost estimation
│   │   ├── resume/resume.test.ts             — crash recovery
│   │   └── quality/quality.test.ts           — quality tracking
│   ├── afk/afk.test.ts                       — AFK loop runner
│   ├── board/
│   │   ├── github/github.test.ts             — GitHub Issues API
│   │   ├── jira/jira.test.ts                 — Jira REST API
│   │   ├── linear/linear.test.ts             — Linear GraphQL API
│   │   ├── shortcut/shortcut.test.ts         — Shortcut REST API
│   │   ├── notion/notion.test.ts             — Notion REST API
│   │   └── azdo/azdo.test.ts                 — Azure DevOps WIQL API
│   └── shared/                               — branch, env, git-ops, http, progress, etc.
├── installer/                                — file-ops, hook-installer, manifest
└── utils/                                    — ansi, parse-json
```

### How they work

- Each test file mocks its module's external dependencies via `vi.mock()`
- Board module tests validate API response parsing, ticket extraction, and error handling using inline mock data
- Orchestrator tests mock all phases and verify the full lifecycle
- No network calls, no filesystem side effects (except installer tests which use temp dirs)

### Adding unit tests for a new board

1. Create the board module with a co-located `<name>.test.ts`
2. Mock API responses inline (no fixture files needed for unit tests)
3. Cover at minimum: happy path fetch, empty queue, auth failure, label operations
4. Add env schema validation for the board's required vars in `src/schemas/env.ts`

### Adding unit tests for a new utility

1. Create the utility with a co-located `<name>.test.ts`
2. Test pure functions directly, mock side effects
3. Follow existing patterns in `src/scripts/shared/`

---

## Layer 2: Integration tests

Real module collaboration with two mock boundaries: **network** (MSW) and **Claude** (simulator). Tests exercise multiple modules working together in a controlled environment.

### How to run

```bash
npm run test:integration                           # all integration tests
npx vitest run --config test/integration/vitest.config.integration.ts -t "GitHub"  # filter
```

### File structure

```
test/integration/
├── vitest.config.integration.ts  — separate config (30s timeout, sequential)
├── global-setup.ts               — shared node_modules template for temp repos
├── validate-fixtures.ts          — offline fixture validation script
├── helpers/
│   ├── claude-simulator.ts       — simulates Claude Code session (writes files, commits)
│   ├── temp-repo.ts              — creates temp git repos with Clancy scaffolds
│   ├── env-fixtures.ts           — board-specific env var fixtures
│   ├── msw-server.ts             — shared MSW server setup
│   └── scaffold-content.ts       — Clancy scaffold content for temp repos
├── mocks/
│   ├── handlers/                 — MSW request handlers for boards + git-host PRs
│   └── fixtures/                 — JSON response fixtures for boards + git-host PRs
└── flows/
    ├── board/
    │   ├── shared.ts             — parameterised describe.each for all 6 boards
    │   ├── github.test.ts        — GitHub-specific flow tests
    │   ├── jira.test.ts          — Jira-specific flow tests
    │   ├── linear.test.ts        — Linear-specific flow tests
    │   ├── shortcut.test.ts      — Shortcut-specific flow tests
    │   ├── notion.test.ts        — Notion-specific flow tests
    │   └── azdo.test.ts          — Azure DevOps-specific flow tests
    ├── afk-loop.test.ts          — AFK runner: N-ticket processing, empty queue, preflight
    ├── hooks.test.ts             — hook tests (credential guard, branch guard, context monitor, post-compact)
    ├── installer.test.ts         — installer sub-module tests (file-ops, manifest, role filtering)
    └── pipeline.test.ts          — pipeline label transitions (brief → plan → build)
```

### How they work

1. **MSW** intercepts all HTTP requests — board APIs return fixture data, no real network calls
2. **Claude simulator** writes a dummy file and commits it (simulates a successful Claude session)
3. **Temp repos** are real git repos in `/tmp` with Clancy scaffold (`.clancy/.env`, `package.json`)
4. **Global setup** pre-installs `node_modules` once, then symlinks them into each test repo (fast repo creation)
5. Tests call the real orchestrator (`run()`) or real hook functions and verify outcomes

### Fixture freshness

MSW fixtures in `test/integration/mocks/fixtures/` can drift from real API responses over time. Two scripts detect this:

- **`npm run test:fixtures:validate`** (offline) — reads each fixture and validates it against the corresponding Zod schema in `src/schemas/`. No credentials needed, safe for CI.
- **`npm run test:fixtures:live`** (online) — hits each board's auth/health endpoint and validates the response shape against Zod schemas. Catches API drift faster than full E2E.

**The feedback cycle:**
1. E2E test fails against a real API → investigate the response
2. Update the Zod schema in `src/schemas/` to match reality
3. Run `npm run test:fixtures:validate` — any fixture that no longer passes is stale
4. Update the MSW fixture to match the new schema
5. Layer 2 integration tests stay accurate

### Adding integration tests for a new board

1. Create an MSW handler file in `test/integration/mocks/handlers/`
2. Create a JSON fixture in `test/integration/mocks/fixtures/{board}/`
3. Add a flow test file in `test/integration/flows/board/`
4. Add the board to the parameterised `describe.each` in `shared.ts`
5. Run `npm run test:fixtures:validate` to verify the fixture passes schema validation

---

## Layer 3: E2E tests

Real APIs, real git operations, real ticket creation. Tests exercise the full pipeline against production board APIs with Claude simulated.

### How to run

```bash
npm run test:e2e                  # all boards (needs all credentials)
npm run test:e2e -- github        # single board
npm run test:e2e -- jira linear   # multiple boards
npm run test:e2e:gc               # clean up orphan [QA] tickets >24h old
```

### File structure

```
test/e2e/
├── vitest.config.e2e.ts          — 60s timeout, sequential, no retry
├── validate-live-schemas.ts      — live Zod schema validation script
├── captured-responses/           — gitignored dir for raw response capture
├── boards/
│   ├── github.e2e.ts             — GitHub Issues E2E
│   ├── jira.e2e.ts               — Jira E2E
│   ├── linear.e2e.ts             — Linear E2E
│   ├── shortcut.e2e.ts           — Shortcut E2E
│   ├── notion.e2e.ts             — Notion E2E
│   └── azure-devops.e2e.ts       — Azure DevOps E2E
└── helpers/
    ├── env.ts                    — credential loading (.env.e2e or process.env)
    ├── ticket-factory.ts         — real API ticket creation (all 6 boards)
    ├── cleanup.ts                — ticket/PR/branch cleanup per board
    ├── gc.ts                     — orphan cleanup ([QA] tickets >24h old)
    ├── git-auth.ts               — GIT_ASKPASS helper for git push auth
    ├── jira-auth.ts              — Base64 Basic auth for Jira
    ├── azdo-auth.ts              — Base64 Basic auth for Azure DevOps
    └── fetch-timeout.ts          — 15s timeout wrapper for fetch calls
```

### How they work

1. **Ticket factory** creates a real ticket on the board API (labelled `clancy:build`, assigned to authenticated user)
2. **Temp repo** is created with a real git remote pointing to the GitHub sandbox repo
3. **Claude simulator** writes a dummy file and commits (same as integration tests)
4. **Orchestrator** runs with real board API, real git push, simulated Claude
5. **Assertions** verify: feature branch created, progress.txt updated, PR exists on GitHub
6. **Cleanup** runs in `afterAll`: close PR → delete branch → close/delete ticket → remove temp repo
7. **Orphan GC** catches tickets from crashed/timed-out runs (titles contain `[QA]`, >24h old)

### Credential setup

Copy `.env.e2e.example` (repo root) to `.env.e2e` and fill in real values. Tests skip automatically if credentials are missing for a board.

| Board | Required secrets |
|---|---|
| GitHub | `GITHUB_TOKEN`, `GITHUB_REPO` |
| Jira | `JIRA_BASE_URL`, `JIRA_USER`, `JIRA_API_TOKEN` (+ optional `JIRA_PROJECT_KEY`, defaults to `CLANCYQA`) |
| Linear | `LINEAR_API_KEY`, `LINEAR_TEAM_ID` |
| Shortcut | `SHORTCUT_TOKEN` |
| Notion | `NOTION_TOKEN`, `NOTION_DATABASE_ID` |
| Azure DevOps | `AZURE_ORG`, `AZURE_PROJECT`, `AZURE_PAT` |

### CI schedule

E2E tests run via GitHub Actions (`.github/workflows/e2e-tests.yml`):

- **Weekly:** Monday 6am UTC (all boards)
- **Manual dispatch:** select a single board or all
- **GC job** runs first (cleans orphans across all boards)
- **Per-board matrix** with `fail-fast: false` and 30min timeout
- **Live schema validation** runs after E2E matrix completes

### No retry policy

E2E tests do not retry (Vitest default) because they create real external resources (tickets, PRs, branches). Retries would leak earlier-attempt resources. The GC script handles orphan cleanup instead.

---

## Contributor requirements

### All PRs must pass CI

```bash
npm test && npm run test:integration && npm run typecheck && npm run lint
```

### PRs adding new boards must include

- Co-located unit tests for the raw API module and Board wrapper
- Minimum scenarios: happy path fetch, empty queue, auth failure

### Integration test coverage (maintainer follow-up, not PR blocker)

- MSW handler file + fixture + flow test
- Fixture validated by `npm run test:fixtures:validate`

---

## See also

- [CONVENTIONS.md](CONVENTIONS.md) — code conventions, naming patterns, TypeScript rules
- [ARCHITECTURE.md](ARCHITECTURE.md) — system architecture and module map
- [TECHNICAL-REFERENCE.md](TECHNICAL-REFERENCE.md) — boards, hooks, delivery, build system
