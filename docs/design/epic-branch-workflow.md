# Epic Branch Workflow — Design Document

## Problem

The current delivery flow squash-merges child tickets directly into an epic branch locally but never pushes the epic branch or creates a PR for it. The epic branch accumulates commits locally with no review, and merging the complete feature to the base branch requires manual intervention.

**Current behaviour (v0.5.10):**

```
child ticket (feature/proj-101)
  → squash merge into epic/proj-100 (local only)
  → delete feature branch
  → transition ticket to Done
  → epic branch sits locally, never pushed, no PR
```

**Desired behaviour:**

```
child ticket (feature/proj-101)
  → push feature branch
  → create PR targeting epic/proj-100
  → reviewer reviews the child PR
  → merge child PR into epic/proj-100
  → when all children are done:
    → create PR from epic/proj-100 targeting CLANCY_BASE_BRANCH
    → reviewer reviews the complete feature
    → merge epic PR
```

## Goals

- Every code change gets reviewed via PR before reaching the base branch
- Incremental review on each child ticket (smaller, focused PRs)
- One clean PR for the complete feature when all children are done
- The base branch only receives complete, reviewed features

## Non-Goals

- Automatic merging of child PRs (reviewer does this)
- Automatic merging of the epic PR (reviewer does this)
- Supporting nested epics (epic → sub-epic → child). One level only.

---

## Detailed Flow

### Phase 1: Epic Branch Creation

The epic branch is created lazily — on the first child ticket implementation, not during `/clancy:approve-brief`.

```
/clancy:once picks up child ticket PROJ-101 (parent: PROJ-100)
       |
       v
  computeTargetBranch("jira", "main", "PROJ-100")
  → target = "epic/proj-100"
       |
       v
  Does epic/proj-100 exist locally or on remote?
       |
  +----+----+
  Yes       No
  |         |
  v         v
Fetch     Create from CLANCY_BASE_BRANCH:
latest      git checkout -b epic/proj-100 origin/main
            git push -u origin epic/proj-100
       |
       v
  Create feature branch from epic branch:
    git checkout -b feature/proj-101 epic/proj-100
       |
       v
  (continue to Claude invocation)
```

**Why lazy creation?** The strategist creates tickets but doesn't touch git. The epic branch should only exist when implementation starts — this avoids stale branches from briefs that are never implemented.

### Phase 2: Child Ticket Delivery (replaces `deliverViaEpicMerge`)

Every child ticket with a parent now follows the PR flow, targeting the epic branch instead of the base branch.

```
Claude finishes implementing PROJ-101
       |
       v
  Has parent? YES → target = epic/proj-100
       |
       v
  Push feature branch:
    git push -u origin feature/proj-101
       |
       v
  Create PR:
    title: "feat(PROJ-101): Add login form"
    base: epic/proj-100    ← NOT main
    head: feature/proj-101
       |
       v
  Transition ticket → Review
  Log: PR_CREATED | pr:42
       |
       v
  (rework loop works as normal — PR targets epic branch)
```

**Key change:** `deliverViaEpicMerge` is replaced entirely. All tickets — with or without a parent — go through `deliverViaPullRequest`. The only difference is the target branch:

| Scenario | Target branch |
|---|---|
| Child ticket (has parent) | `epic/{parent-key}` or `milestone/{slug}` |
| Standalone ticket (no parent) | `CLANCY_BASE_BRANCH` (default: `main`) |
| Rework (any) | Same branch as original PR |

### Phase 3: Epic Completion Detection

When Clancy picks up a child ticket and finds no more work to do under the parent, it checks if the epic is complete.

```
/clancy:once or /clancy:run
       |
       v
  Fetch next ticket from implementation queue
       |
       v
  No tickets found for this epic?
       |
       v
  Check: are ALL children of the parent done on the board?
       |
  +----+----+
  No        Yes
  |         |
  v         v
Continue   EPIC COMPLETE
(other       |
tickets)     v
           Create PR:
             title: "feat(PROJ-100): {epic title}"
             base: CLANCY_BASE_BRANCH
             head: epic/proj-100
             body: summary of all child tickets
               |
               v
           Transition epic → Review (if applicable)
           Log: EPIC_PR_CREATED | pr:99
```

