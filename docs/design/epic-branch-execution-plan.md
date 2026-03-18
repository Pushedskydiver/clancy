# Epic Branch Workflow — Execution Plan

## Overview

Replace the local squash-merge delivery path (`deliverViaEpicMerge`) with PR-based epic branches. ~14 files modified, ~3 deleted/replaced. 4 waves, targeting a single version bump.

**Prerequisite:** The design document (`epic-branch-workflow.md`) must be reviewed and approved. All design decisions are resolved.

---

## Review Findings (addressed in this plan)

Issues caught by devil's advocate review and incorporated:

| # | Finding | Rating | Resolution |
|---|---|---|---|
| 1 | `parseProgressFile` breaks when `parent:KEY` appended after `pr:N` — positional parser assumes `pr:N` is last segment | BLOCKER | Step 1b: rewrite parser to use named-prefix matching (`pr:`, `parent:`) instead of positional segments |
| 2 | `buildPrBody` doesn't receive `targetBranch` — can't call `isEpicBranch` | BLOCKER | Step 1f: add `targetBranch` param to `buildPrBody`. Step 3a: pass target branch from `deliverViaPullRequest` |
| 3 | Single-child skip needs total child count before delivery, not incomplete count after | BLOCKER | Step 2a-2c: `fetchChildrenStatus` returns `{ total, incomplete }`. Step 3c: check total before branching |
| 4 | Users with local-only epic branches lose squash-merged work on upgrade | BLOCKER | Step 3a: `ensureEpicBranch` checks for local branch with unpushed commits, refuses to overwrite, prints migration instructions |
| 5 | Phase 5 staleness check missing from plan | BLOCKER | Added as Step 3a (part of `ensureEpicBranch`) |
| 6 | Epic PR creation failure silently lost | WARNING | Step 3c: on `deliverEpicToBase` failure, log prominent warning with manual instructions. Future: retry on next run |
| 7 | `appendProgress` parent param must flow through `deliverViaPullRequest` | WARNING | Step 3a: add `parent` param to `deliverViaPullRequest` signature, pass through to all `appendProgress` calls |
| 8 | Rework fallback "re-fetch from board" understated as Small | WARNING | Step 2d: upgraded to Medium. Board re-fetch is the fallback for legacy entries without `parent:` field |
| 9 | `fetchChildrenStatus` return type inconsistency across boards | WARNING | Step 2a-2c: standardise return type as `{ total: number; incomplete: number }` for all boards |
| 10 | AFK wasted iteration after epic completion | WARNING | Documented as expected behaviour in Step 3c |
| 11 | Epic branch creation race on `git push` | WARNING | Step 3a: `ensureEpicBranch` uses `git push -u origin` which is safe — both sessions branch from same `origin/main` commit |
| 12 | `ensureEpicBranch` creates from stale `origin/main` | WARNING | Step 3a: always `git fetch origin {baseBranch}` before creating epic branch |
| 13 | Existing tests break and need rewriting | WARNING | Steps 3b/3d: explicit rewrite count added to test estimates |
| 14 | `docs/ARCHITECTURE.md` references deleted function | NOTE | Added to Wave 4 |

---

## Wave Structure

### Wave 1 — Foundation (partially parallel)

Building blocks. Steps 1a-1c are sequential (type dependencies). Steps 1d-1e and 1f-1g can run in parallel once 1b is done (1f depends on `ProgressEntry` shape from 1b).

```
1a → 1b → 1c ──┬──→ 1d → 1e
                └──→ 1f → 1g
```

