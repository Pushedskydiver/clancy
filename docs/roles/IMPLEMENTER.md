# Implementer Role

The implementer is Clancy's core — it picks up tickets from your board and turns them into working code.

## How it works

1. Fetches the highest-priority ticket assigned to you from the implementation queue
2. Reads core codebase docs in `.clancy/docs/` (STACK, ARCHITECTURE, CONVENTIONS, GIT, DEFINITION-OF-DONE, CONCERNS) and loads additional docs if relevant to the ticket
3. Creates a feature branch, implements the ticket, writes tests
4. Commits, pushes the feature branch, and creates a PR (targeting the epic branch for parented tickets, or the base branch for standalone tickets)
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

When picking up a ticket, Clancy transitions it to "In Progress" (configurable via `CLANCY_STATUS_IN_PROGRESS`). After creating a PR, transitions to `CLANCY_STATUS_REVIEW` (falls back to `CLANCY_STATUS_DONE` if not set).

## Branch workflow

All tickets are delivered via pull request. The target branch depends on whether the ticket has a parent:

1. Creates a feature branch: `feature/{ticket-key-lowercase}` (Jira/Linear, e.g. `feature/proj-123`) or `feature/issue-{number}` (GitHub, e.g. `feature/issue-42`)
2. Implements and commits on the feature branch
3. Pushes the feature branch and creates a PR:
   - **Parented ticket (epic/milestone):** PR targets the epic branch (`epic/{key}` or `milestone/{slug}`)
   - **Standalone ticket (no parent):** PR targets the base branch (`CLANCY_BASE_BRANCH`, default: `main`)
   - **Single-child epic:** If the epic has only one child, the epic branch is skipped — PR targets the base branch directly

### Epic branch flow (parented tickets)

When a ticket has a parent, Clancy creates or checks out an epic branch and creates a PR targeting it:

1. Ensures the epic branch exists (creates from `origin/{baseBranch}` if not, fetches from remote if it does)
2. Creates the feature branch from the epic branch
3. Pushes and creates a PR targeting the epic branch
4. Transitions the ticket to the review status
5. Logs `PR_CREATED` with `parent:{KEY}` suffix in `.clancy/progress.txt`

When all children of an epic are done (PRs merged), Clancy automatically creates a final PR from the epic branch to the base branch on the next run.

### Standalone flow (no parent)

1. Pushes the feature branch to the remote
2. Detects the git host from the remote URL (GitHub, GitLab, Bitbucket — including self-hosted)
3. Creates a pull request / merge request with a description linking back to the board ticket
4. Transitions the ticket to the review status
5. Logs `PR_CREATED` to `.clancy/progress.txt`

**Fallback ladder** — Clancy never falls back to local merge:
- Push fails → logs `PUSH_FAILED`, leaves the branch for manual push
- PR creation fails → logs `PUSHED` with a manual URL for the user to create the PR
- No git host token configured → logs `PUSHED`, user creates the PR manually
- No remote detected → logs `LOCAL`, leaves the branch as-is

**GitHub Issues** use the same `GITHUB_TOKEN` for both issue fetching and PR creation. **Jira** and **Linear** users need to configure a separate git host token via `/clancy:init` or `/clancy:settings`.

## Rework flow

When a reviewer sends a ticket back for changes, Clancy picks it up automatically with the reviewer's feedback and pushes fixes. Rework tickets take priority over fresh tickets in the queue -- Clancy checks for rework before fetching new tickets on every run.

### How rework is detected

Clancy detects rework via **comments on the pull request** and (on GitHub) **review state**. No configuration is needed — the PR body includes collapsible instructions for reviewers explaining the convention.

