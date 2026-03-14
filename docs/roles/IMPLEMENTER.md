# Implementer Role

The implementer is Clancy's core — it picks up tickets from your board and turns them into working code.

## How it works

1. Fetches the highest-priority ticket assigned to you from the implementation queue
2. Reads core codebase docs in `.clancy/docs/` (STACK, ARCHITECTURE, CONVENTIONS, GIT, DEFINITION-OF-DONE, CONCERNS) and loads additional docs if relevant to the ticket
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
| GitHub | No label filter (all open issues assigned to you). Set `CLANCY_LABEL=clancy` for a dedicated queue | `CLANCY_LABEL` |
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

When picking up a ticket, Clancy transitions it to "In Progress" (configurable via `CLANCY_STATUS_IN_PROGRESS`). On completion:

- **Epic flow (squash merge):** transitions to `CLANCY_STATUS_DONE`
- **PR flow (no parent):** transitions to `CLANCY_STATUS_REVIEW` (falls back to `CLANCY_STATUS_DONE` if not set)

## Branch workflow

For each ticket, the implementer:

1. Creates a feature branch: `feature/{ticket-key-lowercase}` (Jira/Linear, e.g. `feature/proj-123`) or `feature/issue-{number}` (GitHub, e.g. `feature/issue-42`)
2. Implements and commits on the feature branch
3. **If the ticket has a parent (epic/milestone):** squash-merges to the epic/base branch, deletes the feature branch locally
4. **If the ticket has no parent:** pushes the feature branch and creates a pull request on your git host

### PR-based flow (no parent)

When a ticket has no parent epic, Clancy uses a PR-based flow instead of merging locally:

1. Pushes the feature branch to the remote
2. Detects the git host from the remote URL (GitHub, GitLab, Bitbucket — including self-hosted)
3. Creates a pull request / merge request with a description linking back to the board ticket
4. Transitions the ticket to the review status (`CLANCY_STATUS_REVIEW`, falls back to `CLANCY_STATUS_DONE`)
5. Logs `PR_CREATED` with the PR URL to `.clancy/progress.txt`

**Fallback ladder** — Clancy never falls back to local merge if the intent is PR creation:
- Push fails → logs `PUSH_FAILED`, leaves the branch for manual push
- PR creation fails → logs `PUSHED` with a manual URL for the user to create the PR
- No git host token configured → logs `PUSHED`, user creates the PR manually
- No remote detected → logs `LOCAL`, leaves the branch as-is

**GitHub Issues** use the same `GITHUB_TOKEN` for both issue fetching and PR creation. **Jira** and **Linear** users need to configure a separate git host token via `/clancy:init` or `/clancy:settings`.

### Epic flow (has parent)

When a ticket has a parent epic, the original squash-merge flow applies:

1. Squash-merges the feature branch into the epic/base branch
2. Deletes the feature branch locally (never pushes deletes to remote)
3. Transitions the ticket to the done status (`CLANCY_STATUS_DONE`)
4. Logs `DONE` to `.clancy/progress.txt`

## How the loop works

```
.clancy/clancy-afk.js
  └─ while i < MAX_ITERATIONS:
       node .clancy/clancy-once.js
         1. Preflight checks (credentials, git state, board reachability)
         2. Fetch next ticket from board (maxResults=1)
         3. git checkout $CLANCY_BASE_BRANCH (or epic/{parent} if ticket has a parent)
         4. git checkout -b feature/{ticket-key}
         5. Read .clancy/docs/* (especially GIT.md)
         6. echo "$PROMPT" | claude --dangerously-skip-permissions
         7a. [Has parent] git merge --squash → commit → delete branch → transition Done
         7b. [No parent]  git push → create PR → transition In Review
         8. Append to .clancy/progress.txt
       if "No tickets found": break
```

Clancy reads `GIT.md` before every run and follows whatever conventions are documented there. The defaults above apply on greenfield projects or when GIT.md is silent.
