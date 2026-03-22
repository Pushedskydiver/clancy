# QA-001: Gap analysis + integration test infrastructure

> **Status: Shipped** — v0.8.3, PR #58. Infrastructure used by all subsequent QA tickets.

## Summary

Audit existing test coverage for specific scenario gaps (not file existence — we know the files exist), then build the shared integration test infrastructure: Claude output simulator, temp git repo with shared `node_modules`, MSW server with smoke handlers for all 6 boards and 3 git hosts, environment variable fixtures, and the Vitest integration config.

## Why

Every integration test in subsequent sessions depends on the same foundation. Building these as shared, tested helpers avoids duplicating boilerplate across 30+ test files and ensures consistency. The gap analysis identifies which scenarios need integration test coverage and which are already adequately covered at unit level.

## Acceptance Criteria

### 1. Gap analysis (prerequisite step, not a separate session)

- [ ] For each of the 6 boards, document which scenarios are covered in existing unit tests:

| Scenario | Jira | GitHub | Linear | Shortcut | Notion | AzDo |
|---|---|---|---|---|---|---|
| Happy path fetch | | | | | | |
| Empty queue | | | | | | |
| Auth failure | | | | | | |
| Status transition | | | | | | |
| Label add/remove | | | | | | |
| Comment post | | | | | | |
| Ticket creation | | | | | | |
| Rate limiting | | | | | | |
| Pagination | | | | | | |

- [ ] For each of the 8 hooks, document which scenarios are covered:

| Scenario | Cred Guard | Branch Guard | Context Mon | PostCompact | Update Check | Drift Det | Notification | Statusline |
|---|---|---|---|---|---|---|---|---|
| Basic happy path | | | | | | | | |
| All pattern categories | | | | | | | | |
| Allowed paths/exemptions | | | | | | | | |
| Edge cases | | | | | | | | |
| Debounce/threshold logic | | | | | | | | |

- [ ] Document gaps as specific scenarios to cover in integration tests
- [ ] Write findings to `docs/decisions/qa-strategy/AUDIT.md`
- [ ] **Blocking rule:** If any board has a critical gap (no happy path or no error handling test), create a follow-up ticket to fix it before writing integration tests for that board

### 2. Claude output simulator

- [ ] Create `test/integration/helpers/claude-simulator.ts`
- [ ] Export `simulateClaudeSuccess(repoPath, ticketKey, options?)` that:
  - Creates 1-3 TypeScript files under `src/` in the repo (e.g. `src/{ticket-key-slug}.ts` with a valid exported function)
  - Files must pass TypeScript strict compilation and ESLint
  - Stages all changes with `git add .`
  - Commits with a conventional commit message: `feat({ticketKey}): implement ticket`
  - Returns the commit SHA
- [ ] Export `simulateClaudeFailure(repoPath, ticketKey)` that:
  - Creates TypeScript files with a deliberate lint/typecheck error (unused variable, type error)
  - Stages and commits (broken code that the verification gate catches)
  - Returns the commit SHA
- [ ] Both functions accept an optional `files` override to inject custom file content
- [ ] Export `createSequencedClaudeMock(scenarios)` helper for tests that need stateful sequencing:
  ```typescript
  // Example: first call fails (verification gate catches), second call succeeds (self-healing)
  const mock = createSequencedClaudeMock([
    { type: 'failure', repoPath, ticketKey },
    { type: 'success', repoPath, ticketKey },
  ]);
  // Returns a vi.fn() that calls simulateClaudeFailure on first invocation,
  // simulateClaudeSuccess on second, suitable for use in vi.mock factory
  ```
- [ ] Write unit tests: `test/integration/helpers/claude-simulator.test.ts`
  - Test: success variant creates files, commit exists, commit message matches format, files pass `tsc --noEmit`
  - Test: failure variant creates files, commit exists, files fail `tsc --noEmit` or lint

### 3. Temp git repo with TypeScript project scaffold

