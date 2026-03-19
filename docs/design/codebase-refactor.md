# Codebase Refactor — Design Decisions

Shipped in v0.7.1. This document preserves the key design decisions — the implementation lives in `src/scripts/once/phases/`, `src/scripts/once/context/`, and `src/scripts/board/`.

---

## Problem

1. **`once.ts` was a 650-line monolith.** 14 distinct phases in one `run()` function. Every new feature added more lines. Testing required mocking everything because all phases shared scope.

2. **Board modules had no shared contract.** 3 boards × identical operations but no `Board` type. 6+ switch statements scattered across `board-ops.ts`, `fetch-ticket.ts`, and `rework.ts`. Adding a new board meant updating every switch — easy to miss one.

## Solution

### Phase pipeline

Extract `run()` into 13 composable phase functions under `src/scripts/once/phases/`. Each phase mutates a shared `RunContext` and returns `boolean` (continue/stop). The orchestrator is now 110 lines — a thin pipeline runner with try/catch/finally.

### Board type

Unified `Board` type (`src/scripts/board/board.ts`) with 7 methods: `ping`, `validateInputs`, `fetchTicket`, `fetchTickets`, `fetchBlockerStatus`, `fetchChildrenStatus`, `transitionTicket`, `sharedEnv`. Factory function (`createBoard` in `src/scripts/board/factory/`) is the single switch on `config.provider`. Three board wrappers return plain objects — no classes.

### board-ops.ts deletion

`sharedEnv` relocated to `src/scripts/shared/env-schema/env-schema.ts`. All switch dispatch replaced by `ctx.board.*` method calls. `board-ops.ts` (174 lines) and its tests (319 lines) deleted.

## Key Decisions

1. **Mutable context, not immutable copies.** Sequential pipeline, no concurrency. Immutable copies add allocation overhead for no benefit.

2. **Phases are an ordered array, not a registry.** Execution order matters — a simple array makes it explicit and reviewable.

3. **Early exit via return value, not exceptions.** "No tickets found" is a normal exit, not an error. `false` makes this explicit.

4. **Runtime guards at phase boundaries.** Phases that depend on prior state assert it at the top. Missing field = pipeline ordering bug.

5. **Factory functions, not classes.** The codebase is entirely function-based. Board wrappers return plain objects conforming to the `Board` type. Consistent with existing patterns and simpler for vitest mocking.

6. **`sharedEnv` relocated, not duplicated.** Moved to env-schema.ts (where `detectBoard` lives) so the 5 sub-modules that import it don't need access to the Board instance.

7. **Intentional remaining switches.** `fetch-ticket.ts` (2 switches) and `pr-body.ts` (1 switch) handle provider-specific API mapping and PR formatting — not Board concerns. Documented with comments.

8. **PR Review Client deferred.** `rework.ts` switches on `remote.host` (git platform), not `config.provider` (board). Different axis — deferred until a new git host is added.