How it works:
- Clancy scans `.clancy/progress.txt` for entries with `PR_CREATED`, `REWORK`, `PUSHED`, or `PUSH_FAILED` status
- For each candidate, it fetches comments from the git host API
- **Inline code comments** (on specific lines in the diff) always trigger rework — no prefix needed
- **Conversation comments** (general comments at the bottom of the PR) only trigger rework when prefixed with `Rework:` (e.g. "Rework: this function should handle null inputs")
- **GitHub `CHANGES_REQUESTED` review state** is an additional rework trigger — if any reviewer has requested changes via GitHub's review mechanism, rework is triggered even without inline or `Rework:` comments
- **Author filtering** — on GitHub, Clancy's own comments (e.g. post-rework status comments) are excluded from rework detection via author filtering; other platforms rely on timestamp filtering to prevent self-triggering loops
- If no rework-triggering comments are found, Clancy fetches the next fresh ticket from the queue

This approach works identically across GitHub, GitLab, and Bitbucket — the comment-based detection is platform-agnostic, with GitHub's review state as an additional signal.

### Rework process

1. **Connectivity preflight** — before starting, Clancy runs `git ls-remote origin HEAD` to verify the remote is reachable. If it fails, a warning is printed but rework proceeds (the push step will fail gracefully)
2. The feature branch and PR already exist on the remote
3. Clancy checks out the existing feature branch (`git fetch` + `git checkout`)
4. Reads reviewer feedback from PR comments (inline and `Rework:`-prefixed conversation comments)
5. Builds a rework prompt that includes `previousContext` — a `git diff --stat` against the target branch showing what files have already been changed
6. Implements fixes on the same branch — does not re-implement from scratch
7. Pushes to the same branch — the PR updates automatically
8. **Post-rework actions** (best-effort, never block the flow):
   - Leaves a PR comment summarising the rework (all platforms)
   - **GitHub:** re-requests review from reviewers who used "Request Changes" (when that was the rework trigger)
   - **GitLab:** resolves addressed discussion threads
9. Transitions the ticket back to the review status (`CLANCY_STATUS_REVIEW`)
10. Logs as `REWORK` in `.clancy/progress.txt` with a `pr:NNN` suffix tracking the PR number

If the feature branch has been deleted from the remote, Clancy creates a fresh branch from the target and treats it as a new implementation.

### Feedback

Clancy reads feedback from two sources on the pull request:

- **Inline code comments** — comments left on specific lines of the diff. These provide precise, contextual feedback tied to exact code locations and always trigger rework.
- **Conversation comments** — general comments at the bottom of the PR. Only those prefixed with `Rework:` are treated as actionable feedback. Regular discussion comments are ignored to avoid false triggers.

If no actionable comments are found, Clancy moves on to the next fresh ticket in the queue.

### Max rework guard

After `CLANCY_MAX_REWORK` cycles (default: 3) on the same ticket, Clancy logs `SKIPPED` and moves on. The ticket needs human intervention. Increase the limit via `/clancy:settings` or resolve the ticket manually.

## How the loop works

```
.clancy/clancy-afk.js
  └─ while i < MAX_ITERATIONS:
       node .clancy/clancy-once.js
         1. Preflight checks (credentials, git state, board reachability, connectivity)
         2. Check for rework (scan progress.txt for PR_CREATED/REWORK/PUSHED/PUSH_FAILED)
         3. If no rework: fetch next ticket from board (maxResults=1)
         4. git checkout $CLANCY_BASE_BRANCH (or epic/{parent} if ticket has a parent)
         5. git checkout -b feature/{ticket-key}
         6. Read .clancy/docs/* (especially GIT.md)
         7. echo "$PROMPT" | claude --dangerously-skip-permissions
         8a. [Has parent] git push → create PR targeting epic branch → transition In Review
         8b. [No parent]  git push → create PR targeting base branch → transition In Review
         8c. [Rework]     git push → post PR comment → re-request review → transition In Review
         8d. [Epic done]  Create epic PR (epic branch → base branch)
         9. Append to .clancy/progress.txt (UTC timestamps, pr:NNN suffix)
       if "No tickets found": break
```

Clancy reads `GIT.md` before every run and follows whatever conventions are documented there. The defaults above apply on greenfield projects or when GIT.md is silent.

## Verification gates

