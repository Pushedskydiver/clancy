# Planner Role — Execution Plan

## Overview

~20 files modified, 0 new files (all changes are to existing files). 3 waves, 7 agents. The planner is a **pure markdown workflow** — no runtime TypeScript. All changes are to existing command/workflow markdown files, env schemas, documentation, and integration points.

---

## Bug Fixes (from current-state audit)

### Bug 1: Approve does NOT transition ticket status or swap labels

**Problem:** `docs/roles/PLANNER.md` claims `/clancy:approve` moves tickets and swaps labels, but the workflow (`src/roles/planner/workflows/approve.md`) only appends the plan and tells the user to move manually.

**Fix:** Add Step 6 to `approve-plan.md` workflow implementing post-approval transitions:
- **Jira:** If `CLANCY_STATUS_PLANNED` is set, fetch transitions and POST transition. If not set, skip (manual).
- **GitHub:** Remove `CLANCY_PLAN_LABEL`, add `CLANCY_LABEL`. Create label if missing.
- **Linear:** Resolve "unstarted" state UUID via `workflowStates` query, then `issueUpdate` with `stateId`.
- All transitions are best-effort (warn on failure, continue).
- Update `docs/roles/PLANNER.md` to accurately describe the new behaviour.

**Files:** `src/roles/planner/workflows/approve.md` (renamed to `approve-plan.md`), `docs/roles/PLANNER.md`

### Bug 2: Linear .env.example missing CLANCY_PLAN_STATE_TYPE

**Problem:** Jira and GitHub `.env.example` templates include their planner queue vars, but Linear's does not include `CLANCY_PLAN_STATE_TYPE`.

**Fix:** Add to the Linear `.env.example` template in `src/roles/setup/workflows/scaffold.md`:
```
# ─── Planner Queue (optional — requires CLANCY_ROLES to include "planner") ───
# State type for backlog issues that /clancy:plan fetches from (default: backlog)
# Valid values: backlog, unstarted, started, completed, canceled, triage
# CLANCY_PLAN_STATE_TYPE="backlog"
```

**Files:** `src/roles/setup/workflows/scaffold.md`

### Bug 3: No init Step 4d equivalent for GitHub or Linear

**Problem:** During init, only Jira users get a planning queue configuration step. GitHub and Linear users get defaults only.

**Fix:** Add Step 4d variants for GitHub and Linear in `src/roles/setup/workflows/init.md`:
- **GitHub (if Planner selected):**
  ```
  Which GitHub label should Clancy pick planning issues from?

  [1] needs-refinement (default)
  [2] Enter a different label name
  ```
  Stores as `CLANCY_PLAN_LABEL`.
- **Linear (if Planner selected):**
  ```
  Which Linear state type should Clancy pick planning issues from?

  [1] backlog (default)
  [2] triage
  [3] Enter a different value
  ```
  Stores as `CLANCY_PLAN_STATE_TYPE`.

**Files:** `src/roles/setup/workflows/init.md`

### Bug 4: No validation of CLANCY_PLAN_STATE_TYPE values

**Problem:** Zod schema accepts any string for `CLANCY_PLAN_STATE_TYPE`, but Linear state types are an enum.

**Fix:** Update `src/schemas/env.ts` (or `src/scripts/shared/env-schema/env-schema.ts` — whichever holds the runtime schema) to validate:
```typescript
CLANCY_PLAN_STATE_TYPE: z.optional(
  z.enum(["backlog", "unstarted", "started", "completed", "canceled", "triage"])
),
```

**Files:** `src/schemas/env.ts`

### Bug 5: GitHub planning uses CLANCY_PLAN_LABEL, not CLANCY_LABEL (documentation clarity)

**Problem:** Two separate label systems could confuse users. Not a code bug, but a documentation gap.

**Fix:** No code change. The plan workflow already includes guidance in the "no tickets found" message. Ensure `docs/roles/PLANNER.md` and `docs/guides/CONFIGURATION.md` explicitly call out the two-label system with a clear table. Already addressed by the full PLANNER.md rewrite in Bug 1.

**Files:** `docs/roles/PLANNER.md`, `docs/guides/CONFIGURATION.md`

### Bug 6: Linear approve uses issueSearch (fuzzy)

**Problem:** `issueSearch` is fuzzy text search. Could theoretically return no results or wrong results.

