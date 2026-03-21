# QA-002a: Integration tests — Implementer lifecycle and AFK loop (all 6 boards)

## Summary

Write MSW-backed integration tests for the Implementer role flows: the `once` single-ticket lifecycle and the `afk` loop runner. Cover all 6 boards with core scenarios: happy path, empty queue, auth failure, blocked ticket, epic branch targeting, verification gate failure with self-healing, crash recovery, and resume detection.

## Why

The existing unit tests mock every dependency and test modules in isolation. These integration tests let real modules collaborate — env parsing, board detection, Zod validation, API fetch (via MSW), git operations (against a temp repo), prompt building, Claude simulation, verification gates, PR creation, status transitions, and progress logging all run for real. The only mock boundaries are the network (MSW) and Claude (simulator via `vi.mock`).

## How the orchestrator is invoked

Integration tests import `run(argv)` from `src/scripts/once/once.ts` and mock the Claude CLI module:

```typescript
import { run } from '~/scripts/once/once.js';

vi.mock('~/scripts/shared/claude-cli/claude-cli.js', () => ({
  invokeClaudeSession: (prompt: string) => {
    // Call Claude simulator to create files, stage, commit
    simulateClaudeSuccess(repoPath, ticketKey);
    return true;
  },
  invokeClaudePrint: () => ({ stdout: '', ok: true }),
}));
```

Everything else runs real: env parsing, board detection via Zod, MSW-intercepted board API calls, real git operations in the temp repo, prompt building, progress logging, status transitions.

For the AFK loop, `runAfkLoop()` spawns `clancy-once.js` as a child process via `spawnSync`. Since MSW intercepts in the current process only, AFK tests require the runner injection refactor specified in the strategy doc: `runAfkLoop(scriptDir, maxIterations?, runner?)`. Integration tests inject a runner that calls `run()` in-process, allowing MSW to intercept board API calls. Without this refactor, AFK integration tests would be unit tests in disguise (mocking `spawnSync`) or unable to intercept HTTP (subprocess).

## Acceptance Criteria

### 1. MSW handlers — full scenario coverage for all 6 boards

Expand the smoke handlers from QA-001 into full scenario sets:

- [ ] For each board handler, export three variants:
  - `{board}Handlers` — happy path (1 ticket with description, AC, `clancy:build` label)
  - `{board}EmptyHandlers` — empty results
  - `{board}AuthFailureHandlers` — 401/403 response
- [ ] Add per-board extras where relevant:
  - Jira: status transition via `POST /rest/api/3/issue/{key}/transitions`
  - GitHub: PR filtering (exclude items with `pull_request` key)
  - Linear: GraphQL error response format
  - Notion: 429 rate limit with `Retry-After` header (tests `retryFetch`), multi-page pagination variant (cursor-based `has_more` + `next_cursor` — tests `queryAllPages`)
  - Azure DevOps: two-step fetch (WIQL query -> work item GET)
- [ ] Git host PR creation handlers with request body capture:
  - `github-pr.ts` — capture PR title, body, base branch, head branch
  - `gitlab-mr.ts` — capture MR title, description, source/target branch
  - `bitbucket-pr.ts` — capture PR title, description, source/destination

### 2. Flow 1 — Implementer lifecycle tests

- [ ] Create `test/integration/flows/implementer.test.ts`
- [ ] Parameterise with `describe.each` across all 6 boards, using GitHub as the git host:

```typescript
const boards = ['jira', 'github', 'linear', 'shortcut', 'notion', 'azure-devops'] as const;
describe.each(boards)('Implementer lifecycle — %s', (board) => {
  // shared test logic, different MSW handlers + env fixtures per board
});
```

**Happy path — single ticket lifecycle:**
- Set up: temp repo, Clancy scaffold, `vi.stubEnv()` with board vars, MSW handlers (happy path)
- Mock `invokeClaudeSession` to call Claude simulator (success variant)
- Call `run([])`
- Assert: feature branch created with correct naming convention per board (`feature/{key}` for Jira/Linear, `feature/issue-{number}` for GitHub)
- Assert: MSW captured PR creation request with correct body (ticket reference, branch names)
- Assert: MSW captured status transition request to board with correct target state
- Assert: `progress.txt` has DONE entry with correct ticket key, UTC timestamp, and `pr:NNN` suffix
- Assert: correct conventional commit message format in the feature branch

**Empty queue:**
- MSW returns empty results
- Call `run([])`
- Assert: clean exit (function returns without error), no git operations, no PR creation request

**Auth failure:**
- MSW returns 401/403
- Call `run([])`
- Assert: clean exit with error output, no git operations

