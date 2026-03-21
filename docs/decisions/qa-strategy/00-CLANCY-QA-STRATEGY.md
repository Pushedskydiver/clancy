# Clancy QA Strategy — Agent-Driven Lifecycle Testing

> Goal: Integration and E2E tests that exercise Clancy's orchestrator, board modules, and safety hooks as connected systems — not just isolated units. Both layers ship before v1.0.0.

---

## What Clancy Is (v0.8.1)

Clancy is a TypeScript/ESM CLI tool (`chief-clancy` on npm) — an autonomous board-driven development agent launcher for Claude Code.

- **6 board platforms:** Jira, GitHub Issues, Linear, Shortcut, Notion, Azure DevOps
- **3 git hosts:** GitHub, GitLab, Bitbucket (PR/MR creation)
- **5 roles:** Implementer, Reviewer, Setup, Planner (optional), Strategist (optional)
- **13-phase ticket execution pipeline** (`once.ts` orchestrator)
- **20+ commands** across all roles
- **Pipeline labels:** `clancy:brief` -> `clancy:plan` -> `clancy:build`
- **Verification gates:** lint/test/typecheck after implementation, self-healing retry
- **Safety hooks:** 8 hooks + 1 agent hook (credential guard, branch guard, cost tracker, time guard, context monitor, PostCompact, update check, drift detector, notification, verification gate)
- **Crash recovery:** lock file with PID detection, resume detection

---

## What Testing Exists (1217+ passing tests, 74 test files)

### Runner and approach
- **Vitest** with co-located test files (`<n>/<n>.test.ts`)
- `npm test` / `npx vitest run --coverage` / `npm run typecheck` / `npm run lint`
- 80% coverage thresholds (statements, branches, functions, lines)

### Current test coverage by area

**Board modules — 15 test files covering all 6 boards:**

| Board | Raw module tests | Board wrapper tests |
|---|---|---|
| Jira | `jira/jira.test.ts` | `jira/jira-board.test.ts` |
| GitHub Issues | `github/github.test.ts` | `github/github-board.test.ts` |
| Linear | `linear/linear.test.ts` | `linear/linear-board.test.ts` |
| Shortcut | `shortcut/shortcut.test.ts` | `shortcut/shortcut-board.test.ts` |
| Notion | `notion/notion.test.ts` | `notion/notion-board.test.ts` |
| Azure DevOps | `azdo/azdo.test.ts` | `azdo/azdo-board.test.ts` |

Plus `factory/factory.test.ts` for the `createBoard()` factory.

**Orchestrator — 16 test files:**
- `once/once.test.ts` (lifecycle), plus individual phase tests: lock-check, preflight, ticket-fetch, dry-run, feasibility, branch-setup, transition, invoke, deliver, epic-completion, rework-detection, pr-retry, cost, cleanup
- Sub-module tests: fetch-ticket, git-token, pr-creation, deliver, rework, lock, cost, resume, quality

**Shared utilities — 18 test files:**
- branch, claude-cli, env-parser, env-schema, feasibility, format, git-ops, http, notify, preflight, progress, prompt
- Pull request: bitbucket, github, gitlab, post-pr, pr-body, rework-comment
- Remote detection

**Hooks — 8 test files (all hooks tested):**
- credential-guard, branch-guard, context-monitor, post-compact, check-update, drift-detector, notification, statusline
- Tests use stdin/stdout JSON contract (pipe mock input, assert on output)

**Installer — 5 test files:**
- file-ops, hook-installer, manifest, prompts, ui

**Utilities — 2 test files:**
- ansi, parse-json

### How existing tests work
- **Board tests:** `vi.mock()` stubs HTTP, inline mock data, validate parsing + error handling
- **Orchestrator tests:** mock all dependencies, verify 13-phase lifecycle
- **Env schema tests:** Zod parsing per board, detection priority, missing var errors
- **Hook tests:** stdin/stdout JSON contract — pipe mock event, assert on response JSON

---

## Entry Point Testability