**Fix:** Update `approve-plan.md` workflow to use the filter-based `issues` query with `identifier: { eq }` filter instead of `issueSearch`:
```graphql
query { issues(filter: { identifier: { eq: "$KEY" } }) { nodes { ... } } }
```
Keep `issueSearch` as documented fallback only if the filter-based query is unavailable.

**Files:** `src/roles/planner/workflows/approve.md` (renamed to `approve-plan.md`)

### Bug 7: Plan template in PLANNER.md docs differs from workflow

**Problem:** Docs describe sections in different order and names than the actual workflow template.

**Fix:** Update `docs/roles/PLANNER.md` to match the new canonical template:
Summary, Affected Files, Implementation Approach, Test Strategy, Acceptance Criteria, Dependencies, Figma Link, Risks/Considerations, Size Estimate.

**Files:** `docs/roles/PLANNER.md`

### Bug 8: No batch mode for approve

**Problem:** `/clancy:approve` only accepts a single ticket key.

**Fix:** Keep single-ticket approval (design decision). The auto-select feature (no args) addresses the UX pain: users don't need to remember keys. For batch approval, users run the command multiple times. No code change — this is by design.

**Files:** None (no change)

### Bug 9: Jira comment field included in planning query but not in approve fetch

**Problem:** Inconsistent approach — plan workflow includes comments inline, approve makes a separate call.

**Fix:** No change needed. The approve workflow fetches a single ticket's comments, not a batch. The separate call is fine for single-ticket operations and avoids over-fetching fields not needed by approve. Document this as intentional.

**Files:** None (no change)

### Bug 10: No CLANCY_LABEL filter for Linear planning queue

**Problem:** Jira planning query includes `CLANCY_LABEL` as additional filter, but Linear has no equivalent.

**Fix:** No change. Linear's GraphQL filter does not support label-based filtering in the same way. The team + state type + assignee filter is sufficient. Document this as a known platform difference.

**Files:** None (no change)

---

## New Features

### Feature 1: Auto-detect feedback (replace --force)

**What:** Running `/clancy:plan` on an already-planned ticket auto-detects feedback comments (posted after the plan). If feedback exists, revise. If no feedback, tell user to add some. `--fresh` flag starts from scratch. Remove `--force` flag entirely.

**Changes:**

| File | Change |
|---|---|
| `src/roles/planner/commands/plan.md` | Replace `--force` with `--fresh` in argument docs. Add specific ticket key argument support (`PROJ-123`, `#42`, `ENG-42`). |
| `src/roles/planner/workflows/plan.md` | Step 2: replace `--force` parsing with `--fresh` + ticket key parsing. Step 3b: change from "skip unless --force" to auto-detect logic: has plan + feedback -> revise, has plan + no feedback -> stop with message, --fresh -> discard and start over. Remove Step 3c as separate step — merge into 3b. |
| `docs/roles/PLANNER.md` | Update command table and workflow description. Remove `--force`, add `--fresh` and ticket key targeting. |
| `src/roles/setup/commands/help.md` | Update help text: remove `--force`, add `--fresh` and ticket key examples. |

### Feature 2: --fresh flag

**What:** `/clancy:plan --fresh` or `/clancy:plan --fresh PROJ-123` discards any existing plan and starts from scratch, ignoring feedback.

**Changes:** Covered by Feature 1 file list. `--fresh` replaces `--force` in the same argument slot. Parsing logic changes from "look for --force" to "look for --fresh".

### Feature 3: Specific ticket targeting

**What:** `/clancy:plan PROJ-123` plans a specific ticket instead of pulling from the queue. Format validated per board.

**Changes:** Covered by Feature 1. The workflow needs a new branch in Step 3: if ticket key provided, fetch that specific ticket instead of the queue.

### Feature 4: /clancy:approve -> /clancy:approve-plan rename

**What:** Rename command for v0.6.0 consistency with `/clancy:approve-brief` (strategist).

**Changes:**

| File | Change |
|---|---|
| `src/roles/planner/commands/approve.md` | Rename to `approve-plan.md` |
| `src/roles/planner/workflows/approve.md` | Rename to `approve-plan.md` |
| `src/roles/planner/commands/plan.md` | Update footer reference from `/clancy:approve` to `/clancy:approve-plan` |
| `src/roles/planner/workflows/plan.md` | Update all references to `/clancy:approve` -> `/clancy:approve-plan` |
| `src/roles/setup/commands/help.md` | Rename entry from `/clancy:approve` to `/clancy:approve-plan` |
| `src/roles/setup/workflows/init.md` | Update any references |
| `src/roles/setup/workflows/settings.md` | Update any references |
| `docs/roles/PLANNER.md` | Update all references |
| `README.md` | Update command table |
| `CLAUDE.md` | Update if referenced |
| `src/templates/CLAUDE.md` | Update if referenced |

