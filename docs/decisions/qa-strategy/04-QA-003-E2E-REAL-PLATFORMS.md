# QA-003: E2E smoke tests against real platforms + CI pipeline

## Summary

Build E2E test scripts that create real tickets on all 6 board platforms, run the once orchestrator against them (with Claude mocked via the simulator), verify outcomes via API, and clean up. Wire into a weekly GitHub Actions CI job.

## Why

Layer 1 integration tests prove the orchestration works against mock APIs. Layer 2 proves it works against real APIs — catching response shape drift, auth flow changes, rate limits, and real-world edge cases that MSW fixtures can't simulate. Running weekly in CI means API drift is caught within days, not when a user reports a bug.

## How Claude is stubbed in E2E

E2E tests use the same approach as Layer 1: import `run()` from once.ts, mock `invokeClaudeSession` via `vi.mock()` to call the Claude simulator. The difference is that MSW is NOT running — board API calls hit real endpoints.

This means E2E tests exercise:
- Real board API authentication
- Real API response shapes (Zod validation against live data)
- Real rate limiting behavior
- Real ticket creation, status transitions, and label mutations
- Real git operations (branch, commit, push)
- Real PR creation on the git host

The only mock is the Claude boundary — no actual code implementation happens.

## Acceptance Criteria

### 1. Human prerequisite (done by Alex before this ticket starts)

> **This section is for you (Alex) to complete manually.**

**Board platforms:**
- [ ] Jira: project `CLANCYQA`, test user with API token
- [ ] GitHub Issues: repo `Pushedskydiver/clancy-qa-sandbox` with fine-grained PAT (Issues + Contents + Pull Requests scopes)
- [ ] Linear: team "Clancy QA" with API key
- [ ] Shortcut: workspace with API token
- [ ] Notion: database with properties matching Clancy's expected schema + integration token
- [ ] Azure DevOps: org + project with PAT (read/write work items + `destroy` if possible)

**Git host sandbox repos:**
- [ ] GitHub: `Pushedskydiver/clancy-qa-sandbox` (already exists from GitHub Issues setup)
- [ ] GitLab: sandbox repo for MR creation tests (if testing GitLab git host)
- [ ] Bitbucket: sandbox repo for PR creation tests (if testing Bitbucket git host)
- [ ] Note: start with GitHub only. Add GitLab/Bitbucket sandbox repos when those git hosts are added to E2E coverage.

**Credentials:**
- [ ] Add all credentials as GitHub Actions secrets using Clancy's actual env var names (e.g. `JIRA_BASE_URL`, `JIRA_USER`, `JIRA_API_TOKEN`, `GITHUB_TOKEN`, etc.)
- [ ] Create a `.env.e2e.example` listing all required env vars (committed, no values)
- [ ] Populate a local `.env.e2e` with real credentials (gitignored)

### 2. Ticket factory

- [ ] Create `test/e2e/helpers/ticket-factory.ts`
- [ ] Export `createTestTicket(board, options)` that creates a ticket via the real board API:
  - Jira: `POST /rest/api/3/issue` with project key, summary, description, `clancy:build` label
  - GitHub: `POST /repos/{owner}/{repo}/issues` with title, body, `clancy:build` label
  - Linear: `issueCreate` GraphQL mutation with team, title, description, `clancy:build` label
  - Shortcut: `POST /api/v3/stories` with name, description, workflow state
  - Notion: `POST /v1/pages` with database ID and properties
  - Azure DevOps: `POST /_apis/wit/workitems/$Task` with title, description, tags
- [ ] Returns: `{ id, key, url }`
- [ ] Ticket title includes board name and unique run ID for identification: `[QA] E2E test — {board} — {runId}`
- [ ] Ticket has realistic content: summary, 2-3 sentence description, 2-3 acceptance criteria

### 3. Cleanup helpers

- [ ] Create `test/e2e/helpers/cleanup.ts`
- [ ] Export `cleanupTicket(board, ticketId)` with per-board strategy:
  - Linear: `issueDelete` mutation
  - Shortcut: `DELETE /api/v3/stories/{id}`
  - Azure DevOps: `DELETE /_apis/wit/workitems/{id}` (if `destroy` permission, else close + tag)
  - Jira: transition to Done + add `qa-cleanup` label
  - GitHub: close issue + add `qa-cleanup` label
  - Notion: archive page
- [ ] Export `cleanupBranch(repoPath, branchName)` — deletes remote branch if it exists
- [ ] Cleanup runs in `afterAll` / try-finally to ensure cleanup on failure
- [ ] Create `test/e2e/helpers/gc.ts` — orphan ticket garbage collector:
  - Queries each board for tickets with `[QA]` in the title older than 24 hours
  - Closes/deletes them using the same per-board cleanup strategy
  - Handles cases where `afterAll` never runs (CI killed, OOM, timeout, manual cancellation)
  - Export as `cleanupOrphanTickets(board)` for use in CI
- [ ] Add `"test:e2e:gc": "npx tsx test/e2e/helpers/gc.ts"` to package.json

### 4. E2E test per board

- [ ] Create one test file per board under `test/e2e/boards/`:
  - `jira.e2e.ts`, `github.e2e.ts`, `linear.e2e.ts`, `shortcut.e2e.ts`, `notion.e2e.ts`, `azure-devops.e2e.ts`
- [ ] Each file follows the same flow:

```
1. Create test ticket via ticket-factory (real API)
2. Set up temp repo with Clancy scaffold (local)
3. Mock invokeClaudeSession with Claude simulator
4. Call run([]) — real board APIs, real git ops, simulated Claude
5. Verify via API: ticket status changed (fetch ticket, check status field)
6. Verify via API: PR exists on git host (fetch PRs, find matching branch)
7. Verify locally: progress.txt has DONE entry
8. Cleanup: close/delete ticket, delete remote branch, remove temp repo
```

