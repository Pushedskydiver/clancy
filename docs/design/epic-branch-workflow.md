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

Rework mostly works as it does today, but with one critical fix: **the rework module must preserve the parent info** so that the target branch is computed correctly.

**Bug in current code:** `rework.ts:211-217` constructs a `FetchedTicket` with `parentInfo: 'none'` hardcoded. During rework, this causes `computeTargetBranch` to return the base branch (`main`) instead of the epic branch. The rework prompt would diff against `main` instead of the epic branch, giving Claude wrong context.

**Fix:** Store the parent key in progress.txt entries. The progress format gains an optional `parent:{KEY}` suffix:

```
YYYY-MM-DD HH:MM | PROJ-101 | Add login form | PR_CREATED | pr:42 | parent:PROJ-100
```

The rework module reads `parent:PROJ-100` from the progress entry and passes it through to `computeTargetBranch`, which correctly returns `epic/proj-100`.

```
Reviewer leaves feedback on PR #42 (feature/proj-101 → epic/proj-100)
       |
       v
  /clancy:run detects rework needed for PROJ-101
  Progress entry has parent:PROJ-100
       |
       v
  computeTargetBranch → epic/proj-100
  Fetch epic/proj-100 from remote (not local main)
  Fetch feature/proj-101 from remote
  Checkout feature/proj-101
       |
       v
  Build rework prompt with reviewer feedback
  diffAgainstBranch(epic/proj-100) ← correct context
  Invoke Claude → commits fixes
       |
       v
  Push to feature/proj-101
  PR #42 updates automatically
  Re-request review
```

### Phase 5: Epic Branch Staleness

The epic branch may fall behind the base branch as other work merges to main. Clancy warns but does **not** auto-rebase — open child PRs targeting the epic branch would be invalidated by a rebase.

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
Continue  How far behind?
            |
       +----+----+
       ≤10       >10
       commits   commits
       |         |
       v         v
     Warn:     Warn + confirm:
     "epic/     "epic/proj-100 is N commits
      proj-100   behind main. Rebase manually
      is N       before continuing."
      commits    [1] Continue anyway
      behind     [2] Abort
      main."     (stop if abort)
     Continue
```

**Why no auto-rebase?** Rebasing rewrites history on a shared branch. If child PRs are open targeting the epic branch, a rebase invalidates their merge base and can break CI or cause merge conflicts. The user should rebase manually when no child PRs are open, then force-push with `--force-with-lease`.

**Future enhancement:** An opt-in `CLANCY_EPIC_AUTO_REBASE=true` could be added for users who understand the implications. It should only rebase when there are no open child PRs targeting the epic branch (query the git host first).

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
| `src/scripts/once/deliver/deliver.ts` | Delete `deliverViaEpicMerge`. Add `parent` param to `deliverViaPullRequest` (flows through to `appendProgress`). Pass `targetBranch` to `buildPrBody`. Add `ensureEpicBranch` (with staleness check + migration guard for local unpushed branches). Add `deliverEpicToBase` for Phase 3. On `deliverEpicToBase` failure, log prominent warning with manual instructions. |
| `src/scripts/once/once.ts` | After delivery, check if epic is complete (Phase 3). Handle epic branch creation (Phase 1). Rework path must use parent info for correct target branch. Single-child skip: if `total === 1`, deliver directly to base. |
| `src/scripts/once/rework/rework.ts` | **Critical fix:** Read `parent:{KEY}` from progress.txt entry (currently hardcodes `parentInfo: 'none'`). Fallback: re-fetch ticket from board if `parent` field missing (legacy entries). Pass parent through to `computeTargetBranch` so rework targets the epic branch, not main. |
| `src/scripts/shared/git-ops/git-ops.ts` | Add `remoteBranchExists` (current `branchExists` only checks local refs). Add `fetchRemoteRef` for fetching the epic branch from origin before branching from it. |
| `src/scripts/shared/progress/progress.ts` | Add `EPIC_PR_CREATED`, `EPIC_COMPLETE` to `ProgressStatus`. Add optional `parent` field to progress entries. Update `appendProgress` to accept parent key. **Rewrite `parseProgressFile`** to use named-prefix matching (`pr:`, `parent:`) instead of positional segments — the current parser breaks when `parent:KEY` is appended after `pr:N`. |
| `src/scripts/shared/pull-request/pr-body/pr-body.ts` | Add `targetBranch` param to `buildPrBody`. When `isEpicBranch(targetBranch)` is true, emit `Part of {key}` instead of `Closes {key}` (prevents GitHub auto-close before epic reaches base). Add `buildEpicPrBody` for the final epic PR (lists all child PRs with links). |
| `src/types/remote.ts` | Add `EPIC_PR_CREATED`, `EPIC_COMPLETE` to `ProgressStatus` type. |
| `src/scripts/board/jira/jira.ts` | Add `fetchChildrenStatus(config, parentKey)` — returns `{ total: number; incomplete: number }`. JQL: `parent = {KEY}` for total, filtered by `statusCategory != 'done'` for incomplete. |
| `src/scripts/board/github/github.ts` | Add `fetchChildrenStatus(config, parentIssueNumber)` — returns `{ total: number; incomplete: number }`. GET `/issues?state=all`, filter body for `Parent: #{N}`. |
| `src/scripts/board/linear/linear.ts` | Add `fetchChildrenStatus(config, parentUuid)` — returns `{ total: number; incomplete: number }`. GraphQL: parent's children, count all and filter `state.type` not in `["completed", "canceled"]`. |
| `docs/design/strategist-visual-flows.md` | Add epic branch mention to approve-brief summary output (Step 12). |