| Step | Files | Change | Complexity |
|---|---|---|---|
| **1a** | `src/types/remote.ts` | Add `EPIC_PR_CREATED`, `EPIC_COMPLETE` to `ProgressStatus` union type | Trivial |
| **1b** | `src/scripts/shared/progress/progress.ts` | Add optional `parent` param to `appendProgress`. Update `ProgressEntry` type with `parent?`. **Rewrite `parseProgressFile` to use named-prefix matching** — scan each segment for `pr:` and `parent:` prefixes instead of positional indexing. This is critical: the current parser assumes `pr:N` is the last pipe-delimited segment, which breaks when `parent:KEY` is appended. | **Medium** |
| **1c** | `src/scripts/shared/progress/progress.test.ts` | Tests for: (1) write with parent + pr, read back both; (2) write with parent only, pr is undefined; (3) write with pr only, parent is undefined; (4) legacy entry without parent parses correctly; (5) `findEntriesWithStatus` returns parent field; (6) `countReworkCycles` still works with new format. | Small |
| **1d** | `src/scripts/shared/git-ops/git-ops.ts` | Add `remoteBranchExists(branch)` — runs `git ls-remote --heads origin {branch}`, returns boolean. Add `fetchRemoteRef(branch)` — runs `git fetch origin {branch}:{branch}` to set up local tracking. | Small |
| **1e** | `src/scripts/shared/git-ops/git-ops.test.ts` | Tests for `remoteBranchExists` (found, not found, network error) and `fetchRemoteRef` (success, failure). Mock `execSync`. | Small |
| **1f** | `src/scripts/shared/pull-request/pr-body/pr-body.ts` | Add `isEpicBranch(targetBranch)` helper (checks `epic/` or `milestone/` prefix). **Add `targetBranch` param to `buildPrBody`** — when `isEpicBranch(targetBranch)` is true, emit `Part of {key}` instead of `Closes {key}`. Add `buildEpicPrBody(epicKey, epicTitle, childEntries)` function for the final epic PR. | Medium |
| **1g** | `src/scripts/shared/pull-request/pr-body/pr-body.test.ts` | Tests for: (1) `isEpicBranch` true/false/edge cases (`epic/`, `epicfoo/`, `milestone/`); (2) `buildPrBody` emits `Closes` when targeting main; (3) `buildPrBody` emits `Part of` when targeting `epic/proj-100`; (4) `buildEpicPrBody` output lists child PRs; (5) existing tests updated for new `targetBranch` param. | Small |

### Wave 2 — Board Queries + Rework Fix (parallel, 4 agents)

Independent of each other. All depend on Wave 1. Agents must NOT import from each other's files.

| Agent | Files | Change | Complexity |
|---|---|---|---|
| **2a** | `src/scripts/board/jira/jira.ts`, `jira.test.ts` | Add `fetchChildrenStatus(config, parentKey)` — JQL: `parent = {KEY}`, count total and filter incomplete (`statusCategory != 'done'`). Return `{ total, incomplete }`. Tests with mocked HTTP. | Medium |
| **2b** | `src/scripts/board/github/github.ts`, `github.test.ts` | Add `fetchChildrenStatus(config, parentIssueNumber)` — GET `/issues?state=all`, filter body for `Parent: #{N}`. Count total and open. Return `{ total, incomplete }`. Tests with mocked HTTP. | Medium |
| **2c** | `src/scripts/board/linear/linear.ts`, `linear.test.ts` | Add `fetchChildrenStatus(config, parentUuid)` — GraphQL: parent's children, count total and filter `state.type` not in `["completed", "canceled"]`. Return `{ total, incomplete }`. Tests with mocked GraphQL. | Medium |
| **2d** | `src/scripts/once/rework/rework.ts`, `rework.test.ts` | Read `parent` field from progress entry, pass to `FetchedTicket.parentInfo`. **Fallback for legacy entries:** if `parent` field missing, re-fetch ticket from board to get parent info (new board call). If board fetch fails, fall back to base branch and log warning. Tests: parent from progress, parent from board fallback, fallback to base. | **Medium** |

### Wave 3 — Orchestrator Rewrite (sequential, critical path)

Depends on Waves 1 and 2. This is the core change.