**Overlap with strategist v0.6.0:** This rename is already in the strategist execution plan (Wave 1, Agent 2). **Do not duplicate.** The strategist agent handles the rename. Planner agents should reference the new name but not perform the rename themselves. Coordinate: planner agents run AFTER strategist Wave 1 Agent 2 completes the rename.

### Feature 5: Skip comments on board

**What:** When Clancy skips a ticket (irrelevant/infeasible), post a brief comment on the board explaining why. Opt-out via `CLANCY_SKIP_COMMENTS=false`.

**Changes:**

| File | Change |
|---|---|
| `src/roles/planner/workflows/plan.md` | Step 4a: after feasibility fail, post skip comment via the same comment API used for plan comments. Check `CLANCY_SKIP_COMMENTS` env var (default: true). Best-effort (warn on failure). |
| `src/schemas/env.ts` | Add `CLANCY_SKIP_COMMENTS: z.optional(z.string())` to shared schema |
| `src/roles/setup/workflows/scaffold.md` | Add `CLANCY_SKIP_COMMENTS` to all `.env.example` templates (commented out) |
| `docs/guides/CONFIGURATION.md` | Document `CLANCY_SKIP_COMMENTS` |

### Feature 6: Post-approval transition (CLANCY_STATUS_PLANNED)

**What:** After approving, automatically transition the ticket to the implementation queue.

**Changes:**

| File | Change |
|---|---|
| `src/roles/planner/workflows/approve.md` | Add Step 6 (post-approval transition). Jira: if `CLANCY_STATUS_PLANNED` set, fetch transitions and POST. GitHub: label swap (always). Linear: move to unstarted (always). |
| `src/schemas/env.ts` | Add `CLANCY_STATUS_PLANNED: z.optional(z.string())` to shared schema (Jira-specific but defined in shared for simplicity) |
| `src/roles/setup/workflows/init.md` | Add Step 4e: ask for `CLANCY_STATUS_PLANNED` during init (Jira only, if Planner enabled) |
| `src/roles/setup/workflows/settings.md` | Add [P2] option for configuring `CLANCY_STATUS_PLANNED` (Jira only) |
| `src/roles/setup/workflows/scaffold.md` | Add `CLANCY_STATUS_PLANNED` to Jira `.env.example` (commented out) |
| `docs/guides/CONFIGURATION.md` | Document `CLANCY_STATUS_PLANNED` |
| `docs/roles/PLANNER.md` | Update approve section to describe automatic transitions |

### Feature 7: Edit plan comment after approval

**What:** After promoting the plan to the description, edit the plan comment to prepend a "Plan approved" note. Don't delete it.

**Changes:**

| File | Change |
|---|---|
| `src/roles/planner/workflows/approve.md` | Add Step 5b: edit the plan comment via platform-specific edit API. Prepend "✅ Plan approved and promoted to description on {date}." Best-effort. |

### Feature 8: Auto-select oldest unapproved ticket for approve-plan

**What:** `/clancy:approve-plan` (no args) auto-selects the oldest planned-but-unapproved ticket from `progress.txt` and shows confirmation.

**Changes:**

| File | Change |
|---|---|
| `src/roles/planner/workflows/approve.md` | Step 2: if no argument, scan `progress.txt` for PLAN entries without subsequent APPROVE for same key. Sort by timestamp ascending. Auto-select oldest. Show: "Auto-selected [{KEY}] {Title}. Promote? [Y/n]". Support ticket key as arg. Remove "Usage: /clancy:approve PROJ-123" stop. |
| `src/roles/planner/commands/approve.md` | Update argument docs: key is now optional. |
| `docs/roles/PLANNER.md` | Update approve docs to show both invocations. |

### Feature 9: Branch freshness check in preflight

**What:** Before planning, check if the branch is behind the remote base branch.

**Changes:**

| File | Change |
|---|---|
| `src/roles/planner/workflows/plan.md` | Add Step 1e after credential check: `git fetch origin`, compare HEAD with `origin/$CLANCY_BASE_BRANCH` (or `origin/main`). If behind: offer pull/continue/abort. |