Before delivering any ticket (push + PR), Clancy runs a verification gate — an agent-based Stop hook that executes lint, test, and typecheck commands against the working tree.

### How it works

1. The Stop hook fires after the Claude implementation session completes
2. It runs the project's verification commands (auto-detected from `package.json` scripts, or overridden via `CLANCY_VERIFY_COMMANDS`)
3. If all checks pass, delivery proceeds normally
4. If any check fails, Clancy enters a **self-healing retry** loop

### Self-healing retry

When verification fails, Clancy attempts to fix the issue automatically:

1. The failing command output is fed back to Claude as context
2. Claude analyses the failure and applies a fix
3. The verification gate runs again
4. This repeats up to `CLANCY_FIX_RETRIES` times (default: 2, max: 5)
5. If all retries are exhausted, the ticket is delivered with a verification warning in the PR body

The retry count is configurable via `.clancy/.env` or `/clancy:settings`. Set `CLANCY_FIX_RETRIES=0` to disable self-healing entirely (verification still runs, but failures go straight to the PR with a warning).

### Verification commands

By default, Clancy auto-detects verification commands from `package.json`:

- `npm test` (if a `test` script exists)
- `npm run lint` (if a `lint` script exists)
- `npm run typecheck` (if a `typecheck` script exists)

Override with `CLANCY_VERIFY_COMMANDS` — a comma-separated list of commands:

```
CLANCY_VERIFY_COMMANDS="npm test,npm run lint,npm run typecheck"
```

### Verification gate agent

The verification gate uses a specialist agent prompt (`src/agents/verification-gate.md`) that understands how to interpret lint errors, test failures, and type errors, and apply targeted fixes without regressing other changes.

## Crash recovery

Clancy uses a lock file (`.clancy/lock.json`) to prevent double-runs and recover from crashes.

### Lock file lifecycle

1. When `/clancy:once` starts, it writes a lock file containing the ticket key, branch name, timestamp, and PID
2. The lock file is deleted on successful completion (after delivery + logging)
3. If the process crashes, the lock file remains

### Resume detection

On startup, if a lock file exists:

1. Clancy checks whether the PID in the lock file is still running
2. If the PID is alive → blocks with "Another Clancy session is running" (prevents double-runs)
3. If the PID is dead → the previous session crashed. Clancy enters **resume mode**:
   - Reads the ticket key and branch from the lock file
   - Checks out the existing feature branch
   - Skips ticket fetch and branch creation
   - Resumes from the implementation step (or verification, depending on how far the previous session got)

The `CLANCY_ONCE_ACTIVE` environment variable is set during execution so hooks and subprocesses can detect an active session.

## Time guard

Clancy tracks elapsed time per ticket and warns when approaching the configured limit.

- At **80%** of `CLANCY_TIME_LIMIT` (default: 30 minutes), a PostToolUse warning is injected: "Time warning — 80% of time limit reached. Wrap up current work."
- At **100%**, a final warning is injected: "Time limit reached. Commit current progress and proceed to delivery."
- Set `CLANCY_TIME_LIMIT=0` to disable the time guard entirely

The time guard is integrated into the context-monitor hook (`clancy-context-monitor.js`) and uses the same bridge file mechanism as context warnings.

## Branch guard

The branch guard hook (`clancy-branch-guard.js`) is a PreToolUse hook that blocks dangerous git operations:

- **Force push** — blocks `git push --force` and `git push -f` (prevents overwriting remote history)
- **Protected branches** — blocks direct push to `main`, `master`, and `CLANCY_BASE_BRANCH` (all work goes through feature branches)
- **Destructive resets** — blocks `git reset --hard`, `git clean -fd`, and `git checkout .` on protected branches

The branch guard is best-effort — it catches common destructive patterns but does not intercept every possible git invocation. It runs as a PreToolUse hook on Bash and Execute commands, inspecting the command string before execution.

Enable or disable via `CLANCY_BRANCH_GUARD` (default: `true`). Set to `false` to disable all branch guard checks.
