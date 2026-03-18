# Epic Branch Workflow — Execution Plan

## Overview

Replace the local squash-merge delivery path (`deliverViaEpicMerge`) with PR-based epic branches. ~12 files modified, ~3 deleted/replaced. 3 waves, targeting a single version bump.

**Prerequisite:** The design document (`epic-branch-workflow.md`) must be reviewed and approved. All 5 open questions are resolved.

---

## Wave Structure

### Wave 1 — Foundation (sequential, order matters)

These changes are the building blocks. Each step must compile before the next begins.

| Step | Files | Change | Complexity |
|---|---|---|---|
| **1a** | `src/types/remote.ts` | Add `EPIC_PR_CREATED`, `EPIC_COMPLETE` to `ProgressStatus` union type | Trivial |
| **1b** | `src/scripts/shared/progress/progress.ts` | Add optional `parent` param to `appendProgress`. Update `ProgressEntry` type to include `parent?`. Update `parseProgress` to read `parent:{KEY}` suffix from entries. | Small |
| **1c** | `src/scripts/shared/progress/progress.test.ts` | Tests for `parent` field in `appendProgress` and `parseProgress` — write with parent, read back, undefined when absent. | Small |
| **1d** | `src/scripts/shared/git-ops/git-ops.ts` | Add `remoteBranchExists(branch)` — runs `git ls-remote --heads origin {branch}`, returns boolean. Add `fetchRemoteRef(branch)` — runs `git fetch origin {branch}:{branch}` to set up local tracking. | Small |
| **1e** | `src/scripts/shared/git-ops/git-ops.test.ts` | Tests for `remoteBranchExists` and `fetchRemoteRef` (mock `execSync`). | Small |
| **1f** | `src/scripts/shared/pull-request/pr-body/pr-body.ts` | Add `isEpicBranch(targetBranch)` helper (checks `epic/` or `milestone/` prefix). Change `Closes {key}` to `Part of {key}` when `isEpicBranch` is true. Add `buildEpicPrBody(epicKey, epicTitle, childEntries)` function. | Medium |
| **1g** | `src/scripts/shared/pull-request/pr-body/pr-body.test.ts` | Tests for `isEpicBranch`, conditional `Part of` vs `Closes`, `buildEpicPrBody` output format. | Small |

### Wave 2 — Board Queries + Rework Fix (parallel, 4 agents)

These are independent of each other. All depend on Wave 1 completing.

| Agent | Files | Change | Complexity |
|---|---|---|---|
| **2a** | `src/scripts/board/jira/jira.ts`, `src/scripts/board/jira/jira.test.ts` | Add `fetchChildrenStatus(config, parentKey)` — JQL query `parent = {KEY} AND statusCategory != 'done'`, returns count of incomplete children. Tests with mocked HTTP. | Medium |
| **2b** | `src/scripts/board/github/github.ts`, `src/scripts/board/github/github.test.ts` | Add `fetchChildrenStatus(config, parentIssueNumber)` — GET `/issues?state=open`, filter body for `Parent: #{N}` reference, return count. Tests with mocked HTTP. | Medium |
| **2c** | `src/scripts/board/linear/linear.ts`, `src/scripts/board/linear/linear.test.ts` | Add `fetchChildrenStatus(config, parentUuid)` — GraphQL query for parent's children where `state.type` not in `["completed", "canceled"]`, return count. Tests with mocked GraphQL. | Medium |
| **2d** | `src/scripts/once/rework/rework.ts`, `src/scripts/once/rework/rework.test.ts` | Read `parent` field from progress entry. Pass through to `FetchedTicket.parentInfo`. Update existing tests + add tests for parent preservation. | Small |

### Wave 3 — Orchestrator Rewrite (sequential, critical path)

This is the core change. Depends on Waves 1 and 2.

| Step | Files | Change | Complexity |
|---|---|---|---|
| **3a** | `src/scripts/once/deliver/deliver.ts` | Delete `deliverViaEpicMerge` entirely. Add `ensureEpicBranch(targetBranch, baseBranch)` — checks remote, creates from `origin/{baseBranch}` if missing, fetches if exists. Add `deliverEpicToBase(config, ticket, epicBranch, baseBranch, startTime)` — creates the final epic PR when all children are done. | **Large** |
| **3b** | `src/scripts/once/deliver/deliver.test.ts` | Tests for `ensureEpicBranch` (create, fetch, already exists). Tests for `deliverEpicToBase` (happy path, already exists guard). Tests confirming `deliverViaEpicMerge` is gone (import should fail). | Medium |
| **3c** | `src/scripts/once/once.ts` | Rewrite delivery section (lines 315-363): <br> - All parented tickets use `deliverViaPullRequest` targeting epic branch <br> - After child delivery, call `fetchChildrenStatus` — if 0 incomplete, call `deliverEpicToBase` <br> - Single-child epic check: if child count is 1 and this is it, skip epic branch, deliver to base directly <br> - Pass `parent` to `appendProgress` calls <br> - Epic branch creation: call `ensureEpicBranch` before creating feature branch | **Large** |
| **3d** | `src/scripts/once/once.test.ts` | Update orchestrator integration tests: <br> - Mock `deliverViaPullRequest` for parented tickets (was `deliverViaEpicMerge`) <br> - Add test: epic complete → `deliverEpicToBase` called <br> - Add test: single child → skip epic branch <br> - Add test: parent info passed to `appendProgress` <br> - Remove any test referencing `deliverViaEpicMerge` | Medium |