**Overlap with strategist v0.6.0:** The strategist execution plan includes branch freshness in its brief workflow natively and adds it to the implementer's `once.md`. The planner's branch freshness check follows the same pattern. If the strategist wave adds a shared preflight step, the planner can reference it. If not, the planner workflow includes the git commands inline (same as once.md pattern).

### Feature 10: Relevance check with skip comment

**What:** Before planning, check if the ticket is relevant to the codebase. If not, skip with a comment explaining why.

**Changes:** Covered by Feature 5 (skip comments). The feasibility check already exists in Step 4a. The enhancement is:
1. Also check against `.clancy/docs/STACK.md` — if ticket mentions technology not in the stack, flag as potentially irrelevant (but still benefit of the doubt).
2. Post skip comment on the board (Feature 5).
3. Log as SKIPPED in `progress.txt`.

| File | Change |
|---|---|
| `src/roles/planner/workflows/plan.md` | Step 4a: expand feasibility scan to also read STACK.md and cross-reference. Add skip comment posting. Add SKIPPED log entry format. |

### Feature 11: Updated plan template sections

**What:** Plan template updated to include: Summary, Affected Files, Implementation Approach, Test Strategy, Acceptance Criteria, Dependencies, Figma Link, Risks/Considerations.

**Changes:**

| File | Change |
|---|---|
| `src/roles/planner/workflows/plan.md` | Step 4f: update template to new section order and names. Add "Figma Link" section. Rename "Technical Approach" to "Implementation Approach". Rename "Edge Cases" to "Risks / Considerations". |
| `docs/roles/PLANNER.md` | Update plan template description to match. |

---

## Wave Structure

### Wave 1 — Core Workflow Changes (3 parallel agents)

| Agent | Chunks | Files | Complexity |
|---|---|---|---|
| **1** | Schema + env vars | `src/schemas/env.ts` | Small |
| **2** | Plan workflow rewrite | `src/roles/planner/commands/plan.md`, `src/roles/planner/workflows/plan.md` | **Large** |
| **3** | Approve workflow rewrite + rename | `src/roles/planner/commands/approve.md` -> `approve-plan.md`, `src/roles/planner/workflows/approve.md` -> `approve-plan.md` | **Large** |

**Agent 1 — Schema + env vars**

Changes to `src/schemas/env.ts`:
- Add `CLANCY_STATUS_PLANNED: z.optional(z.string())` to shared schema
- Add `CLANCY_SKIP_COMMENTS: z.optional(z.string())` to shared schema
- Change `CLANCY_PLAN_STATE_TYPE` from `z.optional(z.string())` to `z.optional(z.enum(["backlog", "unstarted", "started", "completed", "canceled", "triage"]))`

**Agent 2 — Plan workflow rewrite**

Changes to `src/roles/planner/commands/plan.md`:
- Replace `--force` with `--fresh` in argument description
- Add specific ticket key argument (`PROJ-123`, `#42`, `ENG-42`)
- Update examples

Changes to `src/roles/planner/workflows/plan.md`:
- Step 1: add Step 1e branch freshness check (git fetch, compare, offer pull/continue/abort)
- Step 2: rewrite argument parsing — support `--fresh`, ticket key, and numeric batch. Remove `--force`.
- Step 3: add branch for specific ticket fetch (single ticket by key vs queue fetch)
- Step 3b: rewrite existing plan detection — auto-detect feedback (not --force). Has plan + feedback -> revise. Has plan + no feedback -> stop with message. --fresh -> discard and start over.
- Step 3c: merge into 3b (no longer a separate --force-only step)
- Step 4a: expand feasibility check — also read STACK.md. Add skip comment posting (check CLANCY_SKIP_COMMENTS). Add SKIPPED log format.
- Step 4f: update plan template — new section order (Summary, Affected Files, Implementation Approach, Test Strategy, Acceptance Criteria, Dependencies, Figma Link, Risks/Considerations). Update footer to reference `/clancy:approve-plan`.
- Step 6: add SKIPPED and REVISED log entry variants
- Step 7: update summary to reference `/clancy:approve-plan`

**Agent 3 — Approve workflow rewrite + rename**

Rename files:
- `src/roles/planner/commands/approve.md` -> `src/roles/planner/commands/approve-plan.md`
- `src/roles/planner/workflows/approve.md` -> `src/roles/planner/workflows/approve-plan.md`

