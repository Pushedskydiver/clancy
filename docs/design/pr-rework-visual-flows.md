# PR-Based Flow & QA Rework Loop -- Visual Flows (All Platforms)

Comprehensive visual flow reference for PR creation, rework detection, rework execution, and error handling across GitHub, GitLab, Bitbucket Cloud, and Bitbucket Server. Every scenario, every edge case, every platform difference.

---

## Table of Contents

1. [PR Creation Flow](#part-1-pr-creation-flow)
2. [Rework Detection Flow](#part-2-rework-detection-flow)
3. [Rework Execution Flow](#part-3-rework-execution-flow)
4. [Error Flows](#part-4-error-flows)
5. [Platform Comparison Tables](#part-5-platform-comparison-tables)
6. [Progress Log Format](#part-6-progress-log-format)

---

## Part 1: PR Creation Flow

### Entry Condition: When Does PR Flow Activate?

```
Step 13 in run() — Delivery Decision
       |
       v
  isRework?
       |
  +----+----+
  Yes       No
  |         |
  v         v
PR flow   hasParent?
(always)  (ticket.parentInfo !== 'none')
            |
       +----+----+
       Yes       No
       |         |
       v         v
  Epic merge   PR flow
  (squash      (push +
   locally,     create PR)
   delete
   branch,
   DONE)

Parent sources per platform:
  Jira:   ticket.epicKey         (e.g. "PROJ-50")
  GitHub: ticket.milestone       (e.g. "v2.0")
  Linear: ticket.parentIdentifier (e.g. "ENG-10")

  Any of these !== 'none' -> hasParent = true -> epic merge
  All === 'none' -> PR flow
```

### Master PR Creation Flow Diagram

```
┌──────────────────────────────────────────────┐
│  deliverViaPullRequest()                     │
│  Called from run() step 13                   │
│  Inputs: config, ticket, ticketBranch,       │
│          targetBranch, startTime             │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 1: PUSH BRANCH                         │
│                                              │
│  pushBranch(ticketBranch)                    │
│  -> git push -u origin <ticketBranch>        │
│                                              │
│  -u sets upstream tracking.                  │
│  For rework: pushes to existing remote       │
│    branch, updating the open PR.             │
│  For new: creates remote branch.             │
└──────────────────────┬───────────────────────┘
                       │
                  Push succeeded?
                       │
              +────────+────────+
              |                 |
              No                Yes
              |                 |
              v                 v
   ┌─────────────────┐   ┌─────────────────┐
   │ PUSH FAILED      │   │ Continue        │
   │                   │   │                 │
   │ Print:            │   │ Print:          │
   │ "Could not push   │   │ "Pushed         │
   │  {branch} to      │   │  {branch}"      │
   │  origin."         │   │                 │
   │ "Push manually:   │   │                 │
   │  git push -u      │   │                 │
   │  origin {branch}" │   │                 │
   │                   │   │                 │
   │ Log: PUSH_FAILED  │   │                 │
   │ Checkout target   │   │                 │
   │ Return false      │   │                 │
   └───────────────────┘   └────────┬────────┘
                                    │
                                    v
┌──────────────────────────────────────────────┐
│  Step 2: DETECT REMOTE                       │
│                                              │
│  platformOverride = CLANCY_GIT_PLATFORM      │
│  remote = detectRemote(platformOverride)     │
│                                              │
│  1. git remote get-url origin                │
│  2. Parse URL (SSH or HTTPS)                 │
│  3. Map hostname to platform:                │
│     github.com / *github* -> github          │
│     gitlab.com / *gitlab* -> gitlab          │
│     bitbucket.org / *bitbucket* -> bitbucket │
│       (scm/ prefix -> bitbucket-server)      │
│     dev.azure / visualstudio -> azure        │
│     otherwise -> unknown                     │
│  4. If CLANCY_GIT_PLATFORM set:              │
│     override auto-detection                  │
└──────────────────────┬───────────────────────┘
                       │
                  Remote type?
                       │
       +───────────────+───────────────+──────────────+
       |               |               |              |
       v               v               v              v
    none           unknown/azure   Supported      (github/
       |               |          platform        gitlab/
       v               v               |          bitbucket/
  ┌──────────┐   ┌──────────┐          |          bitbucket-
  │ LOCAL     │   │ PUSHED    │         |          server)
  │           │   │           │         |
  │ "No git   │   │ "Branch   │         |
  │  remote   │   │  pushed   │         |
  │  config." │   │  to       │         |
  │           │   │  remote.  │         |
  │ Log:LOCAL │   │  Create   │         |
  └──────────┘   │  PR/MR    │         |
                  │  manually."│         |
                  │ Log:PUSHED│         |
                  └──────────┘         |
                                       v
┌──────────────────────────────────────────────┐
│  Step 3: RESOLVE CREDENTIALS                 │
│                                              │
│  resolveGitToken(config, remote)             │
│                                              │
│  github          -> GITHUB_TOKEN             │
│  gitlab          -> GITLAB_TOKEN             │
│  bitbucket       -> BITBUCKET_USER +         │
│                     BITBUCKET_TOKEN          │
│  bitbucket-server -> BITBUCKET_TOKEN         │
│                                              │
│  For GitHub boards: GITHUB_TOKEN always      │
│  present (required for issue fetching).      │
│  For Jira/Linear: user must configure        │
│  separate git host tokens.                   │
└──────────────────────┬───────────────────────┘
                       │
                  Token found?
                       │
              +────────+────────+
              |                 |
              No                Yes
              |                 |
              v                 v
   ┌─────────────────┐   Continue to
   │ No token         │   Step 4
   │                   │
   │ Build manual URL  │
   │ (if possible)     │
   │ Print:            │
   │ "Create a PR:     │
   │  {manualUrl}"     │
   │ or:               │
   │ "Branch pushed    │
   │  to remote.       │
   │  Create PR/MR     │
   │  manually."       │
   │                   │
   │ Log: PUSHED       │
   └───────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4: BUILD API BASE URL                  │
│                                              │
│  buildApiBaseUrl(remote, CLANCY_GIT_API_URL) │
│                                              │
│  If CLANCY_GIT_API_URL set:                  │
│    -> use it (strip trailing /)              │
│  github.com:                                 │
│    -> https://api.github.com                 │
│  GitHub Enterprise:                          │
│    -> https://{hostname}/api/v3              │
│  GitLab:                                     │
│    -> https://{hostname}/api/v4              │
│  Bitbucket Cloud:                            │
│    -> https://api.bitbucket.org/2.0          │
│  Bitbucket Server:                           │
│    -> https://{hostname}/rest/api/1.0        │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 5: BUILD PR TITLE AND BODY             │
│                                              │
│  Title: feat({ticket.key}): {ticket.title}   │
│                                              │
│  Body: buildPrBody(config, ticket)           │
│                                              │
│  Board link (platform-specific):             │
│    GitHub: "Closes #N" (auto-close on merge) │
│    Jira:   "**Jira:** [KEY](URL/browse/KEY)" │
│    Linear: "**Linear:** KEY"                 │
│                                              │
│  Description section (if non-empty)          │
│                                              │
│  Footer:                                     │
│    Created by Clancy                         │
│                                              │
│  Rework instructions (in <details> block):   │
│    - Inline comments: always picked up       │
│    - General feedback: needs Rework: prefix  │
│    - Example shown                           │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 6: ATTEMPT PR CREATION                 │
│                                              │
│  attemptPrCreation() dispatches to           │
│  platform-specific function.                 │
│  All use postPullRequest() internally:       │
│    - POST JSON with 30s timeout              │
│    - AbortController for timeout             │
│    - Parse success via parseSuccess callback │
│    - Check already-exists via isAlreadyExists │
│    - Validate response has URL or number     │
│                                              │
│  Platform details:                           │
│  (see Part 5 for full API comparison)        │
└──────────────────────┬───────────────────────┘
                       │
                  PR result?
                       │
       +───────────+───+───────────+───────────+
       |           |               |           |
       v           v               v           v
    Success    Already         API error    undefined
       |       exists              |       (no token)
       v           |               v           |
  ┌────────┐  ┌────────┐    ┌────────────┐     v
  │PR_CREATED│  │PUSHED  │    │PUSHED      │  (handled
  │         │  │         │    │            │   in Step 3)
  │"PR      │  │"A PR/MR│    │"PR/MR      │
  │ created:│  │ already │    │ creation   │
  │ {url}"  │  │ exists  │    │ failed:    │
  │         │  │ for     │    │ {error}"   │
  │         │  │{branch}.│    │            │
  │         │  │ Branch  │    │ Manual URL │
  │         │  │ pushed."│    │ printed if │
  │         │  │         │    │ available  │
  └────────┘  └────────┘    └────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 7: PR ASSIGNEE AND LABELS              │
│  (PLANNED — not yet implemented)             │
│                                              │
│  Assign the authenticated user.              │
│  Add CLANCY_LABEL if set.                    │
│                                              │
│  Platform-specific:                          │
│  GitHub:                                     │
│    PATCH /repos/{repo}/issues/{number}       │
│    Body: { "assignees": ["{username}"],      │
│            "labels": ["{CLANCY_LABEL}"] }    │
│  GitLab:                                     │
│    PUT /projects/{id}/merge_requests/{iid}   │
│    Body: { "assignee_id": {userId},          │
│            "labels": "{CLANCY_LABEL}" }      │
│  Bitbucket Cloud:                            │
│    No assignee API for PRs.                  │
│    Labels not supported on PRs.              │
│  Bitbucket Server:                           │
│    PUT /pull-requests/{id}                   │
│    Reviewers field (not assignee).            │
│    No label API.                             │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 8: TRANSITION BOARD TICKET             │
│                                              │
│  GitHub:                                     │
│    Do NOT close issue.                       │
│    PR body has "Closes #N" — auto-close on   │
│    merge. Closing now would be premature.    │
│                                              │
│  Jira/Linear:                                │
│    Transition to CLANCY_STATUS_REVIEW        │
│    Falls back to CLANCY_STATUS_DONE          │
│    if CLANCY_STATUS_REVIEW not set.          │
│                                              │
│  Best-effort — failure does not stop flow.   │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 9: SWITCH BACK TO TARGET BRANCH        │
│                                              │
│  checkout(targetBranch)                      │
│  Return true (success)                       │
└──────────────────────────────────────────────┘
```

### Complete Fallback Ladder

```
deliverViaPullRequest() outcome ladder:
════════════════════════════════════════════════════════════════════

Push succeeds?
  No  ──> PUSH_FAILED
          Print manual push command
          Checkout target branch
          Return false (caller returns early)

  Yes ──> Detect remote
            │
            ├── none ──> LOCAL
            │            "No git remote configured."
            │
            ├── unknown/azure ──> PUSHED
            │                     "Branch pushed. Create PR manually."
            │
            └── github/gitlab/bitbucket/bitbucket-server
                  │
                  ├── Has token?
                  │     │
                  │     ├── No ──> PUSHED + manual URL (if available)
                  │     │
                  │     └── Yes ──> Attempt PR creation
                  │                   │
                  │                   ├── Success ──> PR_CREATED
                  │                   │
                  │                   ├── Already exists ──> PUSHED
                  │                   │                      Note printed
                  │                   │
                  │                   └── API error ──> PUSHED
                  │                                    Manual URL printed
                  │                                    (if available)
                  │
                  └── (unreachable)

Manual URL availability:
  GitHub:           https://{host}/{owner}/{repo}/compare/{target}...{branch}
  GitLab:           https://{host}/{project}/-/merge_requests/new?...
  Bitbucket Cloud:  https://{host}/{ws}/{slug}/pull-requests/new?...
  Bitbucket Server: undefined (no standard URL pattern — PLANNED fallback)
```

---

## Part 2: Rework Detection Flow

### Entry Point

```
run() step 5 — BEFORE fetching fresh tickets
       |
       v
  fetchReworkFromPrReview(config)
       |
       v
  Rework ALWAYS takes priority over fresh tickets.
  If rework found: skip fetchTicket() entirely.
  If no rework: fall through to fetchTicket().
```

### Master Rework Detection Flow Diagram

```
┌──────────────────────────────────────────────┐
│  fetchReworkFromPrReview(config)              │
│                                              │
│  Best-effort — any error returns undefined.  │
│  Wrapped in try/catch in run(), so           │
│  exceptions fall through to fresh ticket.    │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 1: FIND CANDIDATES IN PROGRESS.TXT     │
│                                              │
│  Scan for tickets whose LATEST status is:    │
│    - PR_CREATED                              │
│    - REWORK                                  │
│    - PUSHED        (catches manual pushes)   │
│    - PUSH_FAILED   (catches retry scenarios) │
│                                              │
│  findEntriesWithStatus() builds a            │
│  Map<key, entry> (latest wins per key),      │
│  then filters to entries with target status. │
│                                              │
│  Example:                                    │
│    PR_CREATED, then DONE -> NOT candidate    │
│    PR_CREATED, then REWORK -> candidate      │
│      (latest = REWORK)                       │
│    REWORK, then PR_CREATED -> candidate      │
│      (latest = PR_CREATED)                   │
│    PUSHED (no follow-up) -> candidate        │
│    PUSH_FAILED (no follow-up) -> candidate   │
│                                              │
│  Note: Double-logging means rework delivery  │
│  creates PR_CREATED/PUSHED then REWORK.      │
│  Latest = REWORK, which is a candidate.      │
│  If second write fails, latest = PR_CREATED, │
│  which is also a candidate. Resilient.       │
└──────────────────────┬───────────────────────┘
                       │
                  Candidates found?
                       │
              +────────+────────+
              |                 |
              0                 1+
              |                 |
              v                 v
         undefined         Continue
         (no rework)
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 2: GATE CHECKS                         │
│                                              │
│  All silent — best-effort, no user output.   │
│                                              │
│  Remote = none, unknown, or azure?           │
│    -> undefined (can't check PR state)       │
│                                              │
│  No git host token?                          │
│    -> undefined (can't call API)             │
│                                              │
│  No API base URL?                            │
│    -> undefined                              │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 3: CHECK PR REVIEW STATE               │
│  (per candidate, max 5 for rate limits)      │
│                                              │
│  For each candidate entry:                   │
│                                              │
│  3a. Compute ticket branch:                  │
│      computeTicketBranch(provider, key)      │
│      Jira/Linear: feature/{key-lowercase}    │
│      GitHub: feature/issue-{number}          │
│                                              │
│  3b. Convert progress timestamp to ISO 8601: │
│      "YYYY-MM-DD HH:MM" (UTC)               │
│        -> "YYYY-MM-DDTHH:MM"                │
│        -> new Date(...)                      │
│        -> .toISOString()                     │
│      Falls back to undefined if invalid.     │
│                                              │
│  3c. Call platform-specific review checker   │
│      (see below for per-platform details)    │
└──────────────────────┬───────────────────────┘
                       │
                  changesRequested?
                       │
              +────────+────────+
              |                 |
           false/undefined     true
              |                 |
              v                 v
         Next candidate    Step 4: Fetch
         (or undefined     feedback
          if last)         comments
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4: FETCH FEEDBACK COMMENTS             │
│                                              │
│  Same platform dispatch as Step 3.           │
│  Returns string[] of formatted comments.     │
│                                              │
│  Comment formatting (uniform):               │
│    Inline: "[path] comment body"             │
│      Path from platform-specific field       │
│    Conversation: "stripped rework content"    │
│      Rework: prefix removed via              │
│      extractReworkContent()                  │
│    Non-Rework conversation: EXCLUDED         │
│                                              │
│  Author filtering (PLANNED):                │
│    Filter out comments by authenticated user │
│    (the token owner) to prevent Clancy's own │
│    PR comments from triggering rework.       │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 5: BUILD REWORK TICKET                 │
│                                              │
│  Construct minimal FetchedTicket:            │
│  {                                           │
│    key: entry.key,       // from progress    │
│    title: entry.summary, // from progress    │
│    description: '',      // empty — not      │
│                          //   re-fetched     │
│    parentInfo: 'none',   // always none      │
│    blockers: 'None',     // not applicable   │
│  }                                           │
│                                              │
│  Note: empty description means the rework    │
│  prompt relies entirely on reviewer feedback │
│  and file context from the branch.           │
│                                              │
│  Return: { ticket, feedback, prNumber }      │
└──────────────────────────────────────────────┘
```

### Platform-Specific Review State Checking

```
Step 3c: Check PR review state per platform
══════════════════════════════════════════════════════════════════════

GitHub                      GitLab                      Bitbucket Cloud
─────────────────────       ─────────────────────       ─────────────────────
1. Find open PR:            1. Find open MR:            1. Find open PR:
   GET /repos/{repo}/         GET /projects/{encoded}/    GET /repos/{ws}/{slug}/
     pulls?head=                merge_requests?             pullrequests?
     {owner}:{branch}          source_branch={branch}      q=source.branch.
     &state=open                &state=opened               name="{branch}"
                                                            &state=OPEN

2. Fetch comments:          2. Fetch discussions:       2. Fetch comments:
   GET /pulls/{n}/             GET /merge_requests/        GET /pullrequests/
     comments?per_page=100      {iid}/discussions?          {id}/comments?
     &since={iso}               per_page=100                pagelen=100
   GET /issues/{n}/
     comments?per_page=100
     &since={iso}

   (inline + conversation   3. Filter per note:         3. Filter client-side:
    fetched in parallel)       Skip system notes            created_on > since
                               (note.system === true)
3. since filtering:            Check created_at <= since 4. Rework triggers:
   Server-side via             (client-side, string         Inline: c.inline
   query parameter.            comparison — ISO 8601        != null
   GitHub API filters          is lexicographically         Rework: c.inline
   both endpoints.             sortable)                    == null &&
                                                            isReworkComment(
4. Rework triggers:         4. Rework triggers:              c.content.raw)
   Inline: any comment         DiffNote with
     from /pulls/{n}/            resolvable !== false
     comments endpoint           && resolved !== true
   Rework: conversation         -> rework
     comment matching          General note matching
     isReworkComment(body)       isReworkComment(body)
                                 -> rework
   Note: GitHub has no
   resolution concept          Note: resolved DiffNotes
   for inline comments.        are IGNORED. Reviewers
   Once posted, they           can dismiss feedback by
   always trigger rework.      resolving threads.
   `since` is the only
   mitigation.
                            ─────────────────────────────────────────────
                            Bitbucket Server
                            ─────────────────────
                            1. Find open PR:
                               GET /projects/{key}/repos/{slug}/
                                 pull-requests?state=OPEN
                                 &at=refs/heads/{branch}

                            2. Fetch activities:
                               GET /pull-requests/{id}/activities?limit=100

                            3. Filter:
                               action === 'COMMENTED' && comment exists
                               comment.createdDate > sinceMs
                               (epoch ms comparison via Date.parse(since))

                            4. Rework triggers:
                               Inline: comment.anchor != null
                               Rework: anchor == null &&
                                 isReworkComment(comment.text)
```

### What Triggers Rework (Summary)

```
COMMENT TYPE              TRIGGERS REWORK?         CONVENTION
────────────────────────────────────────────────────────────────────
Inline/code comment       ALWAYS                   Any comment on a
(left on a specific                                specific line is
code line in the diff)                             treated as a change
                                                   request. No prefix
                                                   needed.

Conversation comment      ONLY if prefixed         "Rework: fix the
starting with             with "Rework:"           validation logic"
"Rework:"                 (case-insensitive)       triggers rework.

Conversation comment      NEVER                    "Looks good but
without prefix                                     consider adding
                                                   tests" is treated
                                                   as discussion only.

System/bot comment        NEVER                    GitLab: note.system
                          (GitLab only             === true is skipped.
                           filters these)          Other platforms: no
                                                   explicit filter yet.

Comment by token owner    NEVER (PLANNED)          Filter out
                                                   authenticated user's
                                                   own comments to
                                                   prevent self-trigger.
```

---

## Part 3: Rework Execution Flow

### Master Rework Execution Flow Diagram

```
┌──────────────────────────────────────────────┐
│  run() — Rework path                         │
│                                              │
│  Entered when fetchReworkFromPrReview()       │
│  returns a result.                           │
│                                              │
│  Sets: isRework = true                       │
│        ticket = prRework.ticket              │
│        prFeedback = prRework.feedback         │
│                                              │
│  Print: "PR rework: [{KEY}] {Title}"         │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 5a: MAX REWORK GUARD                   │
│                                              │
│  maxRework = parseInt(CLANCY_MAX_REWORK)     │
│    default: 3, must be finite and > 0        │
│                                              │
│  cycles = countReworkCycles(cwd, key)         │
│    counts ALL entries with status REWORK     │
│    for this key (not just latest)            │
│                                              │
│  cycles >= maxRework?                        │
│       |                                      │
│  +----+----+                                 │
│  Yes       No                                │
│  |         |                                 │
│  v         v                                 │
│ SKIPPED  Continue                            │
│ "{KEY}                                       │
│  has                                         │
│  reached                                     │
│  max rework                                  │
│  cycles                                      │
│  ({maxRework})                               │
│  — needs                                     │
│  human                                       │
│  intervention"                               │
│ Return early.                                │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 6: COMPUTE BRANCHES                    │
│                                              │
│  ticketBranch = computeTicketBranch(         │
│    provider, key)                            │
│    Jira/Linear: feature/{key-lowercase}      │
│    GitHub: feature/issue-{number}            │
│                                              │
│  targetBranch = computeTargetBranch(         │
│    provider, baseBranch, parent)             │
│    parent is always undefined for rework     │
│    (parentInfo = 'none')                     │
│    -> target = baseBranch (e.g. main)        │
│                                              │
│  Note: rework tickets always target the base │
│  branch, never an epic branch. This is by    │
│  design — rework is only for PR flow.        │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 7: DRY-RUN GATE                        │
│                                              │
│  If --dry-run:                               │
│    Print "Mode: Rework" in dry-run output    │
│    Return early (no changes)                 │
│                                              │
│  Otherwise: continue                         │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 9: FEASIBILITY CHECK — SKIPPED         │
│                                              │
│  Rework ALWAYS skips feasibility check.      │
│  Guard: if (!isRework && !skipFeasibility)   │
│                                              │
│  Rationale: rework addresses reviewer        │
│  feedback on already-implemented work.       │
│  Feasibility was already checked during      │
│  initial implementation.                     │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 10: BRANCH SETUP                       │
│  (DIFFERENT from normal flow)                │
│                                              │
│  Normal flow:                                │
│    ensureBranch(target, base)                │
│    checkout(target)                          │
│    checkout(ticketBranch, true) // -B flag    │
│                                              │
│  Rework flow:                                │
│    ensureBranch(target, base)                │
│    fetched = fetchRemoteBranch(ticketBranch)  │
│      -> git fetch origin {branch}:{branch}   │
│                                              │
│    fetched?                                  │
│    +----+----+                               │
│    Yes       No                              │
│    |         |                               │
│    v         v                               │
│  checkout  checkout(target)                  │
│  (ticket   checkout(ticket, true) // -B      │
│   Branch)  Create fresh from target          │
│                                              │
│  Why: rework needs the EXISTING branch with  │
│  prior implementation, not a fresh branch.   │
│  fetchRemoteBranch tries to get the latest   │
│  state from origin. Falls back to fresh      │
│  branch if remote branch was deleted.        │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 11: TRANSITION TO IN PROGRESS          │
│                                              │
│  Same as normal flow.                        │
│  If CLANCY_STATUS_IN_PROGRESS is set:        │
│    transitionToStatus(config, ticket, status)│
│  Best-effort — failure doesn't stop flow.    │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 12: BUILD REWORK PROMPT                │
│                                              │
│  buildReworkPrompt({                         │
│    key, title, description,                  │
│    provider,                                 │
│    feedbackComments: prFeedback ?? [],        │
│    previousContext: git diff output (PLANNED)│
│  })                                          │
│                                              │
│  Prompt structure:                           │
│  ─────────────────────────────────────       │
│  "You are fixing review feedback on          │
│   [{key}] {title}.                           │
│                                              │
│   Description:                               │
│   {description}                              │
│                                              │
│   ## Reviewer Feedback                       │
│                                              │
│   1. {comment1}                              │
│   2. {comment2}                              │
│   ...                                        │
│                                              │
│   [## Previous Implementation]               │
│   [```{previousContext}```]                   │
│                                              │
│   Address the specific feedback above.       │
│   Don't re-implement unrelated areas.        │
│   Focus only on what was flagged.            │
│                                              │
│   Steps:                                     │
│   1. Read core docs...                       │
│   2. Follow GIT.md conventions               │
│   3. Fix the issues identified               │
│   4. Commit your work                        │
│   5. Confirm you are finished."              │
│  ─────────────────────────────────────       │
│                                              │
│  Empty feedback:                             │
│    "No reviewer comments found. Review the   │
│     existing implementation and fix any       │
│     issues."                                 │
│                                              │
│  previousContext (PLANNED):                  │
│    Populated with git diff of branch vs      │
│    target branch. Gives Claude context about │
│    what was previously implemented.          │
│                                              │
│  Differences from normal prompt:             │
│    - No executability check                  │
│    - No parent/epic/blocker info             │
│    - Includes numbered reviewer feedback     │
│    - Focused instruction: "Don't re-implement│
│      unrelated areas"                        │
│    - Shorter steps (no skip handling)        │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 12b: INVOKE CLAUDE SESSION             │
│                                              │
│  invokeClaudeSession(prompt, model)          │
│  Same as normal flow.                        │
│                                              │
│  Claude reads the feedback, examines the     │
│  existing code on the branch, and makes      │
│  targeted fixes.                             │
│                                              │
│  On failure: "Claude session exited with an  │
│  error. Skipping merge." Return early.       │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 13: DELIVER VIA PR (REWORK)            │
│                                              │
│  Always calls deliverViaPullRequest().       │
│  NEVER epic merge for rework.               │
│                                              │
│  deliverViaPullRequest() logs:               │
│    PR_CREATED or PUSHED (etc.)               │
│    (this is the DOUBLE-LOGGING issue)        │
│                                              │
│  FIX (PLANNED):                             │
│    deliverViaPullRequest should NOT log      │
│    when called for rework. Pass a flag       │
│    or have run() handle all logging.         │
│                                              │
│  Then run() OVERRIDES with:                  │
│    appendProgress(... 'REWORK')              │
│                                              │
│  This means progress.txt gets 2 entries      │
│  for each rework cycle. The REWORK entry     │
│  becomes "latest" for the key.              │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 13b: POST-REWORK ACTIONS (PLANNED)     │
│                                              │
│  After successful rework push:               │
│                                              │
│  1. Leave PR comment:                        │
│     "Rework pushed addressing N feedback     │
│      items: {brief summary}"                 │
│                                              │
│  2. Platform-specific:                       │
│     GitHub:                                  │
│       Re-request review from the reviewer    │
│       who left feedback.                     │
│       POST /repos/{repo}/pulls/{number}/     │
│         requested_reviewers                  │
│       Body: {"reviewers": ["{username}"]}    │
│                                              │
│     GitLab:                                  │
│       Resolve addressed DiffNote threads.    │
│       PUT /projects/{id}/merge_requests/     │
│         {iid}/discussions/{id}/resolve       │
│       Body: {"resolved": true}               │
│                                              │
│     Bitbucket Cloud:                         │
│       No resolution API. Comment only.       │
│                                              │
│     Bitbucket Server:                        │
│       No resolution API. Comment only.       │
│                                              │
│  3. Transition board ticket to In Review:    │
│     CLANCY_STATUS_REVIEW (existing)          │
│     Already done by deliverViaPullRequest()  │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 14: COMPLETION                         │
│                                              │
│  Print: "{KEY} complete ({elapsed})"         │
│  Send notification if CLANCY_NOTIFY_WEBHOOK  │
│  is configured.                              │
└──────────────────────────────────────────────┘
```

### Rework Cycle Lifecycle (Complete)

```
CYCLE 1: Initial implementation
══════════════════════════════════════════════════════════════════════
  /clancy:once detects ticket with no parent
    -> implements on feature/proj-123
    -> pushBranch()
    -> createPullRequest()
    -> progress: PR_CREATED
    -> ticket transitions to In Review

  Reviewer leaves inline comment + "Rework: fix error handling"

CYCLE 2: First rework
══════════════════════════════════════════════════════════════════════
  /clancy:once runs again
    -> fetchReworkFromPrReview() scans progress.txt
    -> finds PROJ-123 with status PR_CREATED
    -> checks PR: changesRequested = true
    -> fetches comments: ["[src/api.ts] Missing try-catch",
                          "fix error handling"]
    -> sets isRework = true
    -> max rework guard: cycles=0, max=3, ok
    -> fetchRemoteBranch(feature/proj-123) succeeds
    -> checkout(feature/proj-123)
    -> buildReworkPrompt() with feedback
    -> Claude fixes the issues
    -> pushBranch() (updates existing remote branch -> PR updates)
    -> progress: PR_CREATED (from deliverViaPullRequest)
    -> progress: REWORK (override from run())
    -> post-rework: comment + re-request review (PLANNED)

  Reviewer resolves inline comment (GitLab) or
  leaves new "Rework: also fix the tests"

CYCLE 3: Second rework
══════════════════════════════════════════════════════════════════════
  (same as cycle 2, but cycles=1)
  ...

CYCLE 4: Max rework reached (if max=3)
══════════════════════════════════════════════════════════════════════
  /clancy:once runs
    -> finds PROJ-123, changesRequested = true
    -> max rework guard: cycles=3, max=3
    -> SKIPPED: "needs human intervention"
    -> no further automated rework

TERMINAL: PR approved and merged
══════════════════════════════════════════════════════════════════════
  Reviewer approves PR, merges on platform.
  GitHub: "Closes #N" auto-closes the issue.
  Jira/Linear: manual transition to Done
    (or use CLANCY_STATUS_DONE).
  Next /clancy:once run: ticket not a candidate
    (latest status is REWORK, but PR is no longer open,
     so checkPrReviewState returns undefined).
```

---

## Part 4: Error Flows

### Push Failure Flow

```
pushBranch(ticketBranch) fails
       |
       v
  Possible causes:
    - No network connectivity
    - Remote rejected (force push protection)
    - Authentication expired
    - Remote repository moved/deleted
    - Disk quota exceeded on remote
       |
       v
  ┌─────────────────────────────────────────┐
  │ Handle:                                  │
  │   1. Print warning with manual command   │
  │   2. Log PUSH_FAILED to progress.txt     │
  │   3. Checkout target branch              │
  │   4. Print elapsed time                  │
  │   5. Return false -> caller returns      │
  │                                          │
  │ User recovery:                           │
  │   git push -u origin {branch}            │
  │   Then wait for next /clancy:once run    │
  │   to detect rework (branch pushed ->     │
  │   PUSH_FAILED is now a candidate).       │
  │                                          │
  │ Note: PUSH_FAILED is scanned as a        │
  │ rework candidate (PLANNED), so the next  │
  │ run will try to detect review state.     │
  │ If user manually pushes and gets PR      │
  │ review, rework can still be detected.    │
  └─────────────────────────────────────────┘
```

### PR Creation Failure Flow

```
attemptPrCreation() returns error
       |
       v
  Possible causes:
    - Invalid token / insufficient permissions
    - Branch protection rules prevent PR
    - Rate limit exceeded (HTTP 429)
    - Server error (HTTP 5xx)
    - Network timeout (30s AbortController)
    - Repository not found (HTTP 404)
       |
       v
  ┌─────────────────────────────────────────┐
  │ Handle:                                  │
  │   1. Print error message from API        │
  │   2. Build manual PR URL (if possible)   │
  │   3. Print manual URL or fallback msg    │
  │   4. Log PUSHED to progress.txt          │
  │                                          │
  │ User recovery:                           │
  │   Click manual URL to create PR in       │
  │   browser. Rework detection will work    │
  │   because PUSHED is a candidate status   │
  │   (PLANNED) and the PR exists.           │
  │                                          │
  │ Already-exists (special case):           │
  │   HTTP 422 (GitHub) or 409 (others)      │
  │   + "already exists" in body             │
  │   -> Not an error, just a note           │
  │   -> Log PUSHED                          │
  │   -> Rework detection works because      │
  │      the existing PR is open             │
  └─────────────────────────────────────────┘
```

### Comment Fetch Failure Flow

```
fetchPrReviewComments() fails or returns []
       |
       v
  Possible causes:
    - API rate limit
    - Network error
    - Token expired between check and fetch
    - PR closed between check and fetch
       |
       v
  ┌─────────────────────────────────────────┐
  │ Handle:                                  │
  │   Returns empty array [].                │
  │   Rework proceeds with empty feedback.   │
  │   Prompt says: "No reviewer comments     │
  │   found. Review the existing             │
  │   implementation and fix any issues."    │
  │                                          │
  │ This is intentional — better to attempt  │
  │ a review of existing code than to skip   │
  │ rework entirely. Claude will examine     │
  │ the codebase and potentially find the    │
  │ same issues the reviewer flagged.        │
  └─────────────────────────────────────────┘
```

### Connectivity Failure Flow (PLANNED)

```
Preflight: git ls-remote origin HEAD
       |
       v
  ┌─────────────────────────────────────────┐
  │ WARNING-ONLY check. Does NOT block.      │
  │                                          │
  │ Success:                                 │
  │   Continue silently.                     │
  │                                          │
  │ Failure:                                 │
  │   Print warning:                         │
  │   "Could not reach origin. PR creation   │
  │    and rework detection may fail.        │
  │    Continuing anyway."                   │
  │                                          │
  │ Rationale: user may be implementing      │
  │ for local-only use. Blocking would be    │
  │ wrong. Push/PR steps already handle      │
  │ their own failures gracefully.           │
  └─────────────────────────────────────────┘
```

### Remote Detection Failure Flow

```
detectRemote() returns { host: 'none' }
       |
       v
  Possible causes:
    - No git remote configured
    - git remote get-url origin fails
    - Empty URL returned
       |
       v
  During PR creation:
    -> Log LOCAL, print message
    -> Branch available locally only

  During rework detection:
    -> Return undefined silently
    -> Fall through to fresh ticket
    -> No rework possible without remote
```

### Timestamp Conversion Edge Cases

```
Progress timestamp: "YYYY-MM-DD HH:MM" (UTC after fix)
       |
       v
  new Date("YYYY-MM-DDTHH:MM")
       |
  +----+----+
  Valid      Invalid
  |          |
  v          v
  .toISO   since = undefined
  String()  (no filtering — all comments
  -> use    checked, may re-trigger old
  as since  rework, but this is rare edge
            case with malformed progress.txt)

  Minute-level precision:
    A comment created in the same minute
    as the progress entry could be missed
    or included. Acceptable — unlikely
    race condition in practice.

  Timezone handling (after UTC fix):
    All timestamps stored in UTC.
    No ambiguity between machines in
    different timezones. Eliminates
    the current bug where local time
    timestamps cause since filtering
    to be off by hours.
```

---

## Part 5: Platform Comparison Tables

### Authentication

```
Platform              Auth method           Header
────────────────────────────────────────────────────────────────────
GitHub                Bearer token          Authorization: Bearer {token}
GitLab                Private token         PRIVATE-TOKEN: {token}
Bitbucket Cloud       HTTP Basic Auth       Authorization: Basic {base64(user:token)}
Bitbucket Server      Bearer token          Authorization: Bearer {token}
```

### PR Creation API

```
Platform              Endpoint                          Body format
────────────────────────────────────────────────────────────────────
GitHub                POST /repos/{repo}/pulls          { title, head, base, body }

GitLab                POST /projects/{encoded}/         { source_branch, target_branch,
                        merge_requests                    title, description,
                                                          remove_source_branch: true }

Bitbucket Cloud       POST /repositories/{ws}/{slug}/   { title, description,
                        pullrequests                      source: { branch: { name } },
                                                          destination: { branch: { name } },
                                                          close_source_branch: true }

Bitbucket Server      POST /projects/{key}/repos/       { title, description,
                        {slug}/pull-requests              fromRef: { id: "refs/heads/..." },
                                                          toRef: { id: "refs/heads/..." } }
```

### Already-Exists Detection

```
Platform              HTTP status    Body check
────────────────────────────────────────────────────────────────────
GitHub                422            "already exists"
GitLab                409            "already exists"
Bitbucket Cloud       409            "already exists"
Bitbucket Server      409            "already exists"
```

### Review State Checking: Comment Sources

```
Platform              Inline source                    Conversation source
────────────────────────────────────────────────────────────────────
GitHub                GET /pulls/{n}/comments           GET /issues/{n}/comments
                      (fetched in parallel)             (fetched in parallel)

GitLab                GET /merge_requests/{iid}/        (same endpoint — discussions
                        discussions                      contain both DiffNote and
                                                         regular notes)

Bitbucket Cloud       GET /pullrequests/{id}/comments   (same endpoint — distinguished
                                                         by c.inline != null)

Bitbucket Server      GET /pull-requests/{id}/           (same endpoint — distinguished
                        activities                       by comment.anchor != null)
```

### Inline Comment Detection

```
Platform              How inline is identified           Path source
────────────────────────────────────────────────────────────────────
GitHub                Separate endpoint                  comment.path
                      (/pulls/{n}/comments)

GitLab                note.type === 'DiffNote'           note.position.new_path
                      + resolvable !== false
                      + resolved !== true

Bitbucket Cloud       comment.inline != null             comment.inline.path

Bitbucket Server      comment.anchor != null             comment.anchor.path
```

### Since Filtering

```
Platform              Mechanism          Comparison         Edge case
────────────────────────────────────────────────────────────────────
GitHub                Server-side        &since={iso}       Reliable — API
                      query param        on both endpoints  handles filtering

GitLab                Client-side        note.created_at    String comparison
                      string compare     <= since -> skip   ISO 8601 is
                                                            lexicographically
                                                            sortable. Exact
                                                            match excluded.

Bitbucket Cloud       Client-side        c.created_on       String comparison.
                      string compare     > since -> include Exact match
                                                            excluded.

Bitbucket Server      Client-side        comment.createdDate Epoch ms via
                      epoch ms           > sinceMs           Date.parse(since).
                      comparison                             Exact match
                                                             excluded.
```

### Comment Resolution Capability

```
Platform              Can dismiss inline feedback?        Mechanism
────────────────────────────────────────────────────────────────────
GitHub                NO (via comments)                   Cannot resolve
                      YES (via review state) — PLANNED    individual PR
                      additional signal: "Request         comments. Only
                      Changes" review state               since filtering
                                                          prevents re-trigger.

GitLab                YES                                 resolved !== true
                                                          check on DiffNotes.
                                                          Reviewer resolves
                                                          thread -> no rework.
                                                          POST-REWORK: Clancy
                                                          resolves addressed
                                                          threads (PLANNED).

Bitbucket Cloud       NO                                  No resolution API.
                                                          since filtering only.

Bitbucket Server      NO                                  No resolution API.
                                                          since filtering only.
```

### PR Body: Board Link Format

```
Platform              Link format                        Auto-close?
────────────────────────────────────────────────────────────────────
GitHub board          Closes #N                          YES (on merge)
Jira board            **Jira:** [KEY](URL/browse/KEY)   NO (manual)
Linear board          **Linear:** KEY                    NO (manual)
```

### Manual PR URL Format

```
Platform              URL template                                    Available?
────────────────────────────────────────────────────────────────────────────────
GitHub                https://{host}/{owner}/{repo}/compare/          YES
                        {target}...{branch}

GitLab                https://{host}/{project}/-/merge_requests/new?  YES
                        merge_request[source_branch]={branch}&
                        merge_request[target_branch]={target}

Bitbucket Cloud       https://{host}/{ws}/{slug}/pull-requests/new?   YES
                        source={branch}&dest={target}

Bitbucket Server      PLANNED: https://{host}/projects/{key}/repos/   NO (returns
                        {slug}/pull-requests?create&sourceBranch=       undefined)
                        refs/heads/{branch}&targetBranch=
                        refs/heads/{target}
```

### Post-Rework Actions (PLANNED)

```
Platform              PR comment    Re-request review    Resolve threads
────────────────────────────────────────────────────────────────────
GitHub                YES           YES                  NO (cannot
                      POST /issues/ POST /pulls/{n}/     resolve PR
                        {n}/comments  requested_reviewers comments via
                                    {"reviewers":        API)
                                     ["{username}"]}

GitLab                YES           NO (automatic        YES
                      POST /merge_  when new commits     PUT /discussions/
                        requests/   pushed)              {id}/resolve
                        {iid}/notes                      {"resolved": true}

Bitbucket Cloud       YES           NO (no API)          NO (no API)
                      POST /pull-
                        requests/
                        {id}/comments

Bitbucket Server      YES           NO (no API)          NO (no API)
                      POST /pull-
                        requests/
                        {id}/comments
```

---

## Part 6: Progress Log Format

### Line Format

```
Current format:
  YYYY-MM-DD HH:MM | TICKET-KEY | Summary text | STATUS

Planned format (with optional PR number):
  YYYY-MM-DD HH:MM | TICKET-KEY | Summary text | STATUS | pr:123

The pr:NNN field is:
  - Optional — backward compatible with existing entries
  - Only present for PR_CREATED and REWORK statuses
  - Stores the PR/MR number for quick lookup
  - Avoids re-discovering the PR number on each rework scan
```

### Timestamp Format

```
Current:  YYYY-MM-DD HH:MM (local time)
Planned:  YYYY-MM-DD HH:MM (UTC)

Change: formatTimestamp() uses getUTCFullYear(), getUTCMonth(),
  getUTCDate(), getUTCHours(), getUTCMinutes() instead of
  local equivalents.

Impact: since filtering becomes timezone-safe.
  No ambiguity between machines in different timezones.
  Progress.txt is human-readable (UTC is universally understood).
```

### All Status Values

```
STATUS          MEANING                     LOGGED BY              REWORK
                                                                   CANDIDATE?
────────────────────────────────────────────────────────────────────────────────
PR_CREATED      PR/MR created successfully  deliverViaPullRequest  YES
PUSHED          Branch pushed, PR skipped   deliverViaPullRequest  YES (PLANNED)
PUSH_FAILED     git push failed             deliverViaPullRequest  YES (PLANNED)
LOCAL           No remote configured        deliverViaPullRequest  NO
DONE            Epic merge completed        deliverViaEpicMerge    NO
SKIPPED         Feasibility failed / max    run()                  NO
                rework reached
REWORK          Rework cycle completed      run()                  YES
PLAN            Plan generated              planner                NO
APPROVE         Plan approved               planner                NO
```

### Progress Log Examples

```
# Initial implementation -> PR
2026-03-16 14:30 | PROJ-123 | Add login page | PR_CREATED | pr:42

# Reviewer requests changes, rework triggered
# (double-logging: PR_CREATED then REWORK override)
2026-03-16 16:45 | PROJ-123 | Add login page | PR_CREATED | pr:42
2026-03-16 16:45 | PROJ-123 | Add login page | REWORK | pr:42

# Second rework
2026-03-17 09:15 | PROJ-123 | Add login page | PR_CREATED | pr:42
2026-03-17 09:15 | PROJ-123 | Add login page | REWORK | pr:42

# After fix: only REWORK logged (no double-logging)
2026-03-17 09:15 | PROJ-123 | Add login page | REWORK | pr:42

# Max rework reached
2026-03-17 11:00 | PROJ-123 | Add login page | SKIPPED

# Push failure scenario
2026-03-16 14:30 | PROJ-456 | Fix search bug | PUSH_FAILED

# Manual push, PR created manually, reviewer comments
# -> next run detects PUSH_FAILED, checks PR, finds rework
2026-03-16 15:00 | PROJ-456 | Fix search bug | REWORK | pr:43

# Local-only (no rework possible)
2026-03-16 14:30 | ENG-99 | Update configs | LOCAL
```

### Parsing Rules

```
parseProgressFile():
  - Split on newline
  - Skip empty/whitespace-only lines
  - Split on ' | '
  - Require at least 4 parts
  - parts[0] = timestamp
  - parts[1] = key
  - parts.slice(2, -1).join(' | ') = summary
    (handles summaries containing ' | ')
  - parts[parts.length - 1] = status
  - PLANNED: parse optional pr:NNN from status field
    or from trailing 5th part

findEntriesWithStatus():
  - Parse all entries
  - Build Map<key, entry> (latest wins per key)
  - Filter to entries with requested status
  - Returns array

countReworkCycles():
  - Parse all entries
  - Count ALL entries (not just latest) matching
    key + status === 'REWORK'
  - Case-insensitive key matching
```

### Double-Logging Behavior

```
Current behavior (BUG):
  deliverViaPullRequest() logs PR_CREATED or PUSHED
  run() then logs REWORK

  Progress.txt for one rework cycle:
    14:30 | PROJ-123 | Add login page | PR_CREATED
    14:30 | PROJ-123 | Add login page | REWORK

  countReworkCycles = 1 (counts REWORK entries)
  findEntriesWithStatus('REWORK') finds it (latest = REWORK)
  findEntriesWithStatus('PR_CREATED') does NOT find it (latest = REWORK)

  Functionally correct but clutters the log.

Planned fix:
  deliverViaPullRequest() accepts a skipLog parameter.
  When called from rework path: skipLog = true.
  Only run() logs REWORK.

  Progress.txt for one rework cycle:
    14:30 | PROJ-123 | Add login page | REWORK | pr:42
```
