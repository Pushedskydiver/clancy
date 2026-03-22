# QA-003b: E2E tests — Jira, Linear, Shortcut

## Summary

Add E2E tests and ticket factory/cleanup implementations for Jira, Linear, and Shortcut. Each follows the same flow pattern proven in QA-003a.

## Why

These three boards have the most distinct API patterns (REST + JQL, GraphQL, REST + workflow states). Testing them against real APIs catches board-specific edge cases that MSW fixtures can't simulate — Jira's JQL quirks, Linear's GraphQL error shapes, Shortcut's workflow state transitions.

## Acceptance Criteria

### 1. Ticket factory implementations

- [ ] **Jira:** `POST /rest/api/3/issue` with project key, summary, description, `clancy:build` label
- [ ] **Linear:** `issueCreate` GraphQL mutation with team, title, description, `clancy:build` label
- [ ] **Shortcut:** `POST /api/v3/stories` with name, description, workflow state matching "Unstarted"

### 2. Cleanup implementations

- [ ] **Jira:** Transition to Done + add `qa-cleanup` label (no API delete without admin)
- [ ] **Linear:** `issueDelete` GraphQL mutation (full delete)
- [ ] **Shortcut:** `DELETE /api/v3/stories/{id}` (full delete)

### 3. Orphan GC implementations

- [ ] **Jira:** JQL search for `summary ~ "[QA]"` created > 24h ago, transition to Done
- [ ] **Linear:** GraphQL query for issues with `[QA]` in title, filter by createdAt, delete
- [ ] **Shortcut:** Search stories with `[QA]` prefix, filter by created_at, delete

### 4. E2E tests

- [ ] Create `test/e2e/boards/jira.e2e.ts` — same flow as GitHub E2E
- [ ] Create `test/e2e/boards/linear.e2e.ts` — same flow as GitHub E2E
- [ ] Create `test/e2e/boards/shortcut.e2e.ts` — same flow as GitHub E2E
- [ ] Each test independently runnable via filename filter
- [ ] Each test cleans up after itself even on failure
- [ ] Tests skip gracefully if board credentials are not available (`hasCredentials` check)

## Out of scope

- Notion and Azure DevOps (QA-003c)
- AFK loop E2E (deferred — Layer 1 covers this adequately)

## Dependencies

- **QA-003a** — E2E infrastructure and GitHub test must be complete (proven pattern)
- **QA-003-prereq** — Jira, Linear, and Shortcut sandbox credentials must be ready

## Notes

- Linear personal API keys do NOT use "Bearer" prefix. The E2E test will validate this works correctly against the real API.
- Linear filters by state.type "unstarted" (enum), not state name. Real API will confirm enum values.
- Shortcut requires knowing the workflow state ID for "Unstarted" — the factory may need to fetch workflow states first.
- Jira uses the new `/rest/api/3/search/jql` POST endpoint. The E2E test will confirm this endpoint exists and works.
