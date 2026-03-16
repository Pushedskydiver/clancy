# Planner Role *(optional)*

The planner refines backlog tickets into structured implementation plans **before** they reach the implementer. It uses a separate planning queue so it never competes with the implementer for tickets.

## Enable the Planner

The planner is an optional role. To enable it, add `planner` to `CLANCY_ROLES` in `.clancy/.env` and re-run the installer:

```bash
echo 'CLANCY_ROLES="planner"' >> .clancy/.env
npx chief-clancy@latest --local   # or --global
```

You can also toggle it via `/clancy:settings`.

## How it works

1. Fetches tickets from the **planning queue** (earlier-stage tickets than the implementation queue)
2. Checks branch freshness — warns if the local branch is behind the remote
3. Reads codebase docs in `.clancy/docs/` for context, explores relevant source code
4. Generates a structured implementation plan (affected files, approach, acceptance criteria, risks)
5. Posts the plan as a comment on the ticket with a `## Clancy Implementation Plan` marker
6. You review, leave feedback as comments, then either re-plan or approve

## Commands

| Command | What it does |
| --- | --- |
| `/clancy:plan` | Plan the next backlog ticket |
| `/clancy:plan 3` | Plan up to 3 tickets in batch mode (max 10) |
| `/clancy:plan PROJ-123` | Plan a specific ticket by key (`PROJ-123`, `#42`, `ENG-42`) |
| `/clancy:plan --fresh` | Discard any existing plan and start from scratch |
| `/clancy:approve-plan` | Promote the oldest unapproved plan to the ticket description |
| `/clancy:approve-plan PROJ-123` | Approve a specific ticket's plan |

Arguments can appear in any order (e.g. `/clancy:plan 3 --fresh` or `/clancy:plan --fresh PROJ-123`).

## Planning queue filters

The planner fetches from a **separate queue** to the implementer, targeting earlier-stage tickets:

| Board | Default filter | Env var to customise |
| --- | --- | --- |
| Jira | `status = "Backlog"` | `CLANCY_PLAN_STATUS` |
| GitHub | Label: `needs-refinement` | `CLANCY_PLAN_LABEL` |
| Linear | `state.type: "backlog"` | `CLANCY_PLAN_STATE_TYPE` |

`CLANCY_PLAN_STATE_TYPE` accepts one of: `backlog`, `unstarted`, `started`, `completed`, `canceled`, `triage`.

Additional filters vary by board:
- **Jira:** `CLANCY_LABEL` and `CLANCY_JQL_SPRINT` apply on top of the planning queue filter
- **GitHub:** Uses `CLANCY_PLAN_LABEL` only (not `CLANCY_LABEL`)
- **Linear:** No additional label filter
- **All boards:** `assignee = currentUser()` always applies

### How transitions work per board

**Jira:** Transitions use native status columns. `/clancy:approve-plan` transitions the ticket to the status specified by `CLANCY_STATUS_PLANNED` (if configured). If `CLANCY_STATUS_PLANNED` is not set, the transition is skipped and you move the ticket manually.

**Linear:** `/clancy:approve-plan` automatically moves the ticket to the "unstarted" state (the implementation queue). The unstarted state UUID is resolved via a `workflowStates` query. Best-effort — warns on failure, never blocks.

**GitHub:** Issues don't have status columns — they're either `open` or `closed`. Clancy uses **labels as queues** instead:

1. **You** add the `needs-refinement` label to issues you want planned (this is a manual step)
2. `/clancy:plan` picks up issues with that label
3. `/clancy:approve-plan` removes `needs-refinement` (the plan label). If `CLANCY_LABEL` is set, also adds it as the implementation label.
4. `/clancy:once` picks up issues (filtered by `CLANCY_LABEL` if set, otherwise all open assigned issues)
5. On completion, Clancy closes the issue

No GitHub Projects integration — Clancy works with the Issues REST API only.

## The workflow

```
/clancy:plan          Post plan as comment on ticket
      ↓
Review + feedback     Team comments on the ticket normally
      ↓
/clancy:plan          Re-plan — auto-detects feedback and revises
      ↓
/clancy:approve-plan  Promote plan to description, transition to implementation queue
      ↓
/clancy:once          Implementer picks it up with full plan context
```

### Plan

When `/clancy:plan` runs, it:

1. **Preflight** — checks `.clancy/.env`, board credentials, codebase docs
2. **Branch freshness** — fetches from remote, warns if local branch is behind `origin/main` (or `CLANCY_BASE_BRANCH`), offers pull/continue/abort
3. **Fetch** — pulls tickets from the planning queue (or fetches a specific ticket if a key was provided)
4. **Existing plan check** — auto-detects whether the ticket already has a plan:
   - **Has plan + feedback comments:** revises the plan incorporating feedback
   - **Has plan + no feedback:** tells you to add feedback first
   - **`--fresh` flag:** discards the existing plan and starts from scratch
5. **Skip check** — irrelevant or infeasible tickets are skipped. If `CLANCY_SKIP_COMMENTS` is enabled (default: `true`), a comment is posted on the ticket explaining why it was skipped.
6. **QA return check** — looks in `.clancy/progress.txt` for previously implemented tickets that have returned
7. **Explore** — reads codebase docs, examines relevant source files, checks Figma if configured
8. **Generate plan** — writes a structured implementation plan
9. **Post** — adds the plan as a comment on the ticket
10. **Log** — appends to `.clancy/progress.txt`

### Re-plan (auto-detect)

Running `/clancy:plan` on an already-planned ticket automatically detects feedback. Clancy reads all comments posted **after** the most recent `## Clancy Implementation Plan` comment. These are treated as feedback — no special syntax needed, just comment normally on the ticket.

If feedback exists, Clancy revises the plan incorporating the new comments. If no feedback exists, it tells you to add some first.

To discard an existing plan entirely and start from scratch, use `/clancy:plan --fresh`.

### Approve

When `/clancy:approve-plan` runs, it:

1. **Auto-selects** — if no ticket key is provided, scans `.clancy/progress.txt` for the oldest planned-but-unapproved ticket and shows a confirmation prompt
2. Fetches the ticket and its comments
3. Finds the most recent `## Clancy Implementation Plan` comment
4. Appends the plan to the ticket description (never replaces the original description)
5. **Edits the plan comment** — prepends an approval note to the existing comment (does not delete it)
6. **Transitions the ticket** to the implementation queue:
   - **GitHub:** removes the plan label (`CLANCY_PLAN_LABEL`). If `CLANCY_LABEL` is set, adds it as the implementation label (creates if missing). If not set, only the plan label is removed.
   - **Jira:** if `CLANCY_STATUS_PLANNED` is configured, fetches available transitions and POSTs the transition. If not configured, skips (manual transition).
   - **Linear:** resolves the "unstarted" state UUID via `workflowStates` query, then updates the issue state. Always attempted.
   - All transitions are best-effort — warns on failure, never blocks the approval.
7. Logs the approval to `.clancy/progress.txt`

## Plan template

The generated plan includes (in this order):

- **Summary** — one-line overview
- **Affected Files** — which files will be created, modified, or deleted
- **Implementation Approach** — step-by-step implementation strategy
- **Test Strategy** — how the changes should be tested
- **Acceptance Criteria** — testable criteria derived from the ticket
- **Dependencies** — external dependencies or prerequisites
- **Figma Link** — design reference (when a Figma URL is present in the ticket)
- **Risks / Considerations** — potential issues to watch for
- **Size Estimate** — S / M / L
- **Footer** — links back to Clancy with instructions for re-planning and approving