**Blocked ticket skipped:**
- MSW returns ticket with blocking dependency (board-specific: Jira `issuelinks` with `inward: "is blocked by"`, Linear `relations` with `type: "blocks"`, GitHub — N/A no native blocking, Shortcut `blocked`, Notion — N/A, AzDo — predecessor links)
- Call `run([])`
- Assert: ticket skipped, no branch created

**Epic branch targeting:**
- MSW returns ticket with parent/epic reference (`Epic: PROJ-100` in description)
- Pre-create epic branch in temp repo via `createEpicBranch()`
- Mock `invokeClaudeSession` to call simulator
- Call `run([])`
- Assert: PR targets epic branch, not main

**Verification gate failure + self-healing:**
- Use `createSequencedClaudeMock` from QA-001 infrastructure:
  ```typescript
  const mock = createSequencedClaudeMock([
    { type: 'failure', repoPath, ticketKey },  // first call: broken code
    { type: 'success', repoPath, ticketKey },  // retry: fixed code
  ]);
  ```
- Call `run([])`
- Assert: verification gate detected failure (lint/typecheck error in temp repo)
- Assert: retry occurred (simulator called twice)
- Assert: PR created after successful retry

**Verification gate — no retry when `CLANCY_FIX_RETRIES=0`:**
- `vi.stubEnv('CLANCY_FIX_RETRIES', '0')`
- Mock `invokeClaudeSession` with failure variant only
- Call `run([])`
- Assert: PR created with warning in body (no retry attempted)

**Crash recovery — stale lock file:**
- Create `.clancy/lock.json` with a non-existent PID (e.g. `999999999`)
- Call `run([])`
- Assert: stale lock cleaned up, normal execution proceeds

**Resume detection:**
- Create state that the resume module in `src/scripts/once/resume/resume.ts` actually checks for (read the module to determine exact conditions — likely lock file with valid PID + matching feature branch)
- Call `run([])`
- Assert: resume path triggered instead of picking a new ticket

### 3. Flow 2 — AFK loop tests

- [ ] Create `test/integration/flows/afk-loop.test.ts`
- [ ] Use GitHub Issues as the single board (loop is board-agnostic):

**Processes N tickets then exits:**
- MSW handler tracks call count, returns different tickets for first 3 calls, then empty
- Set `MAX_ITERATIONS=3` via `vi.stubEnv()`
- Inject a runner function that calls `run()` in-process (via the runner injection refactor), allowing MSW to intercept
- Assert: 3 tickets processed, 3 progress entries, clean exit

**Exits cleanly on empty queue:**
- MSW returns 1 ticket then empty on subsequent calls
- Set `MAX_ITERATIONS=10`
- Assert: 1 ticket processed, clean exit

**Time guard triggers:**
- Use `vi.useFakeTimers()` to advance `Date.now()` past `CLANCY_TIME_LIMIT`
- Assert: ticket processing stops with time warning

**Stop condition parsing (unit-level, tests `checkStopCondition`):**
- Input: `"No tickets found"` -> `{ stop: true, reason: 'No tickets found' }`
- Input: `"Ticket skipped"` -> `{ stop: true, reason: 'Ticket skipped' }`
- Input: `"✗ Preflight failed"` -> `{ stop: true, reason: ... }`
- Input: `"Processing PROJ-123"` -> `{ stop: false }`

### 4. Test organisation

- [ ] Each test creates its own temp repo and MSW server instance in `beforeAll` (per board describe block), reset MSW handlers in `beforeEach`
- [ ] Temp repos shared within a board's describe block (reset git state between tests, don't recreate)
- [ ] Environment vars restored between tests via `vi.unstubAllEnvs()` in `afterEach`
- [ ] All tests pass `npm run test:integration`
- [ ] Total runtime under 5 minutes (per strategy doc runtime budget). If exceeded, split `describe.each` into per-board test files for Vitest parallelisation.

## Out of scope

- Testing all 6 boards x all 3 git hosts (18 combinations) — start with x GitHub only, add GitLab/Bitbucket in a follow-up
- Board API interaction tests for prompt-driven commands (QA-002b)
- E2E tests against real APIs (QA-003)

## Dependencies

- **QA-001** — infrastructure must be complete (simulator, temp repo, MSW setup, all 6 board smoke handlers, env fixtures)

## Notes

- The AFK loop requires the runner injection refactor from the strategy doc prerequisites. Without it, AFK integration tests cannot intercept board API calls via MSW.
- The Notion handler should include a 429 rate limit variant — Notion's 3 req/s limit is a real-world edge case. Test that `retryFetch()` handles `Retry-After` correctly through MSW.
- Azure DevOps uses a two-step fetch (WIQL query -> work item GET). Both steps must be handled in the MSW handler.
- Fixture data should match real API response shapes as closely as possible. Reference existing unit test inline mocks AND the Zod schemas in `src/schemas/` for the correct structure.