This table drives the entire QA strategy. Only scriptable entry points can be integration-tested as code. Prompt-driven commands can only be tested at the board API interaction level.

| Command | Type | Entry point | Importable? |
|---|---|---|---|
| `/clancy:once` | TypeScript | `src/scripts/once/once.ts` | **Yes** — `run(argv: string[]): Promise<void>` |
| `/clancy:run` (AFK) | TypeScript | `src/scripts/afk/afk.ts` | **Yes** — `runAfkLoop(scriptDir, maxIterations?): Promise<void>` |
| `/clancy:init` | TypeScript | `src/installer/install.ts` | **No** (CLI-only), but 5 sub-modules are independently importable |
| `/clancy:dry-run` | Markdown | Wraps `/clancy:once --dry-run` | Via `run(['--dry-run'])` |
| `/clancy:plan` | Markdown | `src/roles/planner/commands/plan.md` | No — prompt-driven |
| `/clancy:approve-plan` | Markdown | `src/roles/planner/workflows/approve-plan.md` | No — prompt-driven |
| `/clancy:brief` | Markdown | `src/roles/strategist/commands/brief.md` | No — prompt-driven |
| `/clancy:approve-brief` | Markdown | `src/roles/strategist/workflows/approve-brief.md` | No — prompt-driven |
| `/clancy:doctor` | Markdown | `src/roles/setup/commands/doctor.md` | No — prompt-driven |
| `/clancy:map-codebase` | Markdown | `src/roles/setup/commands/map-codebase.md` | No — prompt-driven |
| `/clancy:review` | Markdown | `src/roles/reviewer/commands/review.md` | No — prompt-driven |
| `/clancy:status` | Markdown | `src/roles/reviewer/commands/status.md` | No — prompt-driven |
| `/clancy:update` | Markdown | `src/roles/setup/commands/update.md` | No — prompt-driven |
| `/clancy:logs` | Markdown | `src/roles/reviewer/commands/logs.md` | No — prompt-driven |

**Implication:** Integration tests focus on `once` (the orchestrator), `afk` (the loop runner), installer sub-modules, and the board API functions that prompt-driven commands call. We do not attempt to "run" prompt-driven commands programmatically.

---

## Gap Analysis

The 1217+ tests cover **unit-level correctness**. What's missing:

| Gap | What's untested | Risk |
|---|---|---|
| Multi-module flows | env -> board-detect -> fetch -> git -> prompt -> Claude -> verify -> PR -> status -> progress as a connected chain | Modules work alone but break together |
| Claude output simulation | Post-Claude phases (verification gates, PR creation, progress logging) have no realistic state to work with | Half the pipeline is untested as a connected flow |
| Pipeline lifecycle | brief -> plan -> build label transitions via board API functions | Cross-role label mutations break silently |
| Board write operations | Comment posting, ticket creation, label mutation, status transitions as connected flows | Read-path tested, write-path tested in isolation only |
| API contract drift | Real API response shapes change; mocked tests still pass | Production breaks despite green tests |
| Hook scenario depth | Hooks are tested but with basic inputs — real-world edge cases (credential patterns in comments, partial matches) may be missed | False positives/negatives in safety hooks |

**Not a gap (corrected from earlier analysis):**
- All 6 boards have comprehensive unit tests (raw + wrapper)
- All 8 hooks have co-located tests
- Shortcut, Notion, Azure DevOps are fully covered

---

## The 2-Layer QA Plan

### Layer 1: Integration Tests with MSW Mocks

**What makes these different from unit tests:** Unit tests mock at the module boundary (`vi.mock()` for every dependency). Integration tests have two primary mock boundaries:

1. **Network boundary** — MSW intercepts `fetch()` calls, returning realistic board API responses
2. **Claude boundary** — `vi.mock()` on `claude-cli` module replaces `invokeClaudeSession` with the Claude simulator

Plus controlled test environment: `vi.stubEnv()` for environment variables, `vi.useFakeTimers()` for time-dependent tests, temp filesystem for git operations. These are test fixtures, not behavior mocks — but they are mock boundaries and implementers should be aware of them.

