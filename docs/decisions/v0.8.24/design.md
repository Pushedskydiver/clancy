# v0.8.24 — Code Quality Refactor

## Problem

The codebase has accumulated quality debt across `src/scripts/`. Key issues:

- **Duplication**: ~200 lines of identical fetch/parse/validate boilerplate across 6 board modules. ~240 lines of duplicated label CRUD. Dual switch statements in rework detection.
- **Complexity**: `deliverViaPullRequest` is 204 lines with 9 parameters and a 103-line if/else chain. Mixed concerns (git ops, file I/O, PR creation, logging, board transitions).
- **Inconsistency**: Error handling varies between boards. Some functions use `let` where `const` works. No ESLint enforcement of complexity limits.

The goal is code that is simple to follow, legible, broken down to the simplest logic possible.

## Approach

Epic branch (`epic/code-quality`) with small, releasable child PRs. Test-first using `/tdd` — write pure function tests before refactoring. E2E run against all 6 boards before final epic PR to main.

## Quality Thresholds (enforced by ESLint in final PR)

Thresholds use a **ratchet strategy**: start as `warn` with `--max-warnings N` set to the current violation count in CI, then reduce N to 0 as PRs land. Rules that the epic fully resolves are promoted to `error` in PR 6. Rules with remaining violations stay as `warn` with a target of 0 for post-epic work.

| Metric | Threshold | Initial | Target | Rationale |
|---|---|---|---|---|
| Function length | 60 lines | warn | error | Google recommends 40; we allow 60 for orchestrators. Board factory functions (160-270 lines) will use `eslint-disable-next-line` until class-based refactor. |
| Parameters | 4 | warn | error | Encourages options objects. ~80 functions exceed 3; 4 is achievable this epic. Post-epic target: 3. |
| Nesting depth | 3 | error | error | Achievable now with early returns and guard clauses |
| Cyclomatic complexity | 10 | warn | error | NIST standard for testable functions |
| File length | 300 lines | warn | warn | Gradual enforcement; some board modules legitimately exceed this |
| `prefer-const` | — | error | error | Universal consensus; `let` only when reassignment is required |
| `no-floating-promises` | — | error | error | Async safety |
| `switch-exhaustiveness-check` | — | error | error | Board factory + platform dispatch patterns |
| `consistent-type-imports` | — | error | error | Type imports first, enforced by Prettier plugin |

**CI enforcement**: `eslint . --max-warnings N` — N starts at the current violation count and decreases with each PR. PR 6 sets N to 0.

## Patterns

### 1. `fetchAndParse<T>()`

Eliminates try/fetch/check-ok/parse-json/validate-zod boilerplate:

```typescript
async function fetchAndParse<T>(
  url: string,
  init: RequestInit | undefined,
  opts: { schema: ZodSchema<T>; label: string },
): Promise<T | undefined>
```

Scoped to single-request + JSON + Zod. Boards with pagination (Notion), multi-step (AzDO), or deep unwrapping (Linear) keep their own wrappers that call `fetchAndParse` internally. Board-specific error semantics (rate limits, auth failures) remain board-specific by design — `fetchAndParse` standardises the try/catch/parse path, not the recovery strategy.

### 2. Pure outcome computation

Replace 103-line if/else with discriminated union:

```typescript
type PrOutcome =
  | { type: 'created'; url: string; number: number }
  | { type: 'exists' }
  | { type: 'failed'; error: string }
  | { type: 'no_remote' };

function computePrOutcome(pr, remote): PrOutcome  // pure, testable
```

Orchestrator switches on outcome type for logging/progress. Logic separated from side effects.

### 3. Options objects

Replace long parameter lists:

```typescript
// Before: 9 positional params
deliverViaPullRequest(config, ticket, branch, target, start, skip, parent, board, single)

// After: semantic grouping
deliverViaPullRequest(ctx: DeliveryContext, ticket: TicketDelivery, opts?: DeliveryOptions)
```