### Wave 4 — Documentation + Verification

| Step | Files | Change |
|---|---|---|
| **4a** | `docs/design/strategist-visual-flows.md` | Add epic branch mention to approve-brief Step 12 summary output |
| **4b** | `docs/VISUAL-ARCHITECTURE.md` | Update diagram 7 (Delivery Paths) to show new epic branch flow |
| **4c** | `CHANGELOG.md`, `package.json`, `package-lock.json` | Version bump + changelog entry |
| **4d** | `README.md` | Update test badge count |
| **4e** | Run `npm test && npm run typecheck && npm run lint` | Full verification |

---

## Dependency Graph

```
Wave 1 (sequential)
  1a → 1b → 1c → 1d → 1e → 1f → 1g
                                  |
                                  v
Wave 2 (parallel)           ┌─────┼─────┐─────┐
                            v     v     v     v
                           2a    2b    2c    2d
                            |     |     |     |
                            └─────┼─────┘─────┘
                                  |
                                  v
Wave 3 (sequential)          3a → 3b → 3c → 3d
                                              |
                                              v
Wave 4 (parallel)            4a, 4b, 4c, 4d, 4e
```

---

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `deliverViaEpicMerge` removal breaks existing users mid-epic | High | CHANGELOG migration guidance. Progress.txt entries without `parent:` field treated as legacy (fall back to base branch). |
| Rework parent info not found in progress.txt (legacy entries) | Medium | If `parent` field missing, re-fetch ticket from board to get parent info. Fallback to base branch if board fetch also fails. |
| `Closes` → `Part of` change affects standalone PRs | Low | `isEpicBranch` check ensures `Closes` is still used for PRs targeting base branch. Tests verify both paths. |
| Epic completion race (parallel sessions) | Low | `attemptPrCreation` already handles `alreadyExists`. The second session logs `PUSHED` and moves on. |
| `ensureEpicBranch` creates from stale origin | Medium | Always `git fetch origin` before checking. If origin is unreachable, warn and stop (consistent with existing connectivity preflight). |

---

## What's Reused vs New

### Reused from existing codebase

| What | Where | How |
|---|---|---|
| `computeTargetBranch` | `branch.ts` | Already returns `epic/` and `milestone/` branches — no changes needed |
| `deliverViaPullRequest` | `deliver.ts` | Used as-is for child ticket delivery — just receives epic branch as target |
| `attemptPrCreation` | `pr-creation.ts` | Used as-is for both child PRs and the final epic PR |
| `buildPrBody` | `pr-body.ts` | Modified (not replaced) to conditionally use `Part of` |
| `appendProgress` | `progress.ts` | Extended with optional `parent` param — backward compatible |
| `pushBranch`, `checkout`, `deleteBranch` | `git-ops.ts` | Used as-is |
| AFK runner stop detection | `afk.ts` | No changes — stop patterns work the same |

### Genuinely New

| What | Complexity |
|---|---|
| `remoteBranchExists` / `fetchRemoteRef` in git-ops | Small |
| `fetchChildrenStatus` in 3 board modules | Medium (3 implementations) |
| `ensureEpicBranch` in deliver.ts | Medium |
| `deliverEpicToBase` in deliver.ts | Medium |
| `buildEpicPrBody` in pr-body.ts | Small |
| `isEpicBranch` helper in pr-body.ts | Trivial |
| `parent` field in progress entries | Small |
| Rework parent info preservation | Small |
| Single-child epic skip logic in once.ts | Small |
| Epic completion detection in once.ts | Medium |

---

## Estimated Test Count

| Area | New tests |
|---|---|
| progress.ts (parent field) | ~4 |
| git-ops.ts (remote branch functions) | ~4 |
| pr-body.ts (isEpicBranch, Part of, buildEpicPrBody) | ~6 |
| jira.ts (fetchChildrenStatus) | ~3 |
| github.ts (fetchChildrenStatus) | ~3 |
| linear.ts (fetchChildrenStatus) | ~3 |
| rework.ts (parent preservation) | ~3 |
| deliver.ts (ensureEpicBranch, deliverEpicToBase) | ~6 |
| once.ts (orchestrator integration) | ~4 |
| **Total** | **~36** |

---

## De-risking Order

1. **Wave 1 first** — validates TypeScript compiles with new types and progress format
2. **Rework fix (2d) early in Wave 2** — this is the most consequential bug fix
3. **Board queries (2a-2c) in parallel** — independent, can be tested against mocked APIs
4. **Orchestrator last (Wave 3)** — depends on everything else being solid
5. **Docs last (Wave 4)** — written accurately after code is final