Changes to `approve-plan.md` command:
- Update command name to `/clancy:approve-plan`
- Make ticket key optional (auto-select when omitted)
- Reference renamed workflow

Changes to `approve-plan.md` workflow:
- Step 2: rewrite — if no arg, scan progress.txt for oldest PLAN without APPROVE. Show confirmation: "Auto-selected [{KEY}] {Title}. Promote? [Y/n]". If arg provided, validate format per board.
- Step 3: change Linear fetch from `issueSearch` to `issues(filter: { identifier: { eq } })`. Keep issueSearch as documented fallback.
- Add Step 5b: edit plan comment — prepend approval note. Platform-specific edit APIs. Best-effort.
- Add Step 6: post-approval transition. Jira: if CLANCY_STATUS_PLANNED, fetch transitions and POST. GitHub: remove plan label, add impl label. Linear: resolve unstarted state UUID, issueUpdate. All best-effort.
- Step 7 (was 6): update display messages per platform (show transition result).
- Update all `/clancy:approve` references to `/clancy:approve-plan`

**Dependencies:** Agent 1 must complete before Agents 2 and 3 start (they reference new env vars). However, since these are markdown workflows that only reference env var names (not TypeScript imports), Agents 2 and 3 can safely run in parallel with Agent 1. The schema is referenced at runtime by the bundled scripts, not by the markdown.

**Overlap note:** The rename (Agent 3) is shared with the strategist execution plan (Wave 1, Agent 2). If the strategist is being implemented in the same PR/branch, coordinate: either the strategist agent does the rename and the planner agent assumes it's done, or the planner agent does it and the strategist agent references the result. Recommendation: planner Agent 3 owns the rename since it's rewriting the file anyway.

### Wave 2 — Integration (2 parallel agents)

| Agent | Chunks | Files |
|---|---|---|
| **4** | Setup integration (init, settings, scaffold, help) | `src/roles/setup/workflows/init.md`, `src/roles/setup/workflows/settings.md`, `src/roles/setup/workflows/scaffold.md`, `src/roles/setup/commands/help.md` |
| **5** | CLAUDE.md template + reviewer logs | `src/templates/CLAUDE.md`, `src/roles/reviewer/workflows/logs.md` |

**Agent 4 — Setup integration**

Changes to `src/roles/setup/workflows/init.md`:
- Add Step 4d for GitHub (CLANCY_PLAN_LABEL config) when Planner enabled
- Add Step 4d for Linear (CLANCY_PLAN_STATE_TYPE config) when Planner enabled
- Add Step 4e for Jira (CLANCY_STATUS_PLANNED config) when Planner enabled
- Existing Jira Step 4d stays, expanded with validation note

Changes to `src/roles/setup/workflows/settings.md`:
- Update [R1] planner role toggle — reference `/clancy:approve-plan` (not `/clancy:approve`)
- Add [P2] option for CLANCY_STATUS_PLANNED (Jira only, if Planner enabled):
  ```
  Post-approval transition status (Jira only):
  [1] None (manual transition, default)
  [2] Enter a status name (e.g. "To Do")
  ```
- Update [P1] references from `/clancy:approve` to `/clancy:approve-plan`

Changes to `src/roles/setup/workflows/scaffold.md`:
- Add `CLANCY_PLAN_STATE_TYPE` to Linear `.env.example` template
- Add `CLANCY_STATUS_PLANNED` to Jira `.env.example` template
- Add `CLANCY_SKIP_COMMENTS` to all `.env.example` templates (commented out)

Changes to `src/roles/setup/commands/help.md`:
- Rename `/clancy:approve` to `/clancy:approve-plan` in command table
- Update `/clancy:plan --force` to `/clancy:plan --fresh`
- Add `/clancy:plan PROJ-123` example
- Update descriptions

**Agent 5 — Template + logs**

Changes to `src/templates/CLAUDE.md`:
- Update any `/clancy:approve` references to `/clancy:approve-plan`
- Update any `--force` references to `--fresh` for the planner

Changes to `src/roles/reviewer/workflows/logs.md`:
- Update log format parsing to handle new entries: SKIPPED, REVISED, POST_FAILED
- Update `/clancy:approve` references to `/clancy:approve-plan`

### Wave 3 — Documentation (2 parallel agents)

| Agent | Chunks | Files |
|---|---|---|
| **6** | Role docs + configuration guide | `docs/roles/PLANNER.md`, `docs/guides/CONFIGURATION.md` |
| **7** | README + project-level files | `README.md`, `CLAUDE.md` |

