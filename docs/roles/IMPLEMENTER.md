# Implementer Role

The implementer is Clancy's core — it picks up tickets from your board and turns them into working code.

## How it works

1. Fetches the highest-priority ticket assigned to you from the implementation queue
2. Reads all codebase docs in `.clancy/docs/` for full context
3. Creates a feature branch, implements the ticket, writes tests
4. Commits, squash-merges to the epic/base branch, transitions the ticket on the board
5. Logs the result to `.clancy/progress.txt`

## Commands

| Command | What it does |
| --- | --- |
| `/clancy:once` | Pick up one ticket, implement it, done |
| `/clancy:run` | Loop — processes tickets until the queue is empty or `MAX_ITERATIONS` is hit |
| `/clancy:run 20` | Same, but override `MAX_ITERATIONS` to 20 for this session |
| `/clancy:dry-run` | Simulate a run without making changes — shows what would happen |

## Implementation queue filters

The implementer uses the **implementation queue** — tickets that are ready to be worked on.

| Board | Default filter | Env var to customise |
| --- | --- | --- |
| Jira | `status = "To Do"` | `CLANCY_JQL_STATUS` |
| GitHub | Label: `clancy` | `CLANCY_LABEL` |
| Linear | `state.type: "unstarted"` | (hardcoded to unstarted) |

Additional shared filters (apply to all boards):

| Filter | Env var | Notes |
| --- | --- | --- |
| Sprint filter (Jira only) | `CLANCY_JQL_SPRINT` | When set, adds `AND sprint in openSprints()` |
| Label filter | `CLANCY_LABEL` | Optional label to narrow the queue |
| Assignment | — | Always filters to `assignee = currentUser()` |

## AFK mode

The implementer supports fully autonomous operation via `/clancy:run`. In this mode, Clancy:

1. Picks up the next ticket from the queue
2. Implements it end-to-end
3. Commits, merges, transitions the ticket
4. Loops back to step 1
5. Stops when the queue is empty or `MAX_ITERATIONS` is reached (default: 5)

This is the "AFK loop" — you can walk away and let Clancy work through your backlog.

## Status transitions

When picking up a ticket, Clancy transitions it to "In Progress" (configurable via `CLANCY_STATUS_IN_PROGRESS`). On completion, it transitions to "Done" (configurable via `CLANCY_STATUS_DONE`).

## Branch workflow

For each ticket, the implementer:

1. Creates a feature branch: `feature/{ticket-key}` (Jira/Linear) or `feature/issue-{number}` (GitHub)
2. Implements and commits on the feature branch
3. Squash-merges to the epic/base branch
4. Deletes the feature branch locally (never pushes deletes to remote)

## How the loop works

```
clancy-afk.js
  └─ while i < MAX_ITERATIONS:
       node clancy-once.js
         1. Preflight checks (credentials, git state, board reachability)
         2. Fetch next ticket from board (maxResults=1)
         3. git checkout $CLANCY_BASE_BRANCH (or epic/{parent} if ticket has a parent)
         4. git checkout -b feature/{ticket-key}
         5. Read .clancy/docs/* (especially GIT.md)
         6. echo "$PROMPT" | claude --dangerously-skip-permissions
         7. git checkout $CLANCY_BASE_BRANCH
         8. git merge --squash feature/{ticket-key}
         9. git commit -m "feat(TICKET): summary"
        10. git branch -D feature/{ticket-key}
        11. Append to .clancy/progress.txt
       if "No tickets found": break
```

Clancy reads `GIT.md` before every run and follows whatever conventions are documented there. The defaults above apply on greenfield projects or when GIT.md is silent.