| Step | Files | Change | Complexity |
|---|---|---|---|
| **3a** | `src/scripts/once/deliver/deliver.ts` | **Delete `deliverViaEpicMerge`** entirely. **Add `parent` param to `deliverViaPullRequest`** — pass through to all 6 `appendProgress` calls inside it. Pass `targetBranch` to `buildPrBody`. **Add `ensureEpicBranch(targetBranch, baseBranch)`:** (1) `git fetch origin {baseBranch}` to ensure fresh ref; (2) check for local branch with unpushed commits — if found, refuse with migration instructions; (3) `remoteBranchExists` — if exists, `fetchRemoteRef`; if not, create from `origin/{baseBranch}` and push; (4) **staleness check:** compare epic branch with `origin/{baseBranch}`, warn if behind (>10 commits: confirm or abort). **Add `deliverEpicToBase(config, epicKey, epicTitle, epicBranch, baseBranch, childEntries)`** — builds epic PR body from child entries, calls `attemptPrCreation` targeting base branch, logs `EPIC_PR_CREATED`. | **Large** |
| **3b** | `src/scripts/once/deliver/deliver.test.ts` | Rewrite/add: (1) `ensureEpicBranch` — create from remote, fetch existing, refuse overwrite of local unpushed, staleness warning; (2) `deliverEpicToBase` — happy path, `alreadyExists` guard, failure warning; (3) `deliverViaPullRequest` — parent param passed to `appendProgress`; (4) confirm `deliverViaEpicMerge` import fails (deleted). **~5 existing tests need rewriting** (not just removal). | **Medium** |
| **3c** | `src/scripts/once/once.ts` | Rewrite delivery section (lines 315-363): **Before branching (step 10),** for parented tickets: (1) call `fetchChildrenStatus` to get `{ total, incomplete }`; (2) if `total === 1`, skip epic branch — deliver directly to base (single-child optimisation); (3) otherwise call `ensureEpicBranch`. **After delivery (step 13),** for parented tickets delivered to epic branch: (1) call `fetchChildrenStatus` again (ticket now done); (2) if `incomplete === 0`, call `deliverEpicToBase`; (3) if `deliverEpicToBase` fails, log `⚠ Epic PR creation failed. Create manually: git push origin {epicBranch} && create PR targeting {baseBranch}`. **Note:** one wasted AFK iteration after epic completion is expected (next iteration finds no tickets → stops). | **Large** |
| **3d** | `src/scripts/once/once.test.ts` | Rewrite: (1) parented ticket → `deliverViaPullRequest` targeting epic branch (was `deliverViaEpicMerge` with squash); (2) epic complete → `deliverEpicToBase` called; (3) single child (total=1) → skip epic branch, deliver to base; (4) parent info passed to `appendProgress`; (5) `deliverEpicToBase` failure → warning logged, not thrown; (6) rework on parented ticket → correct target branch. **~5 existing tests need rewriting.** | **Medium** |

### Wave 4 — Documentation + Verification

| Step | Files | Change |
|---|---|---|
| **4a** | `docs/design/strategist-visual-flows.md` | Add epic branch mention to approve-brief Step 12 summary |
| **4b** | `docs/VISUAL-ARCHITECTURE.md` | Update diagram 2 (Ticket Lifecycle — remove EpicMerge → squash path, both paths use PR), diagram 3 (Once Orchestrator — HasParent path creates PR targeting epic branch, not squash merge), and diagram 7 (Delivery Paths — rename title, show epic branch flow). All three diagrams reference the old `deliverViaEpicMerge` model. |
| **4c** | `docs/ARCHITECTURE.md` | Update `deliver.ts` description (remove `deliverViaEpicMerge` reference) |
| **4d** | `CHANGELOG.md`, `package.json`, `package-lock.json` | Version bump + changelog entry with migration guidance |
| **4e** | `README.md` | Update test badge count |
| **4f** | Run `npm test && npm run typecheck && npm run lint` | Full verification |

---

## Dependency Graph

```
Wave 1 (partially parallel)
  1a → 1b → 1c ──┬──→ 1d → 1e
                  └──→ 1f → 1g
                              |
                              v
Wave 2 (parallel)       ┌────┼────┐────┐
                        v    v    v    v
                       2a   2b   2c   2d
                        |    |    |    |
                        └────┼────┘────┘
                             |
                             v
Wave 3 (sequential)     3a → 3b → 3c → 3d
                                        |
                                        v
Wave 4 (parallel)       4a, 4b, 4c, 4d, 4e, 4f
```