- [ ] Create `test/integration/helpers/temp-repo.ts`
- [ ] Export `createTempRepo(options?)` that:
  - Creates a temp directory with `mkdtemp`
  - Initialises git with repo-local `user.name`/`user.email` config
  - Creates an initial commit on `main`
  - If `options.baseBranch` is provided (string), creates that branch instead of `main`
  - Scaffolds a minimal but real TypeScript project:
    - `package.json` with `name`, `scripts` (`lint`, `test`, `typecheck`), `devDependencies`
    - `tsconfig.json` with strict mode
    - `src/index.ts` with a trivial export
    - `.eslintrc.json` with minimal config (needed for verification gate lint checks)
    - Existing test file that always passes (so `npm test` succeeds in the scaffold)
  - **Symlinks `node_modules`** from the shared scaffold template (see global-setup.ts)
  - Commits the scaffold as the initial commit
  - Returns `{ repoPath, cleanup }` where `cleanup()` removes the temp directory
- [ ] Export `createEpicBranch(repoPath, epicKey)` — creates and checks out an epic branch from current base
- [ ] Export `createClancyScaffold(repoPath, board, envOverrides?)` that:
  - Creates `.clancy/` directory
  - Creates `.clancy/.env` with board-appropriate vars derived from `envOverrides` or defaults matching the Zod schema in `src/schemas/env.ts`
  - Creates `.clancy/.env.example`
  - Creates `.clancy/docs/` with the doc files the installer creates (derive list from installer, don't hardcode)
  - Creates empty `.clancy/progress.txt`
  - Does NOT commit these (tests may want to commit selectively)
- [ ] Write unit tests: `test/integration/helpers/temp-repo.test.ts`
  - Test: repo is created, main branch exists, initial commit exists
  - Test: custom base branch is created when requested
  - Test: TypeScript scaffold is valid (`tsc --noEmit` passes in the temp repo)
  - Test: Clancy scaffold creates expected file structure
  - Test: cleanup removes the directory
  - Test: epic branch is created from correct base

### 4. Shared scaffold template + global setup

- [ ] Create `test/integration/global-setup.ts`:
  - Creates a shared scaffold template directory (once per test suite run)
  - Runs `npm install` in the template directory (one-time cost)
  - Exports the template path for `createTempRepo` to symlink `node_modules` from
  - Cleans up the template in `globalTeardown`
- [ ] This ensures per-test repo creation is fast (file copy + symlink, no npm install)
- [ ] Template directory is in `os.tmpdir()`, not in the project tree

### 5. Environment variable fixtures

- [ ] Create `test/integration/helpers/env-fixtures.ts`
- [ ] Export per-board env var objects derived from the Zod schemas in `src/schemas/env.ts`:
  ```typescript
  export const jiraEnv = {
    JIRA_BASE_URL: 'https://test.atlassian.net',
    JIRA_USER: 'test@example.com',
    JIRA_API_TOKEN: 'test-token-jira',
    CLANCY_BASE_BRANCH: 'main',
    // ... all required vars per schema
  };
  ```
- [ ] Each fixture must pass the board's Zod schema validation (add a test for this)
- [ ] Export a helper `stubBoardEnv(board: BoardProvider)` that calls `vi.stubEnv()` with the correct vars
- [ ] Include git host vars (`GITHUB_TOKEN`, `GITLAB_TOKEN`, etc.) as separate fixtures

### 6. MSW server setup

- [ ] Create `test/integration/helpers/msw-server.ts`
- [ ] Export:
  - `createIntegrationServer(handlers?)` — returns a configured MSW `SetupServer` instance
  - `startServer(server)` — calls `server.listen({ onUnhandledRequest: 'error' })`
  - `resetServer(server)` — calls `server.resetHandlers()`
  - `stopServer(server)` — calls `server.close()`
- [ ] Server created fresh per test file to avoid handler leakage
- [ ] Write smoke test: `test/integration/helpers/msw-server.test.ts`
  - Test: server starts, fetch to handled URL returns mock response, fetch to unhandled URL throws
  - Test: GraphQL interception works (POST with query body, routed by content)

### 7. MSW handlers — smoke handler for ALL 6 boards + 3 git hosts

Create a smoke handler (single happy-path fetch) for every board and git host to prove MSW can intercept each request pattern. Full scenario coverage (empty, auth failure, etc.) comes in QA-002a.

- [ ] `test/integration/mocks/handlers/jira.ts` — REST POST `/rest/api/3/search/jql`, GET `/rest/api/2/myself`
- [ ] `test/integration/mocks/handlers/github-issues.ts` — REST GET `/repos/:owner/:repo/issues`, GET `/user`
- [ ] `test/integration/mocks/handlers/linear.ts` — GraphQL POST to `https://api.linear.app/graphql`, dispatches on query content. Linear uses a single GraphQL endpoint for all operations, so the handler must parse the request body and route based on query string matching:
  - `viewer { id` -> auth check response
  - `viewer { assignedIssues` -> ticket list response
  - `issueUpdate` -> mutation response (for transitions, labels)
  - `commentCreate` -> comment response (for planner)
  - `issueCreate` -> ticket creation response (for strategist)
  - Unmatched queries -> 400 error (catches missing handler coverage)
- [ ] `test/integration/mocks/handlers/shortcut.ts` — REST GET `/api/v3/search/stories`
- [ ] `test/integration/mocks/handlers/notion.ts` — REST POST `/v1/databases/:id/query`
- [ ] `test/integration/mocks/handlers/azure-devops.ts` — REST POST WIQL query + GET work item (two-step)
- [ ] `test/integration/mocks/handlers/github-pr.ts` — POST `/repos/:o/:r/pulls`
- [ ] `test/integration/mocks/handlers/gitlab-mr.ts` — POST `/api/v4/projects/:id/merge_requests`
- [ ] `test/integration/mocks/handlers/bitbucket-pr.ts` — POST `/2.0/repositories/:workspace/:repo/pullrequests`
- [ ] Each handler exports a `{name}Handlers` array for happy-path only (variants added in QA-002a)
- [ ] Create corresponding fixture files under `test/integration/mocks/fixtures/{board}/`
- [ ] **Fixture validation test:** Each fixture is run through its board's Zod schema to catch shape drift
- [ ] Fixtures reference existing unit test inline mocks for correct structure

### 8. Vitest integration config

- [ ] Create `test/integration/vitest.config.integration.ts`:
  - Include pattern: `test/integration/**/*.test.ts`
  - Test timeout: 30 seconds
  - Resolves `~/` path alias to `src/`
  - References `global-setup.ts` for shared scaffold setup/teardown
  - Coverage disabled (integration tests measure flow correctness, not line coverage)
- [ ] Add to `package.json`:
  ```json
  "test:integration": "vitest run --config test/integration/vitest.config.integration.ts"
  ```
- [ ] Verify: `npm test` does NOT run integration tests
- [ ] Verify: `npm run test:integration` runs and passes all helper tests + MSW smoke tests

### 9. Import resolution verification

- [ ] In the MSW smoke test, import at least one production module from `src/` using the `~/` path alias
- [ ] Verify the import resolves correctly within the integration test context
- [ ] If ESM resolution requires config changes, make them in the integration vitest config only

## Out of scope

- Writing flow integration tests (QA-002a, QA-002b)
- Full scenario MSW handlers (QA-002a)
- E2E tests or real platform setup (QA-003)
- Changes to production source code

## Dependencies

- MSW v2 must be added as dev dependency: `npm install -D msw`

## Notes

- MSW v2 Node mode (`msw/node`) intercepts `fetch()` globally — no need for configurable API base URLs. All board modules use `fetch()` or `retryFetch()` (which wraps `fetch()`), so MSW intercepts everything.
- The Claude simulator is the single most important deliverable — every subsequent integration test depends on it producing valid, realistic post-implementation state.
- Handler files export arrays so tests can compose: `server.use(...githubIssuesHandlers)` or override per test.
- The gap analysis output goes to `docs/decisions/qa-strategy/AUDIT.md`, not in `test/` — it's a decision artifact, not a test file.