#### Board-Specific "All Children Done" Checks

```
Jira:
  POST /rest/api/3/search/jql
  Body: {
    "jql": "parent = PROJ-100 AND statusCategory != 'done'",
    "maxResults": 1
  }
  If issues.length === 0 → all done

GitHub:
  GET /repos/{owner}/{repo}/issues?state=open
  Filter: body contains "Parent: #100"
  If results.length === 0 → all done

Linear:
  query {
    issue(id: "<parent-uuid>") {
      children {
        nodes {
          state { type }
        }
      }
    }
  }
  If all children have state.type in ["completed", "canceled"] → all done
```

### Phase 4: Rework on Child PRs

Rework works exactly as it does today. The PR targets the epic branch, so rework pushes to the feature branch and the PR updates automatically.

```
Reviewer leaves feedback on PR #42 (feature/proj-101 → epic/proj-100)
       |
       v
  /clancy:run detects rework needed for PROJ-101
       |
       v
  Fetch feature/proj-101 from remote
  Checkout feature/proj-101
       |
       v
  Build rework prompt with reviewer feedback
  Invoke Claude → commits fixes
       |
       v
  Push to feature/proj-101
  PR #42 updates automatically
  Re-request review
```

### Phase 5: Epic Branch Staleness

The epic branch may fall behind the base branch as other work merges to main. Clancy should handle this.

```
Before creating a new child feature branch:
       |
       v
  git fetch origin
  Is epic/proj-100 behind origin/CLANCY_BASE_BRANCH?
       |
  +----+----+
  No        Yes
  |         |
  v         v
Continue  Attempt rebase:
            git checkout epic/proj-100
            git rebase origin/main
                 |
            +----+----+
            Clean     Conflicts
            |         |
            v         v
          Push      Warn:
          force-     "Epic branch has conflicts
          with-lease  with base. Resolve manually
          epic branch before continuing."
                     (stop)
```

**Why rebase, not merge?** The epic branch should have a clean linear history of child tickets. Merge commits add noise and make the final epic PR harder to review.

**Why force-with-lease?** The rebase rewrites history on the epic branch. `--force-with-lease` is safe because it fails if someone else has pushed to the epic branch since we last fetched.

---

## New Progress Statuses

| Status | Meaning |
|---|---|
| `EPIC_PR_CREATED` | Epic branch PR created targeting base branch |
| `EPIC_COMPLETE` | All children done, epic PR merged |

Existing statuses remain unchanged — `PR_CREATED`, `REWORK`, `DONE` etc. all work as before, they just target the epic branch instead of the base branch for parented tickets.

---

## Impact on Existing Code

### Files to modify

| File | Change |
|---|---|
| `src/scripts/once/deliver/deliver.ts` | Replace `deliverViaEpicMerge` with epic-branch-aware `deliverViaPullRequest`. Add `deliverEpicToBase` function for Phase 3. |
| `src/scripts/once/once.ts` | After delivery, check if epic is complete (Phase 3). Handle epic branch creation (Phase 1). |
| `src/scripts/shared/branch/branch.ts` | Already correct — `computeTargetBranch` returns `epic/` branches. No changes needed. |
| `src/scripts/shared/git-ops/git-ops.ts` | Add `rebaseOnto`, `branchExists`, `pushForceWithLease` functions. |
| `src/scripts/shared/progress/progress.ts` | Add `EPIC_PR_CREATED`, `EPIC_COMPLETE` to `ProgressStatus`. |
| `src/types/remote.ts` | Add `EPIC_PR_CREATED`, `EPIC_COMPLETE` to `ProgressStatus` type. |
| `src/scripts/shared/pull-request/pr-body/pr-body.ts` | Add `buildEpicPrBody` for the final epic PR (lists all child tickets). |

### Files unaffected

| File | Why |
|---|---|
| `src/scripts/shared/prompt/prompt.ts` | Prompt doesn't change — Claude doesn't need to know about epic branches. |
| `src/scripts/board/*/` | Board queries unchanged — ticket fetch and transitions work the same. |
| `src/scripts/once/rework/rework.ts` | Rework detection unchanged — still scans progress.txt for `PR_CREATED`. |
| `src/scripts/once/pr-creation/pr-creation.ts` | PR creation unchanged — just receives a different target branch. |