### Files unaffected

| File | Why |
|---|---|
| `src/scripts/shared/prompt/prompt.ts` | Prompt doesn't change — Claude doesn't need to know about epic branches. |
| `src/scripts/shared/branch/branch.ts` | Already correct — `computeTargetBranch` returns `epic/` branches. |
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

  NOTE: The AFK runner stops on skip (afk.ts stop patterns
  include "skipped"). This means the loop halts and remaining
  children (204-206) won't be processed until the user
  re-runs /clancy:run.
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
  At delivery time, check child count on board:
    If only 1 child and it is this ticket → skip epic branch.
    Deliver directly to CLANCY_BASE_BRANCH via PR.
    (No epic branch created — the extra hop adds no value
     for a single change.)
```

### 8. Parallel `/clancy:run` sessions (different machines)

```
Two machines both working on children of epic PROJ-100.
       |
       v
  Child PRs: safe. Each machine creates independent feature
  branches and PRs targeting the epic branch. No conflict.

  Epic completion: race possible. Both detect "all done"
  simultaneously and try to create the epic PR.
    → First succeeds, second gets alreadyExists from
      pr-creation.ts:145 (already handled).

  Staleness: if machine A pushes to epic branch, machine B
  has a stale ref. B's push will fail (non-fast-forward) or
  B's --force-with-lease fails (expected, safe).
```

---

## Resolved Design Decisions

| Question | Decision | Reasoning |
|---|---|---|
| Auto-rebase epic branch? | **Warn only, no auto-rebase.** Future opt-in via `CLANCY_EPIC_AUTO_REBASE`. | Rebasing invalidates open child PRs targeting the epic branch. Too dangerous for default behaviour. |
| Auto-create epic PR or explicit command? | **Automatic** when all children are done. | Explicit command breaks the AFK loop. Auto-detection keeps autonomous operation intact. |
| Skip epic branch for single child? | **Yes, skip.** Deliver directly to base branch. | Extra PR hop adds review latency with no benefit for a single change. Check child count on board at delivery time. |
| Reuse `CLANCY_STATUS_REVIEW` or new status? | **Reuse `CLANCY_STATUS_REVIEW`.** | Epic PRs are functionally identical to regular PRs. Adding a new config option provides no practical benefit. |
| Epic PR body format? | **List child PRs with links** + epic description from board. | Reviewer needs traceability to individual child reviews. Progress.txt `pr:N` entries provide the child PR numbers. |

---

## Review Findings (addressed in this document)

Issues caught by architecture review agent and incorporated above:

1. **Rework loses parent info** — `rework.ts:215` hardcodes `parentInfo: 'none'`. Fixed: store `parent:{KEY}` in progress.txt entries (Phase 4).
2. **GitHub `Closes` auto-close** — child PRs merged into epic branch would prematurely close GitHub issues. Fixed: use `Part of` instead of `Closes` when PR targets an epic branch (impact table).
3. **`ensureBranch` uses local refs** — epic branch would be created from stale local main. Fixed: Phase 1 specifies `git fetch origin` before creation + `remoteBranchExists` check.
4. **Board modules missing from impact** — "all children done" queries need new functions. Fixed: added `fetchChildrenStatus` to all 3 board modules in impact table.
5. **`branchExists` already exists** — what's actually needed is remote branch checking. Fixed: impact table now lists `remoteBranchExists` instead.

---

## Migration

This is a breaking change to the delivery flow. Existing users with in-flight epic work may have locally merged children. The migration path:

1. Any children already squash-merged locally are committed to the epic branch (or base branch if no epic branch exists).
2. New children follow the PR flow.
3. No action needed for standalone tickets (no parent) — their flow is unchanged.

The version introducing this should clearly document the change in the CHANGELOG with migration guidance.
