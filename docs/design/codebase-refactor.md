# Codebase Refactor — Design Document

## Motivation

v0.8.0 adds three new board integrations (Shortcut, Notion, Azure DevOps). The current codebase has two structural problems that make this harder than it needs to be:

1. **`once.ts` is a 650-line monolith.** The `run()` function handles 14 distinct phases — lock check, preflight, board ping, epic completion, rework detection, ticket fetch, feasibility, branch setup, lock write, status transition, Claude invocation, delivery, cost logging, and cleanup. Every new feature that touches the orchestrator (verification gates in v0.7.0, crash recovery, cost logging) adds more lines to this single function. Testing requires mocking the entire world because every phase shares the same scope.

2. **Board modules duplicate structure without a shared contract.** `jira.ts` (527 lines), `github.ts` (400 lines), and `linear.ts` (528 lines) all implement `ping`, `fetchTicket(s)`, `fetchBlockerStatus`, `fetchChildrenStatus`, and `transitionIssue` — but there is no shared interface. The glue code in `board-ops.ts` (174 lines) is a set of switch statements that dispatch to the correct module. Adding a new board means: implement the functions, then update every switch statement in `board-ops.ts`, `fetch-ticket.ts`, `rework.ts`, and `deliver.ts`. Easy to miss one.

Both problems are manageable at three boards. At six boards, the switch statements double, the risk of missed dispatch cases grows, and the monolithic orchestrator becomes the bottleneck for every feature.

**Why now, not during v0.8.0?** Refactoring and feature work in the same PR creates review chaos. The refactor changes every import path in the orchestrator; the feature adds new board modules. Interleaving them means merge conflicts, harder bisection, and no clean "before/after" for reviewers. Ship the refactor first, then build v0.8.0 on clean foundations.

---

## Current State

### once.ts — the monolith

```
src/scripts/once/
├── once.ts                 650 lines  ← 14 phases in one function
├── once.test.ts           1250 lines  ← tests mock everything
├── board-ops/              174 lines  ← switch-statement dispatch
├── cost/                    31 lines
├── deliver/                424 lines
├── fetch-ticket/           186 lines
├── git-token/               34 lines
├── lock/                    82 lines
├── pr-creation/            107 lines
├── resume/                 247 lines
├── rework/                 376 lines
└── types/                   12 lines
```

The `run()` function in `once.ts` does everything sequentially. State is passed via local variables in function scope (`ticket`, `isRework`, `prFeedback`, `reworkPrNumber`, `lockOwner`, `originalBranch`, etc.). This makes it impossible to test phases in isolation or reuse phase logic in different orchestration contexts (e.g., a future "resume-only" mode or a "rework-only" mode).

### Board modules — no shared contract

```
src/scripts/board/
├── github/github.ts        400 lines
├── jira/jira.ts             527 lines
└── linear/linear.ts         528 lines
```

Each module exports the same conceptual operations but with different function signatures, different parameter shapes, and different return types. The `board-ops.ts` file in the orchestrator acts as a manual adapter layer — 4 switch statements (`pingBoard`, `validateInputs`, `transitionToStatus`, `fetchEpicChildrenStatus`) that unpack board-specific config and call the right module. It also exports `sharedEnv` — a helper used by 5 other sub-modules (`rework.ts`, `deliver.ts`, `pr-creation.ts`, `git-token.ts`, `resume.ts`).

The `rework.ts` file has 5 additional switch dispatches on `remote.host` (check review state, fetch comments in 2 places, post comment, resolve discussions/re-request review). `fetch-ticket.ts` has 2 more (`fetchCandidates`, `isBlocked`). Every touch-point that needs board-aware behaviour adds another switch.

---

## Proposed Changes

### Priority 1: Phase Pipeline

Extract each phase of `run()` into a standalone function that receives a `RunContext` and returns an updated context (or signals early exit). The orchestrator becomes a thin pipeline runner.

#### RunContext type