Everything else runs real: env parsing, board detection, Zod validation, branch computation, git operations against a real temp repo, prompt building, verification gates, PR creation logic, progress logging, status transitions.

**Claude output simulator:** When the pipeline reaches the invoke phase, the mocked `invokeClaudeSession` calls the simulator, which creates realistic TypeScript files, stages and commits them with a conventional commit message. A "deliberate failure" variant creates broken code to test the self-healing retry path.

**Temp repo with real TypeScript scaffold:** A minimal TypeScript project with `package.json` (real lint/test/typecheck scripts), `tsconfig.json`, and basic vitest config. `node_modules` is installed once in test setup and symlinked per test to avoid per-test install overhead.

**Test flows:**

| Flow | Entry point | What it tests |
|---|---|---|
| Implementer lifecycle | `run(argv)` from once.ts | Full 13-phase pipeline per board x GitHub git host |
| AFK loop | `runAfkLoop()` from afk.ts (requires runner injection refactor) | Multi-ticket processing, stop conditions, time guard |
| Board API interactions | Board module functions directly | Comment posting, ticket creation, label mutations, status transitions (the operations prompt-driven commands trigger) |
| Pipeline label transitions | Board module label functions | brief -> plan -> build label lifecycle across 3 stages |
| Installer sub-modules | file-ops, manifest, hook-installer | Scaffold creation, manifest detection, file preservation |
| Hook scenarios | stdin/stdout contract | Expanded real-world scenarios for credential guard, branch guard, context monitor |

### Layer 2: E2E Against Real Platforms

Real API calls, real credentials, weekly CI. Scripts create test tickets, run the orchestrator with Claude stubbed, verify outcomes via API, clean up.

**Cleanup strategy per board:**

| Board | Cleanup | Notes |
|---|---|---|
| Jira | Close + `qa-cleanup` label | No API delete without admin |
| GitHub Issues | Close + `qa-cleanup` label | Cannot delete issues |
| Linear | `issueDelete` mutation | Full delete |
| Shortcut | `DELETE /stories/{id}` | Full delete |
| Notion | Archive page | Cannot truly delete |
| Azure DevOps | `DELETE /workitems/{id}` | Requires `destroy` permission |

**CI:** Weekly GitHub Actions workflow with per-board matrix, `fail-fast: false`, `workflow_dispatch` for manual single-board runs.

**Orphan ticket GC:** A scheduled cleanup job (can share the E2E workflow cron) queries each board for tickets with `[QA]` prefix older than 24 hours and closes/deletes them. This handles cases where `afterAll` never runs (CI killed, OOM, cancellation).

---

## Prerequisites — Production Code Changes

Before building integration tests, one small production change is needed:

**AFK runner injection:** Refactor `runAfkLoop()` in `src/scripts/afk/afk.ts` to accept an optional runner function parameter: `runAfkLoop(scriptDir, maxIterations?, runner?)`. Default is the current `spawnSync` behavior. Integration tests inject a runner that calls `run()` in-process so MSW can intercept board API calls. This is backwards-compatible — no change to existing behavior when the parameter is omitted.

Without this, AFK integration tests must either mock `spawnSync` (making them unit tests in disguise) or run the bundle as a subprocess (where MSW cannot intercept). Neither approach provides real integration coverage.

---

## Claude Stubbing Mechanism

The once orchestrator invokes Claude via `invokeClaudeSession(prompt, model?)` from `src/scripts/shared/claude-cli/claude-cli.ts`, which calls `spawnSync('claude', ...)`.

**Layer 1 (integration tests):** Mock the `claude-cli` module via `vi.mock()`. The mock's `invokeClaudeSession` calls the Claude simulator to create files, stage, and commit — then returns `true`. This is clean because the mock boundary is a single function.

```typescript
vi.mock('~/scripts/shared/claude-cli/claude-cli.js', () => ({
  invokeClaudeSession: (prompt: string) => {
    simulateClaudeSuccess(repoPath, ticketKey);
    return true;
  },
  invokeClaudePrint: () => ({ stdout: '', ok: true }),
}));
```

