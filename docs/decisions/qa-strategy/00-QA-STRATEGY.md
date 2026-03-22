# Clancy QA Strategy — Status

> 2-layer testing plan: integration tests (MSW mocks) + E2E tests (real platforms). Ships incrementally as v0.8.x patches before v0.9.0.

## The plan

Clancy's 1200+ unit tests cover module-level correctness. The QA strategy adds two layers on top:

**Layer 1 — Integration tests (MSW + Claude simulator).** Real module collaboration with two mock boundaries: MSW intercepts `fetch()` for board APIs, and `vi.mock()` replaces Claude invocation with a simulator that creates files, stages, and commits. Everything else runs real: env parsing, board detection, Zod validation, git operations, PR creation logic, progress logging. Covers the `once` orchestrator, AFK loop, board write operations, pipeline labels, installer sub-modules, and hook scenarios.

**Layer 2 — E2E tests (real platforms).** Same approach but MSW is removed — board API calls hit real endpoints. Catches response shape drift, auth flow changes, rate limits, and real-world edge cases that fixtures can't simulate. Weekly CI with per-board matrix. Claude remains mocked (simulator).

## What shipped

| Ticket | Version | PR | Tests | What |
|---|---|---|---|---|
| QA-001 | v0.8.3 | #58 | — | Integration test infrastructure: Claude simulator, temp repo, MSW server, env fixtures, global setup |
| QA-002a-1 | v0.8.4 | #59 | 1 | Implementer happy path (GitHub Issues end-to-end) |
| QA-002a-2 | v0.8.5 | #60 | 3 | Implementer early exits (empty queue, auth failure, dry-run) |
| QA-002a-3 | v0.8.6 | #61 | 24 | All 6 boards parameterised (describe.each) |
| QA-002a-4 | v0.8.7 | #62 | 7 | Advanced implementer (blocked skip, epic branch, stale lock, AFK resume) |
| QA-002a-5 | v0.8.8 | #63 | 3 | AFK loop (N-ticket processing, empty queue stop, preflight failure) |
| QA-002b-1 | v0.8.9 | #64† | 41 | Board write operations (ensureLabel, addLabel, removeLabel, transitionTicket × 6 boards) |
| QA-002b-2 | v0.8.12 | #65 | 6 | Pipeline label transitions (brief→plan→build, plan-label guard, crash safety, CLANCY_LABEL fallback) |
| QA-002b-3 | v0.8.13 | #66 | 34 | Installer sub-modules (file-ops, manifest, hook-installer, role filtering) |
| QA-002b-4 | v0.8.14 | #67 | 69 | Credential guard + branch guard hooks |
| QA-002b-5 | v0.8.15 | #68 | 17 | Context monitor + post-compact hooks |

†PR #64 also included a production bug fix (GitHub rework detection content-based filtering).

**Totals:** 1223 unit tests + 238 integration tests = **1461 tests**. Layer 1 complete.

## What's next

Layer 2 (E2E) and CI/docs are broken into 8 tickets with explicit dependencies:

```
QA-003-prereq (Alex) ──→ QA-003a (infra + GitHub)
                              ├→ QA-003b (Jira/Linear/Shortcut)
                              ├→ QA-003c (Notion/Azure DevOps)
                              ├→ QA-003d (fixture feedback loop)
                              └→ QA-004a (CI pipeline)
                                        ↓
                         QA-003e (Actions workflow, needs QA-003a + QA-003d)
                                        ↓
                         QA-004b (docs + verify)
```

| Ticket | Doc | Summary |
|---|---|---|
| QA-003-prereq | [04-QA-003-PREREQ.md](04-QA-003-PREREQ.md) | Human setup: sandbox accounts, credentials, per-board checklist |
| QA-003a | [05-QA-003a-E2E-INFRA-GITHUB.md](05-QA-003a-E2E-INFRA-GITHUB.md) | E2E infrastructure + GitHub board test |
| QA-003b | [06-QA-003b-JIRA-LINEAR-SHORTCUT.md](06-QA-003b-JIRA-LINEAR-SHORTCUT.md) | Jira, Linear, Shortcut E2E tests |
| QA-003c | [07-QA-003c-NOTION-AZDO.md](07-QA-003c-NOTION-AZDO.md) | Notion, Azure DevOps E2E tests |
| QA-003d | [08-QA-003d-FIXTURE-FEEDBACK-LOOP.md](08-QA-003d-FIXTURE-FEEDBACK-LOOP.md) | Captured responses, fixture validation, live schema checks |
| QA-003e | [09-QA-003e-ACTIONS-WORKFLOW.md](09-QA-003e-ACTIONS-WORKFLOW.md) | GitHub Actions E2E workflow (weekly + manual) |
| QA-004a | [10-QA-004a-CI-PIPELINE.md](10-QA-004a-CI-PIPELINE.md) | CI pipeline for unit + integration tests |
| QA-004b | [11-QA-004b-DOCS-VERIFICATION.md](11-QA-004b-DOCS-VERIFICATION.md) | TESTING.md rewrite + final verification |

## Shipped ticket docs (reference)

| Doc | What |
|---|---|
| [01-QA-001-INFRASTRUCTURE.md](01-QA-001-INFRASTRUCTURE.md) | Integration test infrastructure decisions |
| [02-QA-002a-IMPLEMENTER-FLOWS.md](02-QA-002a-IMPLEMENTER-FLOWS.md) | Implementer lifecycle + AFK loop test design |
| [03-QA-002b-BOARD-API-PIPELINE-HOOKS.md](03-QA-002b-BOARD-API-PIPELINE-HOOKS.md) | Board API, pipeline labels, installer, hook test design |
| [AUDIT.md](AUDIT.md) | Gap analysis from QA-001 (all gaps addressed) |
