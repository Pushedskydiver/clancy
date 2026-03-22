# QA-003c: E2E tests — Notion, Azure DevOps

## Summary

Add E2E tests and ticket factory/cleanup implementations for Notion and Azure DevOps. Completes board coverage for Layer 2.

## Why

Notion and Azure DevOps have the most unusual API patterns. Notion has strict rate limiting (3 req/s), custom property name mapping, and cursor-based pagination. Azure DevOps uses WIQL queries + JSON Patch updates — a two-step pattern unique to this board. Real API testing catches edge cases that MSW fixtures can't simulate.

## Acceptance Criteria

### 1. Ticket factory implementations

- [ ] **Notion:** `POST /v1/pages` with database ID and properties matching Clancy's expected schema (status, title, description via configurable property names)
- [ ] **Azure DevOps:** `POST /_apis/wit/workitems/$Task` with JSON Patch for title, description, tags (`clancy:build`)

### 2. Cleanup implementations

- [ ] **Notion:** Archive page via `PATCH /v1/pages/{id}` with `archived: true`
- [ ] **Azure DevOps:** `DELETE /_apis/wit/workitems/{id}` if `destroy` permission available, else close + tag `qa-cleanup`

### 3. Orphan GC implementations

- [ ] **Notion:** Query database for pages with `[QA]` in title, filter by created_time > 24h, archive
- [ ] **Azure DevOps:** WIQL query for work items with `[QA]` in title created > 24h ago, delete or close

### 4. E2E tests

- [ ] Create `test/e2e/boards/notion.e2e.ts` — same flow as GitHub E2E
- [ ] Create `test/e2e/boards/azure-devops.e2e.ts` — same flow as GitHub E2E
- [ ] Each test independently runnable via filename filter
- [ ] Each test cleans up after itself even on failure
- [ ] Tests skip gracefully if board credentials are not available

## Out of scope

- AFK loop E2E (deferred)

## Dependencies

- **QA-003a** — E2E infrastructure and GitHub test must be complete
- **QA-003-prereq** — Notion and Azure DevOps sandbox credentials must be ready

## Notes

- Notion's 3 req/s rate limit means the E2E test may need short delays between API calls. The existing `retryFetch` utility handles `Retry-After` headers, but the factory/cleanup code will also need to respect this.
- Notion uses configurable property names via `CLANCY_NOTION_STATUS`, `CLANCY_NOTION_TITLE`, etc. The E2E test must set these to match the sandbox database schema.
- Azure DevOps `destroy` permission may not be available — the cleanup implementation must handle both cases (delete vs close + tag).
- Azure DevOps uses `isSafeWiqlValue` for defence-in-depth. The E2E test will exercise this against real WIQL queries.