**Agent 6 — Role docs + config**

Changes to `docs/roles/PLANNER.md` (full rewrite):
- Update "Commands" table: remove `--force`, add `--fresh`, add ticket key targeting, rename `/clancy:approve` to `/clancy:approve-plan`
- Fix plan template section names and order (Bug 7)
- Fix approve description — document automatic transitions per platform (Bug 1)
- Document two-label system for GitHub clearly (Bug 5)
- Add "Re-plan (auto-detect)" section replacing "Re-plan (--force)"
- Update workflow diagram

Changes to `docs/guides/CONFIGURATION.md`:
- Add `CLANCY_STATUS_PLANNED` documentation
- Add `CLANCY_SKIP_COMMENTS` documentation
- Note CLANCY_PLAN_STATE_TYPE enum validation
- Clarify GitHub two-label system

**Agent 7 — README + project files**

Changes to `README.md`:
- Update command table: `/clancy:approve` -> `/clancy:approve-plan`
- Update `--force` -> `--fresh` if mentioned
- Update any planner examples

Changes to `CLAUDE.md`:
- Update command references if listed

### Wave 4 — Verification

Run `npm test && npm run typecheck && npm run lint`. Fix any issues.

Post-wave checks:
1. `grep -r "clancy:approve " src/ docs/` — ensure no stale `/clancy:approve ` references (with trailing space, to catch the old name but not `approve-plan` or `approve-brief`)
2. `grep -r "\-\-force" src/roles/planner/` — ensure no stale `--force` references
3. `grep -r "issueSearch" src/roles/planner/` — ensure approve workflow uses filter-based query
4. Verify all three `.env.example` templates in scaffold.md include their respective planner env vars

---

## Release Order

**The planner work ships first as v0.5.6, before the strategist (v0.6.0).**

This means:
- The planner PR **owns all its changes** — no dependencies on strategist work
- The rename (`/clancy:approve` → `/clancy:approve-plan`) happens in v0.5.6
- Branch freshness check is added to planner + implementer in v0.5.6
- Schema changes (`CLANCY_STATUS_PLANNED`, `CLANCY_SKIP_COMMENTS`, `CLANCY_PLAN_STATE_TYPE` validation) happen in v0.5.6
- All init/settings/scaffold/help/docs updates for the planner happen in v0.5.6

**What the strategist (v0.6.0) inherits:**
- `/clancy:approve-plan` already exists (no rename needed)
- Branch freshness check pattern already in `plan.md` and `once.md` (strategist copies the pattern)
- `CLANCY_STATUS_PLANNED`, `CLANCY_SKIP_COMMENTS` already in env schema
- Help command already has the updated planner section

**What the strategist still needs to do:**
- Add strategist-specific schema vars (`CLANCY_BRIEF_ISSUE_TYPE`, `CLANCY_BRIEF_EPIC`, `CLANCY_COMPONENT`)
- Add strategist commands/workflows (brief, approve-brief)
- Add strategist to init/settings/scaffold/help (new sections, not modifying planner sections)
- Add stale brief hook, STRATEGIST.md, etc.

---

## Risks (ordered by severity)

1. **Approve workflow complexity** — The approve-plan workflow now has 7 steps (was 6) with platform-specific transitions, comment editing, and auto-selection. Must be precise enough for Claude to follow.
2. **Rename ripple** — `/clancy:approve` to `/clancy:approve-plan` touches ~12 files. Missing a reference breaks UX. Mitigated by Wave 4 grep check.
3. **ADF comment editing** — Prepending a paragraph to existing ADF requires careful node manipulation. If the existing ADF structure is unexpected, the edit could fail. Mitigated by best-effort handling.
4. **Auto-detect vs --fresh UX** — Users familiar with `--force` need clear migration guidance. Mitigated by updated help text and docs.
5. **Env schema coordination** — Both planner and strategist modify `env.ts`. Merge conflicts if not coordinated.

---

## De-risking Order

1. Schema first (Agent 1) — validates TypeScript compiles with new env vars
2. Approve rename early (Agent 3) — subsequent agents need the correct name
3. Plan workflow changes early (Agent 2) — this is the user-facing critical path
4. Integration and docs last (Waves 2-3) — can be written accurately after workflows are final
5. Verification last (Wave 4) — catch anything missed