### What gets removed

`deliverViaEpicMerge` is deleted entirely. All delivery goes through `deliverViaPullRequest` with the appropriate target branch. This simplifies the delivery logic — one path instead of two.

---

## Impact on Strategist (v0.6.0)

`/clancy:approve-brief` creates child tickets on the board but does NOT create the epic branch. The branch is created lazily by the implementer on first child pickup.

The approve-brief summary should mention the expected epic branch:

```
6 tickets created under PROJ-200:
  PROJ-201 — Portal route + dashboard shell [AFK]
  PROJ-202 — SSO login flow [HITL]
  ...

Epic branch: epic/proj-200 (created on first implementation)
Next: /clancy:plan
```

---

## Edge Cases

### 1. Epic has no children (standalone epic ticket)

```
Ticket has a parent field pointing to itself (rare) or is an epic
with no children created by the strategist.
       |
       v
  Treat as standalone — PR to base branch.
  (No epic branch created for a single ticket.)
```

### 2. Some children are HITL (human-required)

```
Epic has 6 children: 4 AFK, 2 HITL.
AFK children complete, HITL children still open.
       |
       v
  "All children done" check: NO (2 still open).
  No epic PR created yet.
  Human completes HITL tickets → all done → next /clancy:run triggers epic PR.
```

### 3. Child ticket is skipped (infeasible)

```
PROJ-203 is skipped as infeasible.
       |
       v
  Logged as SKIPPED.
  Does not count as "done" for epic completion.
  User must close/cancel the ticket on the board manually,
  or update it to be feasible and re-run.
```

### 4. Epic branch deleted by mistake

```
Someone deletes epic/proj-100 from remote.
       |
       v
  Next child pickup: branch doesn't exist on remote.
  Clancy re-creates it from CLANCY_BASE_BRANCH.
  WARN: "Epic branch was missing — recreated. Previously
         merged children will need to be cherry-picked
         or re-implemented."
```

### 5. Multiple epics in parallel

```
Two epics active: PROJ-100 and PROJ-200.
       |
       v
  Each gets its own epic branch:
    epic/proj-100
    epic/proj-200
  Children branch off their respective epic branch.
  /clancy:run processes tickets from both epics
  based on queue priority. No conflict.
```

### 6. Rework on epic PR (the final PR to base branch)

```
Reviewer requests changes on the epic PR itself
(not a child PR).
       |
       v
  This is NOT handled by Clancy automatically.
  The reviewer's feedback is on the assembled feature,
  not a specific ticket. The user should:
    1. Create a new ticket for the fix
    2. Implement it as a child of the epic
    3. Merge the fix into the epic branch
    4. Re-request review on the epic PR
  OR fix it manually on the epic branch.
```

### 7. Epic with only one child

```
Strategist decomposes idea into 1 ticket (unlikely but possible).
       |
       v
  Still creates epic branch for consistency.
  After child completes → epic complete → epic PR to base.
  The extra PR hop adds review but is worth it for consistency.
  (Alternative: if decomposition produces only 1 ticket,
   skip epic branch and deliver directly. TBD.)
```

---

## Open Questions

- [ ] Should Clancy auto-rebase the epic branch, or just warn and let the user handle it? Auto-rebase with `--force-with-lease` is safe but may surprise users.
- [ ] Should the epic PR be created automatically, or should there be an explicit command like `/clancy:deliver-epic PROJ-100`? Automatic is simpler but less control.
- [ ] For edge case 7 (single child), should we skip the epic branch? Simpler flow, but inconsistent.
- [ ] Should `CLANCY_STATUS_REVIEW` be used for the epic PR transition, or a new `CLANCY_STATUS_EPIC_REVIEW`?
- [ ] How should the epic PR body look? Should it list all child PRs with links, or just summarise the changes?

---

## Migration

This is a breaking change to the delivery flow. Existing users with in-flight epic work may have locally merged children. The migration path:

1. Any children already squash-merged locally are committed to the epic branch (or base branch if no epic branch exists).
2. New children follow the PR flow.
3. No action needed for standalone tickets (no parent) — their flow is unchanged.

The version introducing this should clearly document the change in the CHANGELOG with migration guidance.