### 4. Platform handler maps

Replace dual switches in rework detection:

```typescript
const reviewHandlers: Record<string, PrReviewHandler> = {
  github: { checkState: checkGitHubPrReviewState, fetchComments: ... },
  gitlab: { checkState: checkGitLabMrReviewState, fetchComments: ... },
  ...
};
```

### 5. Shared label operations

Extract common add/remove pattern from 6 board wrappers into a shared helper, with board-specific API calls passed as callbacks.

## PR Breakdown

**Dependency order**: PR 3 lands after PR 2b (both touch the Board interface).

| PR | Scope | Files | Risk |
|---|---|---|---|
| **1a** | `fetchAndParse<T>()` utility + GitHub + Jira conversion | ~8 | Medium |
| **1b** | `fetchAndParse` — Linear, Shortcut, Notion, AzDO | ~8 | Medium |
| **2a** | `deliverViaPullRequest` — options object + `computePrOutcome()` pure fn | ~4 | High |
| **2b** | `deliverViaPullRequest` + `deliverEpicToBase` — orchestrator simplification + branch-setup guard clauses | ~4 | High |
| **3** | Board label CRUD consolidation (after PR 2b) | ~7 | Medium |
| **4a** | Rework platform strategy map | ~2 | Low |
| **4b** | Remote parsing deduplication (`parsePlatformPath`) | ~2 | Low |
| **5** | Housekeeping — `retry.ts` rename, `role-filter` test, document conventions | ~4 | Low |
| **6** | ESLint/Prettier tightening — lock in all rules, set `--max-warnings 0` | ~2 | Low |

## Process per PR

1. Write pure function tests first (`/tdd` approach)
2. Refactor to make them pass
3. All existing unit + integration tests must pass + `npm run typecheck` clean
4. DA review (sub-agent) + Copilot review
5. Reply to all Copilot comments
6. Squash merge to epic branch

## Final gate

- All unit tests pass
- All integration tests pass
- E2E run against all 6 boards
- `npm run lint` clean (zero warnings)
- `npm run typecheck` clean

## What's NOT in scope

| Item | Reason |
|---|---|
| `detectBoard` registry pattern | Stable 30-line function; refactoring is cosmetic |
| `buildPrBody` split | Linear pipeline with high cohesion; 88 lines justified. Will use `eslint-disable-next-line` for function length. |
| `branch-setup.ts` full rewrite | Intentional decision tree; only guard clause cleanup in PR 2b |
| `prompt.ts` extraction | 3-line duplication used twice; not worth indirection |
| `installer/`, `utils/`, `schemas/` | All audited clean |
| Schema subdirectory reorganisation | 9 flat files is navigable; adding dirs adds friction |
| Children-status duplication | Board-specific query logic dominates (~70% of each function); only result aggregation is common. `fetchAndParse` addresses the fetch boilerplate portion. Full consolidation deferred — diminishing returns. |
| PR module param signatures (6-8 params) | Board-specific parameters (token, repo, owner, apiBase, branch, since) are semantically distinct per platform. Options objects would help but require touching all 4 PR platform modules + all callers. Deferred to post-epic; `max-params: 4` as warn catches the worst offenders. |
| Board factory function length (160-270 lines) | Factory functions are method-map objects — each method is short but the enclosing function is long. Will use `eslint-disable-next-line` until potential class-based refactor. |
| Error handling standardisation | `fetchAndParse` standardises the fetch/parse path. Board-specific recovery (rate limits, auth retry) remains board-specific by design — each API has different semantics. |

## Lifecycle changes

| Process | Integration | Frequency |
|---|---|---|
| `/tdd` | Standard approach during build phase | Every feature/fix PR |
| `/improve-codebase-architecture` | Deep module analysis before major versions | Before each major version |
| ESLint complexity enforcement | CI + pre-commit hook | Every commit |
