# QA Gap Analysis — Board & Hook Test Coverage

> Completed as part of QA-001. Audits existing unit test coverage to identify gaps that integration tests should fill.

## Board Unit Test Coverage

| Scenario | Jira | GitHub | Linear | Shortcut | Notion | AzDo |
|---|---|---|---|---|---|---|
| Happy path fetch | Y | Y | Y | Y | Y | Y |
| Empty queue | Y | Y | Y | Y | Y | Y |
| Auth failure | Y | Y | Y | Y | Y | Y |
| Status transition | Y | Y | Y | Y | Y | Y |
| Label add/remove | Y | Y | Y | Y | Y | Y |
| Comment post | **N** | **N** | **N** | **N** | **N** | **N** |
| Ticket creation | **N** | **N** | **N** | **N** | **N** | **N** |
| Rate limiting | N | N | N | N | Partial | N |
| Pagination | N | N | N | N | Y | Y |

### Key findings

**Universal gaps (0/6 boards):**
- **Comment posting** — no board tests verify posting comments/plans. This is the planner's primary write operation.
- **Ticket creation** — no board tests verify creating tickets. This is the strategist's primary write operation.

**Partial gaps:**
- **Rate limiting** — only Notion tests 429 handling (via `retryFetch` mock). Other boards use the same `retryFetch` utility so the logic is tested transitively, but board-specific rate limit behavior isn't verified.
- **Pagination** — Notion and AzDo test multi-page results. Jira, GitHub, Linear, Shortcut do not.

**No critical gaps (blocking rule not triggered).** All 6 boards have happy path + error handling coverage. The missing scenarios (comment, creation, rate limiting, pagination) are write-path and edge-case coverage — important for integration tests but not blockers.

### Board-specific strengths worth noting

- **Jira:** WIQL injection defense (`isSafeWiqlValue`), ADF text extraction, dual-mode children detection
- **GitHub:** Username caching + fallback, self-reference filtering in blockers, label auto-creation on 404
- **Linear:** GraphQL label caching (team + workspace fallback), state type enum coverage, label creation via mutation
- **Shortcut:** Workflow state caching, story_link blocker detection, label caching
- **Notion:** Rich property type extraction (7 types), custom property names via env vars, cursor pagination
- **AzDo:** WIQL injection defense, JSON Patch operations, batch chunking (200 items), hierarchy-reverse parent detection

---

## Hook Test Coverage

| Scenario | Cred Guard | Branch Guard | Context Mon | PostCompact | Update Check | Drift Det | Notification | Statusline |
|---|---|---|---|---|---|---|---|---|
| Basic happy path | Y (7) | Y (13) | Y (4) | Y (1) | Y (3) | Y (2) | Y (2) | Y (3) |
| All pattern categories | Y (11) | Y (10) | Y (4) | N/A | Y (5) | Y (2) | Y (3) | Y (4) |
| Allowed paths/exemptions | Y (5) | Y (4) | Y (3) | Y (3) | Y (2) | Y (2) | Y (1) | Y (2) |
| Edge cases | Y (3) | Y (2) | Y (1) | Y (4) | Y (2) | Y (1) | Y (2) | Y (6) |
| Debounce/threshold logic | N/A | Y (2) | Y (3) | N/A | N/A | Y (1) | N/A | N/A |

**128 total hook test cases across 8 hooks.**

### Key findings

**No critical gaps.** All hooks have comprehensive test coverage.

- **Credential guard (26 tests):** All 14 credential pattern categories tested. All 5 allowed paths tested. Edge cases (malformed JSON, empty input, short values) tested.
- **Branch guard (28 tests):** All 6 blocked operation categories tested. `--force-with-lease` correctly tested as allowed. Protected branch matching tested. `CLANCY_BRANCH_GUARD=false` disable tested.
- **Context monitor (16 tests):** Both context (35%/25%) and time (80%/100%) thresholds tested. Independent debounce counters tested. Severity escalation bypass tested.
- **PostCompact (8 tests):** Lock file reading, description truncation (2000 chars), missing/corrupt lock file, parent key edge cases.
- **Check-update (14 tests):** Stale detection (>7 days), approved brief exemption, feedback file exclusion, boundary case (exactly 7 days), cache cleanup.
- **Drift detector (10 tests):** Version comparison, session-based debounce (fires once per session), null handling, whitespace trimming.
- **Notification (8 tests):** Platform detection (darwin/linux/win32), message field extraction priority, default fallback.
- **Statusline (18 tests):** Color thresholds (green/yellow/orange/red), buffer-aware percentage math, update banner, bridge file writing.

---

## Implications for Integration Tests

### What integration tests should cover (gaps identified here)

1. **Board write operations through MSW** — comment posting and ticket creation for at least Jira, GitHub, Linear (QA-002b)
2. **Pagination through MSW** — multi-page responses for boards that don't unit-test it (QA-002a, Notion handler variant)
3. **Rate limiting through MSW** — 429 + Retry-After handling via `retryFetch` (QA-002a, Notion handler variant)

### What integration tests should NOT duplicate

1. **Hook scenarios** — existing 128 tests comprehensively cover all hooks. Integration tests should only add expanded real-world input scenarios, not re-test basic logic.
2. **Board read operations** — happy path fetch, empty queue, auth failure are thoroughly unit-tested. Integration tests add value by testing these as part of a connected flow, not as isolated operations.
