# QA-003a: E2E infrastructure + GitHub board test

## Summary

Build the E2E test infrastructure (Vitest config, env loading, ticket factory, cleanup helpers, orphan GC) and the first E2E test against the GitHub Issues board. This proves the pattern that all subsequent board tests follow.

## Why

Layer 1 proves orchestration works against mock APIs. Layer 2 proves it works against real APIs — catching response shape drift, auth flow changes, rate limits, and real-world edge cases. GitHub is the simplest board and doubles as the git host, making it the ideal first target.

## Acceptance Criteria

### 1. Vitest E2E config

- [ ] Create `test/e2e/vitest.config.e2e.ts`:
  - Include pattern: `test/e2e/**/*.e2e.ts`
  - Test timeout: 60 seconds (real API latency)
  - Retry: 2 (transient network failures)
  - Resolves `~/` path alias to `src/`
  - Coverage disabled

### 2. Environment loading

- [ ] Create `test/e2e/helpers/env.ts`:
  - Loads from `.env.e2e` (local) or `process.env` (CI)
  - Exports per-board credential objects
  - Exports `hasCredentials(board)` check for conditional test skipping

### 3. Ticket factory (GitHub only in this ticket)

- [ ] Create `test/e2e/helpers/ticket-factory.ts`
- [ ] Export `createTestTicket(board, options)` with interface for all 6 boards
- [ ] Implement GitHub: `POST /repos/{owner}/{repo}/issues` with title, body, `clancy:build` label
- [ ] Ticket title includes board name and unique run ID: `[QA] E2E test — {board} — {runId}`
- [ ] Returns `{ id, key, url }`
- [ ] Other board implementations are stubs that throw "not implemented" (filled in QA-003b/c)

### 4. Cleanup helpers (GitHub only in this ticket)

- [ ] Create `test/e2e/helpers/cleanup.ts`
- [ ] Export `cleanupTicket(board, ticketId)` — GitHub: close issue + add `qa-cleanup` label
- [ ] Export `cleanupBranch(repoPath, branchName)` — delete remote branch if exists
- [ ] Cleanup runs in `afterAll` / try-finally to ensure cleanup on failure
- [ ] Other board implementations are stubs (filled in QA-003b/c)

### 5. Orphan GC script

- [ ] Create `test/e2e/helpers/gc.ts`
- [ ] Export `cleanupOrphanTickets(board)` — queries for tickets with `[QA]` in title older than 24 hours
- [ ] Implement GitHub: search issues with `[QA]` prefix, close + label old ones
- [ ] Runnable as script: `npx tsx test/e2e/helpers/gc.ts`
- [ ] Other board implementations are stubs (filled in QA-003b/c)

### 6. Test isolation

- [ ] Unique run ID per test run (timestamp or UUID) in ticket titles
- [ ] Cleanup scoped to that run's prefix
- [ ] Tolerates parallel execution (two CI runs won't interfere)

### 7. GitHub E2E test

- [ ] Create `test/e2e/boards/github.e2e.ts`
- [ ] Flow:
  1. Create test ticket via ticket-factory (real GitHub API)
  2. Set up temp repo with Clancy scaffold (local)
  3. Mock `invokeClaudeSession` with Claude simulator
  4. Call `run([])` — real GitHub API, real git ops, simulated Claude
  5. Verify via API: ticket status changed (fetch issue, check state/labels)
  6. Verify via API: PR exists on git host (fetch PRs, find matching branch)
  7. Verify locally: `progress.txt` has DONE entry
  8. Cleanup: close ticket, delete remote branch, remove temp repo
- [ ] Test independently runnable: `npm run test:e2e -- github`
- [ ] Cleans up after itself even on failure

### 8. Package.json scripts

- [ ] Add `"test:e2e": "vitest run --config test/e2e/vitest.config.e2e.ts"`
- [ ] Add `"test:e2e:gc": "npx tsx test/e2e/helpers/gc.ts"`

## Out of scope

- Factory/cleanup implementations for boards other than GitHub (QA-003b, QA-003c)
- Fixture feedback loop (QA-003d)
- GitHub Actions workflow (QA-003e)

## Dependencies

- **QA-003-prereq** — GitHub sandbox (repo + PAT) must be ready

## Notes

- The ticket factory and cleanup interfaces are designed for all 6 boards upfront, but only GitHub is implemented here. This avoids rework when QA-003b/c add their boards.
- E2E tests use the same Claude mock approach as Layer 1: `vi.mock()` on `invokeClaudeSession`. The only difference is MSW is NOT running — board API calls hit real endpoints.
- Platform rate limits: GitHub allows 5000 req/hr authenticated. A single E2E test uses ~10 requests. Well within limits.