```typescript
type RunContext = {
  // Fixed at creation
  argv: string[];
  dryRun: boolean;
  skipFeasibility: boolean;
  startTime: number;
  cwd: string;
  isAfk: boolean; // from CLANCY_AFK_MODE env var

  // Populated by phases as they execute
  config?: BoardConfig;
  board?: Board; // created in preflight phase
  ticket?: FetchedTicket;
  isRework?: boolean;
  prFeedback?: string[];
  reworkPrNumber?: number;
  reworkDiscussionIds?: string[];
  reworkReviewers?: string[];
  ticketBranch?: string;
  targetBranch?: string;
  effectiveTarget?: string;
  baseBranch?: string;
  originalBranch?: string;
  lockOwner?: boolean;
  skipEpicBranch?: boolean;
  hasParent?: boolean; // derived: ticket.parentInfo !== 'none'
  tdd?: boolean; // from CLANCY_TDD env var
};
```

#### Phase function signature

```typescript
// Phases mutate context directly and return boolean (continue/stop).
// This avoids boilerplate — no need to return { continue: true, ctx } every time.
type Phase = (ctx: RunContext) => Promise<boolean> | boolean;
```

Each phase mutates the context and returns `true` to continue or `false` for early exit. The runner is:

```typescript
export async function run(argv: string[]): Promise<void> {
  const ctx: RunContext = {
    argv,
    dryRun: argv.includes('--dry-run'),
    isAfk: process.env.CLANCY_AFK_MODE === '1',
    ...
  };

  for (const phase of phases) {
    const shouldContinue = await phase(ctx);
    if (!shouldContinue) return;
  }
}
```

The `try/catch/finally` for branch restoration and lock cleanup wraps the pipeline loop, not each phase.

#### After — file structure

```
src/scripts/once/
├── once.ts                  ~60 lines  ← pipeline runner + phase list
├── once.test.ts            ~200 lines  ← integration tests for pipeline wiring
├── context/
│   └── context.ts           ~40 lines  ← RunContext type + PhaseResult + factory
├── phases/
│   ├── lock-check.ts             ~70 lines  ← phase 0: lock + stale + resume
│   ├── lock-check.test.ts        ~80 lines
│   ├── preflight.ts              ~30 lines  ← phase 1: env + board detection + validation + banner
│   ├── preflight.test.ts         ~40 lines
│   ├── ping.ts                   ~20 lines  ← phase 2: board connectivity
│   ├── ping.test.ts              ~30 lines
│   ├── epic-completion.ts        ~50 lines  ← phase 3: scan for completed epics
│   ├── epic-completion.test.ts   ~60 lines
│   ├── rework-detection.ts       ~40 lines  ← phase 4: PR review feedback
│   ├── rework-detection.test.ts  ~50 lines
│   ├── ticket-fetch.ts           ~30 lines  ← phase 5: fetch + blocker + HITL + ticket info print
│   ├── ticket-fetch.test.ts      ~60 lines
│   ├── feasibility.ts            ~30 lines  ← phase 6: feasibility check
│   ├── feasibility.test.ts       ~30 lines
│   ├── dry-run.ts                ~30 lines  ← phase 7: dry-run gate (print + exit)
│   ├── dry-run.test.ts           ~20 lines
│   ├── branch-setup.ts           ~60 lines  ← phase 8: git branch operations
│   ├── branch-setup.test.ts      ~80 lines
│   ├── lock-write.ts             ~25 lines  ← phase 9: write lock for crash recovery
│   ├── lock-write.test.ts        ~30 lines
│   ├── transition.ts             ~15 lines  ← phase 10: status → In Progress
│   ├── transition.test.ts        ~20 lines
│   ├── invoke.ts                 ~40 lines  ← phase 11: prompt + Claude session (includes CLANCY_ONCE_ACTIVE try/finally)
│   ├── invoke.test.ts            ~50 lines
│   ├── deliver.ts                ~60 lines  ← phase 12: PR creation + progress + completion print
│   ├── deliver.test.ts           ~70 lines
│   ├── cost.ts                   ~20 lines  ← phase 13: cost logging
│   ├── cost.test.ts              ~20 lines
│   ├── cleanup.ts                ~20 lines  ← phase 14: notification
│   └── cleanup.test.ts           ~20 lines
├── board-ops/               (unchanged)
├── cost/                    (unchanged)
├── deliver/                 (unchanged)
├── fetch-ticket/            (unchanged)
├── lock/                    (unchanged)
├── pr-creation/             (unchanged)
├── resume/                  (unchanged)
├── rework/                  (unchanged)
└── types/                   (unchanged)
```