- [ ] Each test independently runnable via filename filter: `npm run test:e2e -- github`
- [ ] Each test cleans up after itself even on failure
- [ ] Tests load credentials from `.env.e2e` (local) or environment variables (CI)
- [ ] Tests use `{ retry: 2 }` per-test config for transient network failures

### 5. GitHub Actions workflow

- [ ] Create `.github/workflows/e2e-tests.yml`:

```yaml
name: E2E Smoke Tests
on:
  schedule:
    - cron: '0 6 * * 1'  # Weekly Monday 6am UTC
  workflow_dispatch:
    inputs:
      board:
        description: 'Run for specific board (or all)'
        required: false
        default: 'all'
        type: choice
        options: [all, jira, github, linear, shortcut, notion, azure-devops]

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      matrix:
        board: [jira, github, linear, shortcut, notion, azure-devops]
      fail-fast: false
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: rm -rf node_modules package-lock.json && npm install
      - run: npm run test:e2e -- ${{ matrix.board }}
        env:
          JIRA_BASE_URL: ${{ secrets.JIRA_BASE_URL }}
          JIRA_USER: ${{ secrets.JIRA_USER }}
          JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.QA_GITHUB_TOKEN }}
          GITHUB_REPO: ${{ secrets.QA_GITHUB_REPO }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
          LINEAR_TEAM_ID: ${{ secrets.LINEAR_TEAM_ID }}
          SHORTCUT_TOKEN: ${{ secrets.SHORTCUT_TOKEN }}
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          NOTION_DATABASE_ID: ${{ secrets.NOTION_DATABASE_ID }}
          AZURE_ORG: ${{ secrets.AZURE_ORG }}
          AZURE_PROJECT: ${{ secrets.AZURE_PROJECT }}
          AZURE_PAT: ${{ secrets.AZURE_PAT }}
```

Note: `QA_GITHUB_TOKEN` secret name avoids collision with GitHub's built-in `GITHUB_TOKEN`, mapped to `GITHUB_TOKEN` env var for Clancy.

- [ ] Add an orphan GC step that runs before the test matrix:
  ```yaml
  gc:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: rm -rf node_modules package-lock.json && npm install
      - run: npm run test:e2e:gc
        env: # ... same credential env vars
  e2e:
    needs: gc  # GC runs first, cleans up orphans from any prior failed runs
  ```

### 6. Fixture feedback loop

- [ ] Each E2E test optionally captures the raw API response when a board API call succeeds
- [ ] Captured responses written to `test/e2e/captured-responses/{board}/{endpoint}.json` (gitignored)
- [ ] Add a script `npm run test:fixtures:validate` that:
  - Reads each MSW fixture from `test/integration/mocks/fixtures/`
  - Runs it through the corresponding Zod schema
  - Reports any validation failures (fixture has drifted from expected shape)
- [ ] Add `npm run test:fixtures:live` script that hits each board's auth/health endpoint with real credentials and validates the response against the Zod schema. This is cheaper than full E2E and can run nightly to catch schema drift faster than the weekly E2E cycle.
- [ ] When an E2E test fails due to API response shape change:
  1. Investigate the captured response to understand the change
  2. Update the Zod schema if the change is intentional
  3. Update the MSW fixture to match
  4. This is the feedback loop between Layer 2 and Layer 1

### 7. Package.json scripts

- [ ] Add:
  ```json
  "test:e2e": "vitest run --config test/e2e/vitest.config.e2e.ts",
  "test:fixtures:validate": "npx tsx test/integration/validate-fixtures.ts"
  ```
- [ ] `npm run test:e2e -- github` runs only the GitHub E2E test (Vitest filename filter)
- [ ] `npm run test:e2e` runs all boards

## Out of scope

- Full Claude invocation during E2E (Claude is always mocked via simulator)
- Testing prompt-driven commands against real APIs (planner, strategist, doctor — these are prompt-driven)
- GitLab/Bitbucket git host E2E (start with GitHub only, expand later)

## Dependencies

- **QA-001, QA-002a, QA-002b** — Layer 1 complete and passing
- **Human setup** — Alex must complete AC1 before this ticket starts

## Notes

- E2E tests are inherently slower and flakier. Use 60s timeout per test and Vitest's `retry: 2` for transient failures.
- The `workflow_dispatch` input lets you re-run a single board manually after fixing a failure.
- If a board's API introduces breaking changes, the E2E test will fail first — use the captured response to update both the Zod schema and the Layer 1 MSW fixture.
- Avoid creating overlapping test tickets if two CI runs overlap (cron + manual dispatch). The unique `runId` in ticket titles prevents confusion, and cleanup in `afterAll` prevents accumulation.
- Platform rate limits to be aware of: Notion (3 req/s), GitHub (5000 req/hr authenticated), Linear (free tier limits). Weekly runs with 1-2 tickets per board per run should be well within limits.
- **Credential expiry reference:**
  - Jira API tokens: no expiry (unless admin revokes)
  - GitHub fine-grained PAT: configurable expiry (set to 1 year, note renewal date)
  - Linear API key: no expiry
  - Shortcut API token: no expiry
  - Notion integration token: no expiry (unless integration is removed from workspace)
  - Azure DevOps PAT: configurable expiry (set to 1 year, note renewal date)
  - When the weekly E2E run fails with 401 for a specific board, the expired credential is the first thing to check. The failure message will identify which board.