---

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `deliverViaEpicMerge` removal breaks users mid-epic with local-only commits | **High** | `ensureEpicBranch` detects local branch with unpushed commits, refuses to overwrite, prints migration instructions. CHANGELOG includes migration guidance. |
| `parseProgressFile` breaks on new `parent:` suffix | **High** | Step 1b rewrites parser to use named-prefix matching instead of positional. Legacy entries (no `parent:`) parse correctly. Tested in 1c. |
| `buildPrBody` signature change breaks callers | Medium | Only one caller (`deliverViaPullRequest` in deliver.ts). Updated in 3a. New param has default (`undefined`) for backward compat. |
| Rework parent info missing (legacy progress entries) | Medium | 2d adds board re-fetch fallback. If board fails too, falls back to base branch with warning. |
| `Closes` → `Part of` accidentally affects standalone PRs | Low | `isEpicBranch` check gates the change. Tests verify both paths (1g). |
| Epic completion race (parallel sessions) | Low | `attemptPrCreation` handles `alreadyExists`. Second session logs `PUSHED`. |
| Epic PR creation failure during AFK | Medium | Step 3c logs prominent warning with manual instructions. Future: retry mechanism in preflight. |
| Single-child check requires extra board query | Low | One lightweight query per parented ticket. Cached by board module if same parent queried again. |

---

## What's Reused vs New

### Reused from existing codebase

| What | Where | How |
|---|---|---|
| `computeTargetBranch` | `branch.ts` | Already returns `epic/` and `milestone/` branches — no changes |
| `deliverViaPullRequest` | `deliver.ts` | Modified (new `parent` and `targetBranch` flow-through) but core logic unchanged |
| `attemptPrCreation` | `pr-creation.ts` | Used as-is for both child PRs and epic PR |
| `buildPrBody` | `pr-body.ts` | Modified (new `targetBranch` param) |
| `appendProgress` | `progress.ts` | Extended with optional `parent` param — backward compatible |
| `pushBranch`, `checkout`, `deleteBranch` | `git-ops.ts` | Used as-is |
| AFK runner stop detection | `afk.ts` | No changes — stop patterns work the same |

### Genuinely New

| What | Complexity |
|---|---|
| `remoteBranchExists` / `fetchRemoteRef` in git-ops | Small |
| `fetchChildrenStatus` in 3 board modules (returns `{ total, incomplete }`) | Medium × 3 |
| `ensureEpicBranch` in deliver.ts (with staleness check + migration guard) | **Large** |
| `deliverEpicToBase` in deliver.ts | Medium |
| `buildEpicPrBody` in pr-body.ts | Small |
| `isEpicBranch` helper in pr-body.ts | Trivial |
| `parent` field in progress entries + parser rewrite | Medium |
| Rework parent preservation + board re-fetch fallback | Medium |
| Single-child epic skip logic in once.ts | Small |
| Epic completion detection in once.ts | Medium |

---

## Estimated Test Count

| Area | New tests | Rewritten |
|---|---|---|
| progress.ts (parent field, parser rewrite) | ~6 | ~2 |
| git-ops.ts (remote branch functions) | ~5 | 0 |
| pr-body.ts (isEpicBranch, Part of, buildEpicPrBody, targetBranch param) | ~8 | ~2 |
| jira.ts (fetchChildrenStatus) | ~4 | 0 |
| github.ts (fetchChildrenStatus) | ~4 | 0 |
| linear.ts (fetchChildrenStatus) | ~4 | 0 |
| rework.ts (parent preservation + board fallback) | ~5 | ~1 |
| deliver.ts (ensureEpicBranch, deliverEpicToBase, parent flow-through) | ~8 | ~3 |
| once.ts (orchestrator: epic flow, single-child skip, completion, failure) | ~6 | ~2 |
| **Total** | **~50** | **~10** |

---

## De-risking Order

1. **Progress parser rewrite (1b) first** — this is the most subtle breaking change. If the parser breaks, rework detection, epic completion, and the logs command all fail silently. Thorough testing in 1c before anything else builds on it.
2. **`buildPrBody` signature change (1f) early** — validates that the one caller (deliver.ts) can accept the new param before Wave 3 rewrites it.
3. **Rework fix (2d) early in Wave 2** — the most consequential bug fix from the original review.
4. **Board queries (2a-2c) in parallel** — independent, tested against mocks.
5. **`ensureEpicBranch` (3a) before orchestrator (3c)** — the migration guard and staleness check must be solid before the orchestrator calls them.
6. **Orchestrator (3c) last in Wave 3** — depends on everything else.
7. **Docs (Wave 4) last** — written accurately after code is final.