Each phase file extracts the corresponding block from `run()` with minimal modification. The existing sub-modules (`deliver/`, `lock/`, `rework/`, etc.) stay where they are — the phases call into them. This is a structural refactor of the orchestrator, not a rewrite of the business logic.

#### Key design decisions

- **Mutable context, not immutable copies.** The context is a plain object mutated by each phase. Immutable copies add allocation overhead for no benefit — this is a sequential pipeline, not concurrent.
- **Phases are an ordered array, not a registry.** The execution order matters (you can't fetch a ticket before preflight). A simple array makes the order explicit and reviewable.
- **Early exit via return value, not exceptions.** Throwing for "no tickets found" is wrong — it's a normal exit. Returning `false` makes this explicit.
- **Runtime guards at phase boundaries.** Phases that depend on prior state (e.g., `deliver` needs `ctx.ticket`) assert it at the top. A missing field means a pipeline ordering bug, not a silent failure.
- **The `try/catch/finally` stays in `run()`.** Branch restoration and lock cleanup are cross-cutting — they belong in the runner, not in individual phases.

### Priority 2: Board Interface

Define a `Board` type and implement it for each provider. The `board-ops.ts` switch statements collapse into method calls on the board instance.

#### Board type

```typescript
type Board = {
  ping(): Promise<{ ok: boolean; error?: string }>;
  validateInputs(): string | undefined;
  fetchTicket(opts: FetchTicketOpts): Promise<FetchedTicket | undefined>;
  fetchTickets(opts: FetchTicketOpts): Promise<FetchedTicket[]>;
  fetchBlockerStatus(ticket: FetchedTicket): Promise<boolean>;
  fetchChildrenStatus(
    parentKey: string,
    parentId?: string,
  ): Promise<{ total: number; incomplete: number } | undefined>;
  transitionTicket(ticket: FetchedTicket, status: string): Promise<boolean>;
}
```

Each board implementation holds its own config (extracted from `BoardConfig`), so callers never need to unpack board-specific env vars.

**Abstraction note:** Some methods need board-specific context. For example, `fetchChildrenStatus` on Linear needs a `parentId` (UUID), which the orchestrator currently gets from `ticket.linearIssueId`. The Board implementation encapsulates this — the Linear board's `fetchChildrenStatus` accepts `parentKey` (human-readable) and resolves the UUID internally using its config. The caller never sees UUIDs.

#### Factory function

```typescript
function createBoard(config: BoardConfig): Board {
  switch (config.provider) {
    case 'jira':
      return createJiraBoard(config.env);
    case 'github':
      return createGitHubBoard(config.env);
    case 'linear':
      return createLinearBoard(config.env);
  }
}
```

Each `create*Board()` function returns a plain object conforming to the `Board` type — **no classes**. The codebase is entirely function-based; introducing classes would be a paradigm shift that complicates vitest mocking. The factory is the **only** switch statement in the system. All other board-aware code calls methods on the `Board` instance.

#### After — file structure

```
src/scripts/board/
├── board.ts                 ~30 lines  ← Board type + FetchTicketOpts type
├── factory/
│   ├── factory.ts           ~20 lines  ← createBoard() — the one switch
│   └── factory.test.ts      ~40 lines  ← verify correct board per provider
├── github/
│   ├── github.ts            400 lines  (unchanged — internal functions)
│   ├── github-board.ts      ~80 lines  ← createGitHubBoard() factory
│   ├── github-board.test.ts ~60 lines  ← verify delegation
│   └── github.test.ts       (unchanged)
├── jira/
│   ├── jira.ts              527 lines  (unchanged — internal functions)
│   ├── jira-board.ts        ~80 lines  ← createJiraBoard() factory
│   ├── jira-board.test.ts   ~60 lines  ← verify delegation
│   └── jira.test.ts         (unchanged)
├── linear/
│   ├── linear.ts            528 lines  (unchanged — internal functions)
│   ├── linear-board.ts      ~80 lines  ← createLinearBoard() factory
│   ├── linear-board.test.ts ~60 lines  ← verify delegation
│   └── linear.test.ts       (unchanged)
└── shared/                  (future — epic detection, blocker detection)
```

The existing board module files (`jira.ts`, `github.ts`, `linear.ts`) are **not modified**. The new `*-board.ts` files are thin factory functions returning plain objects that conform to the `Board` type by calling the existing functions. No classes — consistent with the codebase's function-based style. This avoids retesting 1,455 lines of board logic.

#### board-ops.ts elimination

Once the `Board` type exists, `board-ops.ts` (174 lines, 4 switch statements) is replaced by passing a `Board` instance through the `RunContext`. The phases call `ctx.board.ping()` instead of `pingBoard(config)`. The `board-ops.ts` file is deleted.

**`sharedEnv` relocation:** The `sharedEnv()` helper is imported by 5 sub-modules (`rework.ts`, `deliver.ts`, `pr-creation.ts`, `git-token.ts`, `resume.ts`). Before deleting `board-ops.ts`, relocate `sharedEnv` to `src/scripts/shared/env-schema/env-schema.ts` (where `detectBoard` already lives) and update all 5 import paths. This is a separate commit before the deletion.

**`transitionToStatus` relocation:** Also imported by `deliver.ts`. Relocate to a Board method (`ctx.board.transitionTicket()`) or to a standalone shared module.

`fetch-ticket.ts` similarly simplifies — instead of its own 2 switch statements dispatching to three different fetch functions, it accepts a `Board` and calls `board.fetchTickets()` / `board.fetchBlockerStatus()`.

### Priority 3: PR Review Client (After Priorities 1 & 2)

`rework.ts` has 5 switch dispatches on `remote.host` for platform-specific PR review functions (GitHub, GitLab, Bitbucket Cloud, Bitbucket Server). The PR creation modules (`github.ts`, `gitlab.ts`, `bitbucket.ts` under `shared/pull-request/`) share review state detection and comment building patterns (~300 lines duplicated).

Create a `PrReviewClient` type:
- `checkReviewState(...)` → `ReviewState`
- `fetchReviewComments(...)` → `string[]`
- `postComment(...)` → `boolean`
- `requestReview(...)` → `boolean`
- `resolveDiscussions(...)` → `number`

A `createPrReviewClient(remote)` factory replaces all 5 switch dispatches in `rework.ts`. Also unify shared review logic in `shared/pull-request/review-detector.ts`.

**Timing:** After Priorities 1 & 2 ship. Same PR if the refactor is still in flight, or a follow-up PR if they've already merged. Not blocked on v0.8.0 — this improves the existing git host support.

---

## What NOT to Change

These are fine as-is and should not be touched during this refactor:

- **Individual board modules** (`jira.ts`, `github.ts`, `linear.ts`). They work, they're tested, they're the right size. The Board type wraps them; it doesn't replace them.
- **Most sub-modules of the orchestrator** (`lock/`, `rework/`, `resume/`, `cost/`, `pr-creation/`, `git-token/`). These are already well-factored. The phases call into them.
- **Note:** `deliver/deliver.ts` and `fetch-ticket/fetch-ticket.ts` DO need minor changes — they import `sharedEnv` and `transitionToStatus` from `board-ops.ts`, and `fetch-ticket.ts` has 2 internal switch statements. These are addressed in Wave 5.
- **Shared utilities** (`src/scripts/shared/`). Already modular.
- **Hook files** (`hooks/`). CommonJS, separate concern.
- **Agent prompts** (`src/agents/`). Markdown, no code dependency.
- **The AFK runner** (`src/scripts/afk/`). Calls `run()` — the interface doesn't change.
- **Env schema / board detection** (`src/scripts/shared/env-schema/`). The `detectBoard()` function and `BoardConfig` type stay. The `Board` type sits above them.

---

## Migration Strategy

The key constraint: **every commit must pass all 764 tests.** No "break then fix" steps.

### Phase pipeline migration

1. Create `context/context.ts` with the `RunContext` type and `PhaseResult` type. No existing code changes — additive only.
2. Extract phases one at a time, starting from the top of `run()`. For each phase:
   - Create `phases/{name}.ts` with the phase function.
   - Replace the corresponding block in `run()` with a call to the phase function.
   - The test file (`once.test.ts`) continues to pass because the behaviour is identical — same mocks, same assertions.
3. After all phases are extracted, `run()` is the pipeline runner. Write new isolated phase tests in `phases/phases.test.ts`.
4. Thin out `once.test.ts` to integration-level pipeline tests (does the full pipeline wire correctly?). Move phase-specific assertions to the phase test file.

This approach means tests pass at every step. The existing test file is the safety net during extraction; the new phase tests are the long-term replacement.

### Board type migration

1. Create `board/board.ts` with the `Board` type. Additive only.
2. Create `board/factory.ts` with `createBoard()`. Additive only.
3. Create `*-board.ts` wrapper classes, one board at a time. Each wrapper calls existing functions — no logic changes.
4. Add `board` to `RunContext`. Update `createBoard()` call in the preflight phase.
5. Replace switch statements in `board-ops.ts` one at a time with `ctx.board.*` calls.
6. Once all switches are migrated, delete `board-ops.ts`.
7. Update `fetch-ticket.ts` to accept a `Board` instead of dispatching internally.

Again, tests pass at every step because the wrappers call the same underlying functions.

---

## Execution Plan

### Wave 1: RunContext and Phase Infrastructure

**Files created:**
- `src/scripts/once/context/context.ts` — RunContext type, PhaseResult type, createContext factory

**Files modified:**
- None (additive only)

**Tests:**
- Type-level only — the context factory is a plain object constructor

**Review gate:** DA reviews the RunContext type. Key question: does it capture all state needed by all 14 phases? Cross-reference every local variable in `run()`.

---

### Wave 2: Extract Phases (top half — phases 0-7)

Extract the first 8 phases from `run()`. Each phase becomes a file under `phases/`.

**Files created:**
- `src/scripts/once/phases/lock-check.ts`
- `src/scripts/once/phases/preflight.ts`
- `src/scripts/once/phases/ping.ts`
- `src/scripts/once/phases/epic-completion.ts`
- `src/scripts/once/phases/rework-detection.ts`
- `src/scripts/once/phases/ticket-fetch.ts`
- `src/scripts/once/phases/feasibility.ts`
- `src/scripts/once/phases/dry-run.ts`

**Files modified:**
- `src/scripts/once/once.ts` — replace inline blocks with phase calls

**Tests:**
- Existing `once.test.ts` passes unchanged (behaviour preserved)
- New unit tests for each phase function

**Review gate:** DA reviews phase boundaries. Key questions: is state correctly threaded through RunContext? Are early exits handled identically to the original? Any phase that silently drops context fields?

---

### Wave 3: Extract Phases (bottom half — phases 8-14)

**Files created:**
- `src/scripts/once/phases/branch-setup.ts`
- `src/scripts/once/phases/lock-write.ts`
- `src/scripts/once/phases/transition.ts`
- `src/scripts/once/phases/invoke.ts`
- `src/scripts/once/phases/deliver.ts`
- `src/scripts/once/phases/cost.ts`
- `src/scripts/once/phases/cleanup.ts`

**Files modified:**
- `src/scripts/once/once.ts` — now just the pipeline runner (~60 lines)

**Tests:**
- Existing `once.test.ts` passes unchanged
- New unit tests for each phase function
- Refactor `once.test.ts` to integration-level pipeline tests

**Review gate:** DA reviews the final `once.ts` pipeline runner. Key question: does the try/catch/finally correctly handle branch restoration and lock cleanup for all exit paths (phase early exit, thrown exception, normal completion)?

---

### Wave 4: Board Interface + Wrappers

**Files created:**
- `src/scripts/board/board.ts` — Board type
- `src/scripts/board/factory.ts` — createBoard()
- `src/scripts/board/github/github-board.ts` — GitHubBoard
- `src/scripts/board/jira/jira-board.ts` — JiraBoard
- `src/scripts/board/linear/linear-board.ts` — LinearBoard

**Tests:**
- Unit tests for each Board wrapper (verify delegation to existing functions)
- Unit test for factory (verify correct class instantiation per provider)

**Review gate:** DA reviews the Board type. Key questions: does it cover all operations used by the orchestrator? Are the parameter types general enough for new boards (Shortcut, Notion, Azure DevOps) or do they leak Jira/GitHub/Linear assumptions?

---

### Wave 5: Relocations + Switch Elimination

Two sub-steps: relocate shared helpers first, then replace switches.

**Step 5a — Relocate shared helpers (must happen before deletion):**
- Move `sharedEnv()` from `board-ops.ts` to `src/scripts/shared/env-schema/env-schema.ts`
- Update 5 import paths: `rework.ts`, `deliver.ts`, `pr-creation.ts`, `git-token.ts`, `resume.ts` + `resume.test.ts`
- Run tests — must pass before proceeding

**Step 5b — Replace switch dispatching with Board method calls:**

**Files modified:**
- `src/scripts/once/phases/preflight.ts` — add `ctx.board = createBoard(config)`
- `src/scripts/once/phases/ping.ts` — `ctx.board.ping()` instead of `pingBoard(config)`
- `src/scripts/once/phases/epic-completion.ts` — `ctx.board.fetchChildrenStatus()`
- `src/scripts/once/phases/ticket-fetch.ts` — `ctx.board.fetchTickets()`
- `src/scripts/once/phases/transition.ts` — `ctx.board.transitionTicket()`
- `src/scripts/once/fetch-ticket/fetch-ticket.ts` — accept Board, remove 2 internal switches
- `src/scripts/once/deliver/deliver.ts` — use Board for `transitionToStatus` calls

**Files deleted:**
- `src/scripts/once/board-ops/board-ops.ts` (174 lines)
- `src/scripts/once/board-ops/board-ops.test.ts` (319 lines)

**Tests:**
- All existing tests updated to use Board mock instead of individual board function mocks
- `board-ops.test.ts` coverage migrated to board wrapper tests + phase tests
- `fetch-ticket.test.ts` updated for new Board-accepting signature

**Review gate:** DA reviews the full diff. Key questions: any remaining switch statements on `config.provider` outside the factory? Any board-specific logic that leaked into phase files? Is `sharedEnv` accessible from all 5 consumers? Is `transitionToStatus` properly handled?

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phase extraction introduces subtle behaviour change | Medium | Extract mechanically — copy-paste blocks, convert local variables to context fields. Run full test suite after each phase extraction. No logic changes. |
| RunContext grows unwieldy as features are added | Low | Context fields are already the local variables in `run()` today — making them explicit doesn't increase complexity, it makes it visible. If it grows past ~25 fields, group into sub-objects (e.g., `ctx.rework.*`). |
| Board type is too narrow for new boards | Medium | Review interface against Shortcut, Notion, and Azure DevOps APIs during Wave 4 DA review. The interface can be extended (new optional methods) without breaking existing implementations. |
| Test rewrite takes longer than expected | Medium | Don't rewrite tests in the extraction waves. Let the existing `once.test.ts` be the safety net. Write new phase tests additively. Refactor `once.test.ts` only after all phases are extracted and independently tested. |
| Import path changes break the esbuild bundle | Low | The bundle entry point is `once.ts` — as long as it exports `run()` with the same signature, the bundle works. Run `npm run build` after each wave. |

---

## Success Criteria

- `once.ts` is under 80 lines (pipeline runner + phase list + try/catch/finally)
- Each phase is independently testable with a `RunContext` mock
- `board-ops.ts` is deleted — no switch statements on `config.provider` outside `factory.ts`
- Adding a new board requires: one `*-board.ts` file implementing `Board`, one case in `factory.ts`, and the board module itself. No other files touched.
- All 764 existing tests pass
- Test count increases (new phase tests + board wrapper tests)
- `npm run build` produces working bundles