**Layer 2 (E2E tests):** E2E tests import and call `run()` with the same `vi.mock` approach, but against real board APIs (no MSW). Alternatively, E2E tests can spawn the built bundle as a child process with `CLANCY_CLAUDE_COMMAND` override — but this requires a small production code change. If the mock approach works for both layers, the production change is unnecessary.

---

## Build Order

| Session | Ticket | Goal | Est. sessions |
|---|---|---|---|
| 0 | QA-001 | Gap analysis + integration test infrastructure (simulator, temp repo, MSW, config) | 2 |
| 1a | QA-002a | Layer 1: Implementer + AFK flows (all 6 boards) | 2-3 |
| 1b | QA-002b | Layer 1: Board API interactions, pipeline labels, installer, hooks | 1-2 |
| 2 | QA-003 | Layer 2: E2E real platform setup + CI + cleanup | 1 + 2hr human |
| 3 | QA-004 | CI wiring + docs: wire everything in, update TESTING.md | 1 |

**Total: 7-9 sessions + ~2 hours human setup.**

**Runtime budget:** Layer 1 integration suite must complete in under 5 minutes on CI. If it exceeds that, split `describe.each` blocks into per-board test files that Vitest can parallelise.

---

## File Structure

```
test/
+-- integration/
|   +-- vitest.config.integration.ts
|   +-- global-setup.ts                     <- one-time npm install for shared scaffold
|   +-- helpers/
|   |   +-- claude-simulator.ts             <- post-Claude file creation + commit
|   |   +-- claude-simulator.test.ts
|   |   +-- temp-repo.ts                    <- temp git repo + TS project scaffold
|   |   +-- temp-repo.test.ts
|   |   +-- msw-server.ts                   <- shared MSW setup/teardown
|   |   +-- msw-server.test.ts
|   |   +-- env-fixtures.ts                 <- per-board env var sets for vi.stubEnv()
|   +-- mocks/
|   |   +-- handlers/                       <- one per board + git host (9 files)
|   |   +-- fixtures/                       <- per-board API response JSON
|   +-- flows/                              <- one test file per flow
+-- e2e/
    +-- helpers/                            <- ticket factory, cleanup, assertions
    +-- boards/                             <- one file per board
    +-- cleanup-stale.ts
```

---

## Known Limitations

**Prompt-driven commands are not regression-testable.** 12 of 14 commands are markdown prompts interpreted by Claude Code. If a workflow markdown file introduces a broken instruction, no automated test catches it. Mitigation: manual testing of prompt-driven commands before each release. This is an accepted risk — the alternative (spawning Claude Code sessions in CI) is expensive, non-deterministic, and produces subjective results.

**Esbuild bundle boundary is not tested at Layer 1.** Integration tests import from TypeScript source, not the built bundles. A bundling issue (missing export, tree-shaking removal) would pass Layer 1 but fail in production. Mitigation: Layer 2 E2E tests exercise the orchestrator against real APIs, and the existing CI build step catches compilation errors. A dedicated bundle smoke test (import the bundle, call `run(['--dry-run'])`) could be added as a lightweight Layer 1.5.

**GitLab and Bitbucket git hosts are only unit-tested.** Integration and E2E tests use GitHub as the sole git host. PR creation for GitLab MRs and Bitbucket PRs is covered at the unit level only. Mitigation: add GitLab/Bitbucket to integration tests as a follow-up once the GitHub path is proven.

---

**Notes on structure:**
- No `test/qa-agent/` — QA agent deferred post-v1.0.0
- `global-setup.ts` handles one-time `npm install` for the shared temp repo scaffold template
- `env-fixtures.ts` provides per-board env var sets derived from the Zod schemas in `src/schemas/env.ts`
- Fixtures validated against Zod schemas in a dedicated test to catch drift
- Audit findings documented in `docs/decisions/qa-strategy/` (this directory), not in `test/`
