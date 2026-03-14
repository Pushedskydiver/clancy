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
2. Reads codebase docs in `.clancy/docs/` for context, explores relevant source code
3. Generates a structured implementation plan (affected files, approach, acceptance criteria, risks)
4. Posts the plan as a comment on the ticket with a `## Clancy Implementation Plan` marker
5. You review, leave feedback as comments, then either re-plan (`--force`) or approve

## Commands

| Command | What it does |
| --- | --- |
| `/clancy:plan` | Plan the next backlog ticket |
| `/clancy:plan 3` | Plan up to 3 tickets in batch mode (max 10) |
| `/clancy:plan --force` | Re-plan a ticket that already has a plan (reads your feedback comments) |
| `/clancy:approve PROJ-123` | Promote an approved plan to the ticket description, move to implementation queue |

Arguments can appear in any order (e.g. `/clancy:plan 3 --force` or `/clancy:plan --force 3`).

## Planning queue filters

The planner fetches from a **separate queue** to the implementer, targeting earlier-stage tickets:

| Board | Default filter | Env var to customise |
| --- | --- | --- |
| Jira | `status = "Backlog"` | `CLANCY_PLAN_STATUS` |
| GitHub | Label: `needs-refinement` | `CLANCY_PLAN_LABEL` |
| Linear | `state.type = "backlog"` | `CLANCY_PLAN_STATE_TYPE` |

Shared filters (`CLANCY_LABEL`, `CLANCY_JQL_SPRINT`, `assignee=currentUser()`) still apply on top of these.

## The workflow

```
/clancy:plan          Post plan as comment on ticket
      ↓
Review + feedback     Team comments on the ticket normally
      ↓
/clancy:plan --force  Re-plan incorporating feedback (optional, repeat as needed)
      ↓
/clancy:approve       Promote plan to description, move ticket to implementation queue
      ↓
/clancy:once          Implementer picks it up with full plan context
```

### Plan

When `/clancy:plan` runs, it:

1. **Preflight** — checks `.clancy/.env`, board credentials, codebase docs
2. **Fetch** — pulls tickets from the planning queue
3. **Skip check** — detects tickets that already have a plan (unless `--force`)
4. **QA return check** — looks in `.clancy/progress.txt` for previously implemented tickets that have returned
5. **Explore** — reads codebase docs, examines relevant source files, checks Figma if configured
6. **Generate plan** — writes a structured implementation plan
7. **Post** — adds the plan as a comment on the ticket
8. **Log** — appends to `.clancy/progress.txt`

### Re-plan (--force)

When re-planning, Clancy reads all comments posted **after** the most recent `## Clancy Implementation Plan` comment. These are treated as feedback — no special syntax needed, just comment normally on the ticket.

### Approve

When `/clancy:approve PROJ-123` runs, it:

1. Fetches the ticket and its comments
2. Finds the most recent `## Clancy Implementation Plan` comment
3. Appends the plan to the ticket description (never replaces the original description)
4. Transitions the ticket to the implementation queue status
5. Logs the approval to `.clancy/progress.txt`

## Plan template

The generated plan includes:

- **Summary** — one-line overview
- **Size estimate** — S / M / L
- **Affected files** — which files will be created, modified, or deleted
- **Approach** — step-by-step implementation strategy
- **Acceptance criteria** — testable criteria derived from the ticket
- **Risks & edge cases** — potential issues to watch for
- **Footer** — links back to Clancy with instructions for re-planning and approving
