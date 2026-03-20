# Epic Branch Workflow — Design Decisions

Shipped in v0.5.12. This document preserves the key design decisions — the implementation lives in `src/scripts/once/deliver/deliver.ts` and `src/scripts/once/phases/`.

---

## Problem (v0.5.10)

Child tickets were squash-merged directly into the epic branch locally with no review. The epic branch accumulated commits locally and was never pushed — merging the complete feature required manual intervention.

## Solution

All tickets now create PRs. Child tickets target the epic branch; standalone tickets target the base branch. When all children are complete, Clancy auto-creates an epic PR targeting the base branch.

```
child ticket → PR targeting epic/{key}
  → reviewer reviews child PR
  → merge into epic branch
  → when all children done:
    → auto-create PR from epic/{key} → base branch
    → reviewer reviews complete feature
    → merge epic PR
```

## Key Decisions

1. **PR-based delivery for ALL tickets.** No more squash-merge path. Even single-child epics get a PR (with single-child skip optimisation — goes directly to base branch).

2. **Epic branches created lazily.** `ensureEpicBranch()` creates `epic/{key}` from the base branch on first child implementation, not during strategy/planning.

3. **Epic completion detected at run start, not after delivery.** The just-delivered child is still "In Review" (not "Done"), so checking immediately after delivery would always find incomplete children. Instead, phase 2 (epic-completion) checks on the next run when all child PRs may have been merged.

4. **`Epic: {key}` text convention** in child ticket descriptions for cross-platform epic completion detection. `fetchChildrenStatus` tries text search first, falls back to native parent/child API for pre-v0.6.0 children.

5. **Migration guard.** `deliver.ts` detects pre-v0.5.12 squash-merged work on the epic branch and warns rather than silently pushing on top of it.

6. **Single-child skip.** If an epic has exactly 1 child, skip the epic branch entirely — deliver directly to base branch via PR. No point in an intermediate branch for one ticket.

7. **GitHub auto-close.** The epic PR body includes `Closes #N` keywords for the parent and all child issues. Merging the epic PR to the default branch auto-closes everything. Jira/Linear use API transitions instead.
