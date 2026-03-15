# Planner Role — Visual Flows (All Platforms)

Comprehensive visual flow reference for `/clancy:plan` and `/clancy:approve-plan` across GitHub Issues, Jira Cloud, and Linear. Every scenario, every edge case, every platform difference.

---

## Table of Contents

1. [Command Input Resolution](#part-1-command-input-resolution)
2. [/clancy:plan Complete Flow](#part-2-clancyplan-complete-flow)
3. [/clancy:approve-plan Complete Flow](#part-3-clancyapprove-plan-complete-flow)
4. [Re-plan Flow (Auto-detect Feedback)](#part-4-re-plan-flow-auto-detect-feedback)
5. [Error Flows](#part-5-error-flows)
6. [Batch Mode](#part-6-batch-mode)
7. [Platform Comparison Tables](#part-7-platform-comparison-tables)

---

## Part 1: Command Input Resolution

### /clancy:plan Invocations

```
INVOCATION                                    RESOLVED MODE
────────────────────────────────────────────────────────────────────
/clancy:plan                               -> Plan 1 ticket from queue
/clancy:plan 3                             -> Batch mode (3 tickets from queue)
/clancy:plan PROJ-123                      -> Plan specific ticket (Jira)
/clancy:plan #42                           -> Plan specific ticket (GitHub)
/clancy:plan ENG-42                        -> Plan specific ticket (Linear)
/clancy:plan --fresh                       -> Plan 1 ticket, ignore existing plan
/clancy:plan --fresh PROJ-123              -> Re-plan specific ticket from scratch
/clancy:plan PROJ-123 --fresh              -> Same (order doesn't matter)
/clancy:plan 3 --fresh                     -> Batch 3, treat all as fresh
```

### Input Parsing Decision Tree

```
/clancy:plan <input>
       |
       v
  Parse <input>
       |
       +-- No input?
       |     |
       |     v
       |   Plan 1 ticket from queue
       |   (default mode)
       |
       +-- Bare positive integer? (e.g. "3")
       |     |
       |     +-- Board = GitHub? -> Ambiguous: could be issue #3 or batch 3
       |     |     |               Ask: "Did you mean issue #3 or batch 3 tickets?"
       |     +-- Board = Jira?   -> Batch mode (plan 3 tickets from queue)
       |     +-- Board = Linear? -> Batch mode (plan 3 tickets from queue)
       |     |
       |     v
       |   N > 10?
       |     |
       |   +-+-------+
       |   Yes       No
       |   |         |
       |   v         v
       |  "Maximum  N >= 5?
       |   batch     |
       |   size is +-+-------+
       |   10.     Yes       No
       |   Planning |         |
       |   10."    v         v
       |   (cap)  Confirm:  Continue
       |          "Planning
       |           {N} tickets
       |           — each requires
       |           codebase
       |           exploration.
       |           Continue? [Y/n]"
       |
       +-- Matches #\d+ ? (e.g. "#42")
       |     |
       |     +-- Board = GitHub? -> Plan specific issue #42
       |     +-- Board = Jira?   -> ERROR: "#42 looks like a GitHub issue.
       |     |                      Jira uses PROJ-123 format."
       |     +-- Board = Linear? -> ERROR: "#42 looks like a GitHub issue.
       |                            Linear uses ENG-42 format."
       |
       +-- Matches [A-Z][A-Z0-9]+-\d+ ? (e.g. "PROJ-123" or "ENG-42")
       |     |
       |     +-- Board = GitHub? -> ERROR: "PROJ-123 doesn't look like a
       |     |                      GitHub issue. Use #42 format."
       |     +-- Board = Jira?   -> Plan specific ticket PROJ-123
       |     +-- Board = Linear? -> Plan specific ticket ENG-42
       |
       +-- --fresh flag present?
             |
             v
           Parsed alongside any of the above.
           Sets freshMode = true.
           Combined: "/clancy:plan 3 --fresh" = batch 3 in fresh mode.
           Combined: "/clancy:plan PROJ-123 --fresh" = specific ticket, fresh.
```

### Input Validation per Platform

```
GitHub                         Jira                           Linear
──────────────────────────     ──────────────────────────     ──────────────────────────
Valid:                         Valid:                         Valid:
  #42, #1, #9999                PROJ-123, ABC-1                ENG-42, DES-15, QA-1
                                                              (pattern: [A-Z]{1,10}-\d+)

Invalid:                       Invalid:                       Invalid:
  #0        -> "Must be >= 1"   proj-123 -> "Expected          eng42  -> "Missing hyphen.
  #abc      -> "Not a number"     PROJ-123"                      Use ENG-42 format."
  #-5       -> "Must be >= 1"   200      -> "Expected           42   -> "Use ENG-42
  PROJ-123  -> "Use #N format"    PROJ-123"                      format."
  ENG-42    -> "Use #N format"  ENG-42   -> "Not a Jira key"   #42  -> "Use ENG-42
                                                                  format."
```

### /clancy:approve-plan Invocations

```
INVOCATION                                    RESOLVED SELECTION
────────────────────────────────────────────────────────────────────
/clancy:approve-plan                       -> Auto-select oldest planned-but-unapproved
/clancy:approve-plan PROJ-123              -> Approve specific ticket (Jira)
/clancy:approve-plan #42                   -> Approve specific ticket (GitHub)
/clancy:approve-plan ENG-42               -> Approve specific ticket (Linear)
```

### approve-plan Selection Decision Tree

```
/clancy:approve-plan <arg>
       |
       v
  <arg> provided?
       |
  +----+----+
  Yes       No
  |         |
  v         v
Parse     Scan .clancy/progress.txt for entries:
<arg>       matching "| PLAN |" but no subsequent
(validate   "| APPROVE |" for same key.
 format     Order by timestamp ascending (oldest first).
 per             |
 platform)       v
  |         How many unapproved plans?
  |              |
  |         +----+----+
  |         0         1+
  |         |         |
  |         v         v
  |      "No planned Auto-select oldest:
  |       tickets    "Auto-selected [{KEY}] {Title}.
  |       awaiting    Promote? [Y/n]"
  |       approval.        |
  |       Run             +--+----+
  |       /clancy:plan     Y       N
  |       first."          |       |
  |       (stop)           v       v
  |                     Continue  "Cancelled."
  |                     to         (stop)
  |                     approval
  |                     flow
  |
  v
Validate ticket key format
(same rules as /clancy:plan)
       |
       v
  Continue to approval flow (Step 3)
```

### approve-plan: What Happens After Selection

```
Ticket key resolved
       |
       v
  Fetch comments for ticket
       |
       v
  Plan comment found? (## Clancy Implementation Plan)
       |
  +----+----+
  No        Yes
  |         |
  v         v
"No Clancy Continue to
plan found  confirmation
for {KEY}.  (Step 4)
Run
/clancy:plan
first."
(stop)
```

---

## Part 2: /clancy:plan Complete Flow

### Master Flow Diagram

```
┌──────────────────────────────────────────────┐
│  /clancy:plan <input>                        │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 1: PREFLIGHT                           │
│                                              │
│  1a. .clancy/.env exists?                    │
│      NO -> "Run /clancy:init first" (stop)   │
│      YES -> parse env, detectBoard()         │
│                                              │
│  1b. Credentials valid?                      │
│      Check board-specific creds present      │
│      FAIL -> "Check credentials" (stop)      │
│                                              │
│  1c. CLANCY_ROLES includes planner?          │
│      (or unset for global) -> continue       │
│      Planner not enabled -> stop             │
│                                              │
│  1d. Codebase docs exist?                    │
│      .clancy/docs/ empty or missing?         │
│      YES -> Warn (see below)                 │
│      NO  -> continue                         │
└──────────────────────┬───────────────────────┘
                       │
                  Docs warning?
                       │
              +────────+────────+
              |                 |
           No docs           Docs exist
              |                 |
              v                 |
   "Plans will be less         |
    accurate without           |
    codebase context.          |
    Run /clancy:map-codebase   |
    first for better results.  |
    Continue anyway? [y/N]"    |
              |                 |
         +----+----+            |
         y         N            |
         |         |            |
         v         v            |
      Continue   Stop           |
      (degraded)                |
              |                 |
              +─────────────────+
                       |
                       v
┌──────────────────────────────────────────────┐
│  Step 1e: BRANCH FRESHNESS CHECK             │
│                                              │
│  git fetch origin                            │
│  Compare HEAD with origin/$CLANCY_BASE_BRANCH│
│  (or origin/main if unset)                   │
└──────────────────────┬───────────────────────┘
                       │
                  Freshness?
                       │
          +────────────+────────────+
          |            |            |
          v            v            v
       Behind       Up to date   No remote
          |            |            |
          v            |            v
   "Behind by N        |       Continue
    commits.           |       (warn: no
    Planning on        |       remote
    stale code may     |       tracking)
    produce            |
    inaccurate         |
    plans."            |
          |            |
    [1] Pull latest    |
    [2] Continue       |
    [3] Abort          |
          |            |
    +--+--+--+         |
    |  |     |         |
    v  v     v         |
  Pull Continue Abort  |
  then   (note   (stop)|
  continue stale)      |
          |            |
          +────────────+
                       |
                       v
┌──────────────────────────────────────────────┐
│  Step 2: PARSE ARGUMENTS                     │
│  (see Part 1 decision tree)                  │
│                                              │
│  Resolve: count, ticketKey, freshMode        │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 3: FETCH TICKETS                       │
│                                              │
│  Specific ticket provided?                   │
│    YES -> Fetch single ticket by key         │
│    NO  -> Fetch N from planning queue        │
│                                              │
│  (platform-specific — see below)             │
└──────────────────────┬───────────────────────┘
                       │
                  Tickets found?
                       │
              +────────+────────+
              |                 |
              0                 1+
              |                 |
              v                 v
      "Nothing to see     Continue
       here." (stop,
       board-specific
       guidance)
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 3b: CHECK FOR EXISTING PLANS           │
│                                              │
│  For each ticket, scan comments for          │
│  "## Clancy Implementation Plan" marker      │
│                                              │
│  Specific ticket mode:                       │
│    Has plan + auto-detect feedback? -> 3c    │
│    Has plan + --fresh? -> skip to Step 4     │
│    Has plan + no feedback? -> "Already       │
│      planned. Add feedback to revise."       │
│    No plan -> Step 4                         │
│                                              │
│  Queue mode (no specific ticket):            │
│    Has plan + no --fresh? -> skip ticket     │
│    Has plan + --fresh? -> proceed (fresh)    │
│    No plan -> Step 4                         │
└──────────────────────┬───────────────────────┘
                       │
              Existing plan + feedback detected?
                       │
              +────────+────────+
              |                 |
              No                Yes
              |                 |
              v                 v
           Step 4          Step 3c
           (fresh plan)    (read feedback)
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 3c: READ FEEDBACK COMMENTS             │
│  (auto-detected or --fresh with prior plan)  │
│                                              │
│  Find most recent plan comment timestamp.    │
│  Collect all comments posted AFTER it.       │
│  These are presumed to be PO/team feedback.  │
│  No special syntax needed.                   │
│                                              │
│  --fresh mode? -> Ignore feedback, start     │
│                   from scratch               │
│  Auto-detect? -> Pass feedback to Step 4f    │
│                  for revision                │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4: FOR EACH TICKET — GENERATE PLAN     │
│                                              │
│  Display header:                             │
│    "Clancy — Plan"                           │
│    "Let me consult my crime files..."        │
│    "Planning {N} ticket(s)."                 │
│                                              │
│  Per-ticket progress:                        │
│    [{KEY}] {Title}                           │
│      Exploring codebase...                   │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4a: RELEVANCE / FEASIBILITY CHECK      │
│                                              │
│  Scan ticket title + description for         │
│  non-codebase signals BEFORE exploration.    │
│                                              │
│  Fail signals (skip immediately):            │
│    - External platform refs (GTM, Salesforce,│
│      AWS console, HubSpot, Jira admin)       │
│    - Human process (get sign-off, coordinate,│
│      schedule meeting, send email)           │
│    - Non-code deliverables (runbook,         │
│      presentation, wiki update)              │
│    - Infra ops (rotate keys in prod, scale   │
│      fleet, restart service)                 │
│                                              │
│  Pass signals:                               │
│    - Code, components, features, bugs, UI,   │
│      API, tests, refactoring                 │
│    - Ambiguous = benefit of the doubt (pass) │
└──────────────────────┬───────────────────────┘
                       │
                  Relevant?
                       │
              +────────+────────+
              |                 |
              No                Yes
              |                 |
              v                 v
      Post skip comment    Continue
      on board ticket      to 4b
      (see below)
              |
              v
      Log as SKIPPED
      in progress.txt
              |
              v
      Display:
      "[{KEY}] {Title}
       — not a codebase
       change. Skipping.
       -> {reason}"
              |
              v
      Next ticket
      (or stop if
       single mode)


  Skip comment (posted to board):
  ──────────────────────────────────────────────

    "Clancy skipped this ticket: {reason}

     This ticket appears to require work outside
     the codebase (e.g. {specific signal}).
     If this is incorrect, add more context to
     the ticket description and re-run /clancy:plan."

  Opt-out: set CLANCY_SKIP_COMMENTS=false in
  .clancy/.env to disable skip comments.

  Default: enabled (comments are posted).
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4b: QA RETURN DETECTION                │
│                                              │
│  Check .clancy/progress.txt for:             │
│    "{KEY}" on a line containing "| DONE"     │
│                                              │
│  Found?                                      │
│    YES -> Flag as QA return.                 │
│           Read QA/review comments.           │
│           Focus plan on likely failures.     │
│    NO  -> Treat as fresh ticket.             │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4c: READ CODEBASE CONTEXT              │
│                                              │
│  If .clancy/docs/ exists, read:              │
│    STACK.md, ARCHITECTURE.md, CONVENTIONS.md,│
│    TESTING.md, DESIGN-SYSTEM.md,             │
│    ACCESSIBILITY.md, DEFINITION-OF-DONE.md   │
│                                              │
│  Informs: technical approach, affected files,│
│    test plan, stack compatibility warnings   │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4d: FIGMA DESIGN CONTEXT               │
│                                              │
│  Ticket description contains Figma URL?      │
│       |                                      │
│  +----+----+                                 │
│  No        Yes                               │
│  |         |                                 │
│  v         v                                 │
│ Skip     FIGMA_API_KEY configured?           │
│            |                                 │
│       +----+----+                            │
│       Yes       No                           │
│       |         |                            │
│       v         v                            │
│    3 MCP calls  Note in plan:                │
│    (metadata,   "Figma URL present           │
│     context,     but API key not             │
│     screenshot)  configured."                │
│       |                                      │
│       v                                      │
│    Informs acceptance criteria               │
│    and affected components                   │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4e: EXPLORE SOURCE FILES               │
│                                              │
│  Estimate size from title/description:       │
│                                              │
│  S-sized (simple):                           │
│    Single-pass — Glob and Read directly      │
│                                              │
│  M/L-sized (broad):                          │
│    2-3 parallel Explore subagents:           │
│      Agent 1: Files matching keywords,       │
│               existing similar impls         │
│      Agent 2: Related test files,            │
│               test patterns in area          │
│      Agent 3: (UI only) Component structure, │
│               design system, a11y patterns   │
│                                              │
│  Display per-agent progress:                 │
│    Exploring codebase...                     │
│      Source files ✅                         │
│      Test patterns ✅                        │
│      UI components ✅ (if applicable)        │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4f: GENERATE PLAN                      │
│                                              │
│  Using plan template (see below).            │
│                                              │
│  If re-planning with feedback:               │
│    Prepend "### Changes From Previous Plan"  │
│    section before Summary.                   │
│                                              │
│  Quality rules:                              │
│    - Acceptance criteria must be testable    │
│    - Affected files must be real (found)     │
│    - Edge cases must be ticket-specific      │
│    - Size: S (<1h), M (1-4h), L (4+h)       │
│    - If affected files > 15: note "Consider  │
│      splitting this ticket"                  │
│    - If UI ticket without Figma: note        │
│    - If tech not in STACK.md: note           │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 5: POST PLAN AS COMMENT                │
│  (platform-specific — see below)             │
│                                              │
│  On success:                                 │
│    "[{KEY}] ✅ Plan posted as comment."      │
│                                              │
│  On failure:                                 │
│    Print plan to stdout as fallback.         │
│    "Failed to post comment for [{KEY}].      │
│     Plan printed above — paste manually."    │
│    (never lose the plan)                     │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 6: LOG                                 │
│                                              │
│  Append to .clancy/progress.txt:             │
│  YYYY-MM-DD HH:MM | {KEY} | PLAN | {S/M/L}  │
│                                              │
│  If skipped (infeasible):                    │
│  YYYY-MM-DD HH:MM | {KEY} | SKIPPED |       │
│    {reason}                                  │
│                                              │
│  If re-plan (with feedback):                 │
│  YYYY-MM-DD HH:MM | {KEY} | PLAN | {S/M/L}  │
│    | REVISED                                 │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 7: SUMMARY                             │
│                                              │
│  "Planned {N} ticket(s):"                    │
│                                              │
│  ✅ [{KEY1}] {Title} — M | 6 files | Posted  │
│  ✅ [{KEY2}] {Title} — S | 2 files | Posted  │
│  ⏭️  [{KEY3}] {Title} — already planned       │
│  ⏭️  [{KEY4}] {Title} — not a codebase change │
│                                              │
│  "Plans written to your board."              │
│  "After review, run /clancy:approve-plan     │
│   {KEY} to promote."                         │
│                                              │
│  "Let me dust this for prints..."            │
└──────────────────────────────────────────────┘
```

### Plan Template

```
## Clancy Implementation Plan

**Ticket:** [{KEY}] {Title}
**Planned:** {YYYY-MM-DD}

### Summary
{1-3 sentences}

### Affected Files
| File | Change |
|------|--------|
| `src/path/file.ts` | {What changes and why} |

### Implementation Approach
{2-4 sentences: strategy, patterns, key decisions}

### Test Strategy
- [ ] {Specific test to write or verify}

### Acceptance Criteria
- [ ] {Specific, testable criterion}

### Dependencies
{Blockers, prerequisites, external deps. "None" if clean.}

### Figma Link
{URL if provided, or "None" / "Figma URL present but API key not configured."}

### Risks / Considerations
- {Specific edge case and handling}
- {If affected files > 15: "Consider splitting this ticket"}

### Size Estimate
**{S / M / L}** — {Brief justification}

---
*Generated by [Clancy](https://github.com/Pushedskydiver/clancy).
To request changes: comment on this ticket, then re-run `/clancy:plan {KEY}` to revise.
To approve: run `/clancy:approve-plan {KEY}` to promote this plan to the ticket description.*
```

**If re-planning with feedback**, prepend before Summary:

```
### Changes From Previous Plan
{What feedback was addressed and how the plan changed}
```

### Step 3: Fetch Tickets — Platform Details

```
Step 3: Fetch from planning queue
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────

1. Resolve username:        POST /rest/api/3/           POST /graphql
   GET /user                  search/jql                  query { viewer {
   (cached per process)                                     assignedIssues(
                            Body:                           filter: {
2. GET /repos/{repo}/       { "jql":                        state: { type:
   issues?state=open          "project=$PROJ                  { eq:
   &assignee={user}            AND assignee=                    "$PLAN_STATE_TYPE"
   &labels={PLAN_LABEL}        currentUser()                  } }
   &per_page={N}               AND status=                  team: { id:
                               \"$PLAN_STATUS\"                { eq: "$TEAM_ID" }
   PLAN_LABEL default:         [AND sprint in               } }
   "needs-refinement"           openSprints()]             first: $N
                               [AND labels=                orderBy: priority
   Filter out PRs:              \"$CLANCY_LABEL\"]       ) { nodes {
   exclude entries with        ORDER BY priority            id identifier
   pull_request key              ASC",                      title description
                              "maxResults": N,              parent { identifier
   Then fetch comments         "fields": [                   title }
   per issue:                    "summary",                 comments { nodes {
   GET /issues/{n}/              "description",               body createdAt
     comments                    "issuelinks",              } }
                                 "parent",               } } } }
                                 "customfield_10014",
                                 "comment"              PLAN_STATE_TYPE
                               ]                        default: "backlog"
                            }
                                                        No label filter
                            PLAN_STATUS default:        Comments inline
                            "Backlog"                   (no separate call)

                            Comments are inline
                            (included in fields)

Specific ticket mode:       Specific ticket mode:       Specific ticket mode:
GET /issues/{number}        GET /rest/api/3/issue/      POST /graphql
                              {KEY}?fields=...            issues(filter: {
                                                            identifier: {
                                                              eq: "{KEY}" } })
```

### Step 3: Fetch Specific Ticket — Validation

```
Specific ticket fetch response
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────

200 OK -> continue          200 OK -> continue          nodes[0] exists
404    -> "Issue #{N}       404    -> "Ticket {KEY}       -> continue
          not found"                  not found"        nodes empty
401    -> "Check TOKEN"     401    -> "Check creds"       -> "Issue {KEY}
403    -> "Check scopes"    403    -> "Check perms"          not found"
5xx    -> "Server error"    5xx    -> "Server error"    errors -> "Check
                                                          LINEAR_API_KEY"

Is it a PR?                 Is it an Epic?              Is parent set?
(pull_request != null)      (issuetype.name ==          (parent != null)
  -> "#{N} is a PR,          "Epic")                     -> Note only
     not an issue."           -> Note: "This is an         (informational)
     (stop)                      epic. Planning the
                                 epic itself."
state == "closed"?
  -> Warn: "Issue is        statusCategory.key ==       state.type ==
     closed. Plan            "done"?                      "completed"?
     anyway? [y/N]"           -> Warn (ask [y/N])          -> Warn (ask)
                            statusCategory.key ==       state.type ==
                              "indeterminate"?            "canceled"?
                              -> Note (In Progress)        -> Warn (ask)
```

### Step 5: Post Plan Comment — Platform Details

```
Step 5: Post plan as comment on ticket
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────
POST /repos/{repo}/         POST /rest/api/3/issue/     mutation {
  issues/{n}/comments         {key}/comment               commentCreate(input: {
                                                            issueId: "{UUID}",
Body:                       Body:                           body: "{markdown}"
  {"body": "{markdown}"}      {"body": { ADF }}           })
                                                         }
Format: Markdown            Format: ADF (Atlassian      Format: Markdown
  (native)                    Document Format)             (native)
                              Fallback: wrap in
                              codeBlock if complex

Comment marker:             Comment marker:             Comment marker:
  ## Clancy Implementation    ## Clancy Implementation    ## Clancy Implementation
  Plan                        Plan (ADF heading)          Plan

On failure:                 On failure:                 On failure:
  Print plan to stdout,       Print plan to stdout,       Print plan to stdout,
  warn "paste manually"       warn "paste manually"       warn "paste manually"


Skip comment (if ticket skipped as irrelevant):
──────────────────────────────────────────────────────────────────

Same API endpoints as above. Body is the skip reason message.

Opt-out via CLANCY_SKIP_COMMENTS=false.
```

---

## Part 3: /clancy:approve-plan Complete Flow

### Master Flow Diagram

```
┌──────────────────────────────────────────────┐
│  /clancy:approve-plan <arg>                  │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 1: PREFLIGHT                           │
│                                              │
│  1a. .clancy/.env exists?                    │
│      NO -> "Run /clancy:init first" (stop)   │
│      YES -> parse env, detectBoard()         │
│                                              │
│  1b. Credentials valid?                      │
│      Check board-specific creds present      │
│      FAIL -> "Check credentials" (stop)      │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 2: RESOLVE TICKET                      │
│                                              │
│  <arg> provided?                             │
│       |                                      │
│  +----+----+                                 │
│  Yes       No                                │
│  |         |                                 │
│  v         v                                 │
│ Validate  Auto-select from progress.txt      │
│ ticket    (oldest PLAN without APPROVE)      │
│ key           |                              │
│ format   +----+----+                         │
│  |       0         1+                        │
│  |       |         |                         │
│  v       v         v                         │
│ Use   "No planned  Show confirmation:        │
│ key    tickets     "Auto-selected [{KEY}]    │
│        awaiting     {Title}. Promote?        │
│        approval."   [Y/n]"                   │
│        (stop)       |                        │
│                +----+----+                   │
│                Y         N                   │
│                |         |                   │
│                v         v                   │
│             Continue  "Cancelled." (stop)    │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 3: FETCH PLAN COMMENT                  │
│  (platform-specific — see below)             │
│                                              │
│  Fetch comments for ticket.                  │
│  Search for most recent comment containing   │
│  "## Clancy Implementation Plan" marker.     │
│                                              │
│  Not found?                                  │
│    -> "No Clancy plan found for {KEY}.       │
│        Run /clancy:plan first." (stop)       │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 3b: CHECK EXISTING PLAN IN DESCRIPTION │
│                                              │
│  Ticket description already contains         │
│  "## Clancy Implementation Plan"?            │
│       |                                      │
│  +----+----+                                 │
│  No        Yes                               │
│  |         |                                 │
│  v         v                                 │
│ Continue "This ticket's description already  │
│          contains a Clancy plan.             │
│          Continuing will add a duplicate.    │
│                                              │
│          [1] Continue anyway                 │
│          [2] Cancel"                         │
│               |                              │
│          +----+----+                         │
│          1         2                         │
│          |         |                         │
│          v         v                         │
│       Continue  "Cancelled." (stop)          │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4: CONFIRM                             │
│  (skipped if auto-select already confirmed)  │
│                                              │
│  "Clancy — Approve Plan"                     │
│                                              │
│  [{KEY}] {Title}                             │
│  Size: {S/M/L} | {N} affected files         │
│  Planned: {date from plan}                   │
│                                              │
│  Promote this plan to the ticket             │
│  description? [Y/n]                          │
│       |                                      │
│  +----+----+                                 │
│  Y         n                                 │
│  |         |                                 │
│  v         v                                 │
│ Continue "Cancelled. No changes made." (stop)│
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 5: UPDATE TICKET DESCRIPTION           │
│  (platform-specific — see below)             │
│                                              │
│  Append plan below existing description:     │
│  {existing description}                      │
│                                              │
│  ---                                         │
│                                              │
│  {full plan content}                         │
│                                              │
│  NEVER overwrite the original description.   │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 5b: EDIT PLAN COMMENT                  │
│                                              │
│  Prepend to the existing plan comment:       │
│  "✅ Plan approved and promoted to           │
│   description on {YYYY-MM-DD}."             │
│                                              │
│  Do NOT delete the comment.                  │
│  (platform-specific — see below)             │
│                                              │
│  On failure: warn, continue (best-effort)    │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 6: POST-APPROVAL TRANSITION            │
│  (platform-specific — see below)             │
│                                              │
│  Jira: Transition ticket to                  │
│    CLANCY_STATUS_PLANNED (if set)            │
│    Default: no transition (manual)           │
│                                              │
│  GitHub: Add "clancy" label +                │
│    Remove "needs-refinement" label           │
│    (always, not configurable)                │
│                                              │
│  Linear: Move to "unstarted" state type      │
│    (always, not configurable)                │
│                                              │
│  On failure: warn, continue (best-effort)    │
│  "Could not transition ticket. Move it       │
│   manually to your implementation queue."    │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 7: LOG AND DISPLAY                     │
│                                              │
│  On success:                                 │
│    Append to .clancy/progress.txt:           │
│    YYYY-MM-DD HH:MM | {KEY} | APPROVE | —   │
│                                              │
│    Display:                                  │
│    "✅ Plan promoted to description for      │
│     [{KEY}]."                                │
│                                              │
│    Jira (CLANCY_STATUS_PLANNED set):         │
│      "Ticket transitioned to                 │
│       {CLANCY_STATUS_PLANNED}."              │
│    Jira (CLANCY_STATUS_PLANNED not set):     │
│      "Move [{KEY}] to your implementation    │
│       queue so /clancy:once picks it up."    │
│    GitHub:                                   │
│      "Label swapped: needs-refinement ->     │
│       clancy. Ready for /clancy:once."       │
│    Linear:                                   │
│      "Moved to unstarted. Ready for          │
│       /clancy:once."                         │
│                                              │
│    "Book 'em, Lou."                          │
│                                              │
│  On failure:                                 │
│    "Failed to update description for         │
│     [{KEY}]. Check your board permissions."  │
└──────────────────────────────────────────────┘
```

### Step 3: Fetch Plan Comment — Platform Details

```
Step 3: Fetch comments for ticket
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────
GET /repos/{repo}/          GET /rest/api/3/issue/      POST /graphql
  issues/{n}/comments         {key}/comment               issueSearch(
                                                            query: "{ID}",
Strip # prefix if                                           first: 5) {
present from key.           Returns array of              nodes {
                            comments with ADF               id identifier
                            body content.                   title description
                                                            comments { nodes {
                                                              id body createdAt
                                                            } }
                                                          }
                                                        }

Search for:                 Search for:                 IMPORTANT:
  comment.body containing     Walk ADF body for           issueSearch is fuzzy.
  "## Clancy Implementation   "Clancy Implementation      After fetch, verify
  Plan"                       Plan" heading node           identifier exactly
                                                          matches key
Most recent match wins.     Most recent match wins.       (case-insensitive).
                                                        If no exact match:
                                                          "Issue {KEY} not
                                                           found." (stop)

                                                        Search comment.body
                                                        for "## Clancy
                                                        Implementation Plan".

                                                        Most recent match wins.
```

### Step 5: Update Ticket Description — Platform Details

```
Step 5: Append plan to ticket description
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────

1. Fetch current body:      1. Fetch current desc:      1. Fetch current desc:
   GET /issues/{n}             GET /issue/{key}             query { issue(id:
   -> .body (markdown)           ?fields=description          "...") {
                               -> .fields.description          description
                                  (ADF JSON)                 } }

2. Append plan:             2. Merge ADF:               2. Append plan:
   PATCH /issues/{n}           Existing ADF content         mutation {
   Body:                       + rule node (hr)               issueUpdate(
   {"body":                    + plan as new ADF nodes         id: "...",
     "{existing}\n\n                                           input: {
      ---\n\n                  PUT /issue/{key}                  description:
      {plan}"}                 Body:                             "{existing}
                               {"fields":                        \n\n---\n\n
                                 {"description":                 {plan}"
                                   <merged ADF>}}              })
                                                             }
                            Fallback: if ADF
                            construction fails,
                            wrap plan in codeBlock
                            node.
```

### Step 5b: Edit Plan Comment — Platform Details

```
Step 5b: Prepend approval note to plan comment
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────
PATCH /repos/{repo}/        PUT /rest/api/3/issue/      mutation {
  issues/{n}/comments/{id}    {key}/comment/{id}          commentUpdate(
                                                            id: "{comment_id}",
Body:                       Body:                           input: {
{"body":                    {"body":                          body: "{note}
  "✅ Plan approved and       { ADF with note                 \n\n{existing}"
   promoted to description    prepended before              })
   on {date}.\n\n             existing ADF                }
   {existing comment body}"   content }}
}                                                       On failure:
                            On failure:                   warn, continue
On failure:                   warn, continue
  warn, continue
```

### Step 6: Post-Approval Transition — Platform Details

```
Step 6: Transition ticket after approval
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────

1. Remove plan label:       CLANCY_STATUS_PLANNED set?  Resolve "unstarted"
   DELETE /repos/{repo}/                                state UUID:
     issues/{n}/labels/     +----+----+                   workflowStates(
     {CLANCY_PLAN_LABEL}    Yes       No                    filter: {
                            |         |                       team: { id: ... }
   PLAN_LABEL default:      v         v                       type: { eq:
   "needs-refinement"     Fetch      Skip transition            "unstarted" }
                          transitions: (manual)               })
   On 404 (label not      GET /issue/{key}/             -> nodes[0].id
   present): ignore       transitions
                                |                       mutation {
2. Add impl label:             v                          issueUpdate(
   POST /repos/{repo}/    Find transition                   id: "...",
     issues/{n}/labels       matching target                input: {
   Body: ["{CLANCY_LABEL}"]  status name:                    stateId:
                              CLANCY_STATUS_PLANNED           "{UUID}"
   CLANCY_LABEL default:       |                            })
   "clancy"               +----+----+                   }
                          Found     Not found
   If label doesn't         |         |                 On failure:
   exist:                   v         v                   warn, continue
   POST /repos/{repo}/   POST /issue/ "Status
     labels                 {key}/      '{name}'
   to create it.            transitions not found.
                          Body:         Check
   On failure:            {"transition":  board
   warn, continue           {"id":        config."
                            "{id}"}}      (warn,
                                          continue)
                          On failure:
                            warn, continue
```

---

## Part 4: Re-plan Flow (Auto-detect Feedback)

### Auto-detect Decision Tree

```
/clancy:plan PROJ-123 (or #42, ENG-42)
       |
       v
  Fetch ticket and comments
       |
       v
  Existing plan comment found?
  (contains "## Clancy Implementation Plan")
       |
  +----+----+
  No        Yes
  |         |
  v         v
Generate  --fresh flag?
fresh     |
plan    +-+------+
(normal Yes      No
 flow)  |        |
        v        v
     Discard  Check for feedback:
     existing Find most recent plan comment.
     plan.    Collect all comments posted
     Start    AFTER it.
     from          |
     scratch  +----+----+
     (normal  No        Yes
      flow)   feedback  feedback
              |         |
              v         v
           "Already   Merge feedback.
            planned.  Re-generate plan
            Comment   with "Changes From
            on the    Previous Plan"
            ticket    section.
            to        Post new plan comment
            provide   (does NOT replace old).
            feedback,
            then
            re-run.
            Or use
            --fresh
            to start
            over."
            (stop)
```

### Queue Mode Re-plan Behaviour

```
/clancy:plan (no specific ticket, queue mode)
       |
       v
  Fetch N tickets from planning queue
       |
       v
  For each ticket:
       |
       v
  Existing plan comment?
       |
  +----+----+
  No        Yes
  |         |
  v         v
Plan it   --fresh flag?
(normal)  |
        +-+------+
        Yes      No
        |        |
        v        v
     Plan it   Check for feedback
     fresh     (auto-detect)
     (ignore        |
      existing +----+----+
      plan)    No        Yes
               feedback  feedback
               |         |
               v         v
            Skip:     Re-plan
            "Already   with
             planned"  feedback
                       (auto-
                        detect)
```

### Feedback Detection

```
Feedback detection — board comments only
──────────────────────────────────────────────────────────────────

The planner checks ONE source for feedback:
  Board comments posted after the most recent plan comment.

Unlike the strategist (which has 3 feedback sources: local file,
companion file, board comments), the planner has no local brief
file. Plans live on the board as comments only.

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────
GET /issues/{n}/            Comments included in        Comments included in
  comments                    initial issue fetch         GraphQL response
  ?per_page=100               (comment field)             (comments.nodes)

Find most recent comment    Find most recent comment    Find most recent comment
containing plan marker.     containing plan marker      containing plan marker
                            (walk ADF for heading).     in body.

Collect all comments        Collect all comments        Collect all comments
with created_at >           with created timestamp >    with createdAt >
plan_comment.created_at     plan_comment timestamp      plan_comment.createdAt

Exclude bot's own           Exclude comments by         All post-plan comments
comments (user.login        the same author as          are treated as feedback.
!= resolved_username)       the plan comment.
```

### Re-plan Output

```
Re-plan with feedback:
──────────────────────────────────────────────────────────────────

  [{KEY}] {Title}
    Re-planning with {N} feedback comment(s)...
    Exploring codebase...
    ✅ Revised plan posted as comment.

  The NEW plan is posted as a SEPARATE comment
  (does not edit the old plan comment).

  Old plan comment remains on the ticket.
  The new comment is identifiable by:
    - Its own "## Clancy Implementation Plan" heading
    - The "### Changes From Previous Plan" section
    - The newer timestamp

  /clancy:approve-plan uses the MOST RECENT plan comment.
```

---

## Part 5: Error Flows

### Preflight Errors

```
Preflight failures:
──────────────────────────────────────────────────────────────────

  .clancy/ missing or .clancy/.env missing:
    ".clancy/ not found. Run /clancy:init to set up Clancy first."
    (stop, nothing logged)

  Board credentials missing:
    Jira:   "Missing JIRA_USER, JIRA_API_TOKEN, or JIRA_BASE_URL
             in .clancy/.env"
    GitHub: "Missing GITHUB_TOKEN or GITHUB_REPO in .clancy/.env"
    Linear: "Missing LINEAR_API_KEY or LINEAR_TEAM_ID
             in .clancy/.env"
    (stop, nothing logged)

  Planner not enabled:
    "Planner role is not enabled.
     Add CLANCY_ROLES=\"planner\" to .clancy/.env
     and re-run the installer."
    (stop, nothing logged)

  Branch freshness — git fetch fails:
    Continue silently (best-effort check).

  Branch freshness — behind by N:
    See Part 2, Step 1e. User chooses: pull, continue, or abort.
```

### API Errors — Fetch Queue

```
Fetch planning queue errors:
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────

GET /user fails:            POST /search/jql fails:     POST /graphql fails:
  401 -> "GITHUB_TOKEN        401 -> "Check JIRA_USER     401 -> "Check
          invalid or            and JIRA_API_TOKEN"          LINEAR_API_KEY.
          expired"            403 -> "Check Jira              No Bearer prefix
  (stop)                       permissions"                   for personal keys!"
                              400 -> "Invalid JQL.          Network error ->
GET /issues fails:              Check CLANCY_PLAN_           "Cannot reach
  401 -> same as above          STATUS value."               Linear API"
  404 -> "Repo not found.    5xx -> "Jira server           GraphQL errors ->
          Check GITHUB_REPO"   error. Try later."            parse errors array
  403 -> "Token lacks        (stop on all)               (stop on all)
          repo scope"
  5xx -> "Server error"
(stop on all)

All platforms — no tickets found:
──────────────────────────────────────────────────────────────────

  "Nothing to see here." — No backlog tickets to plan.

  Check your board configuration or run /clancy:settings
  to verify the plan queue.

  GitHub-specific addition:
  "For GitHub: planning uses the "{CLANCY_PLAN_LABEL}"
   label (default: needs-refinement), not "clancy".
   Apply that label to issues you want planned."

  Jira-specific addition:
  "Check that tickets in status "{CLANCY_PLAN_STATUS}"
   are assigned to you."

  Linear-specific addition:
  "Check that tickets with state type
   "{CLANCY_PLAN_STATE_TYPE}" are assigned to you
   in team {LINEAR_TEAM_ID}."
```

### API Errors — Post Comment

```
Post plan comment errors:
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────
POST /issues/{n}/comments   POST /issue/{key}/comment   commentCreate mutation

201 -> success              201 -> success              success: true -> OK

401 -> "Auth expired        401 -> "Auth expired        success: false ->
        during planning"            during planning"      "Comment creation
403 -> "Token lacks         403 -> "No permission         failed"
        write access"               to comment"
404 -> "Issue was closed    404 -> "Ticket deleted       errors array ->
        or deleted during           during planning"       parse and display
        planning"
422 -> "Comment body
        too large"
5xx -> "Server error"       5xx -> "Server error"       Network error ->
                                                          display

ALL PLATFORMS on failure:
──────────────────────────────────────────────────────────────────

  The plan is NEVER lost. On any comment post failure:

  1. Print the full plan to stdout
  2. Display: "Failed to post comment for [{KEY}].
              Plan printed above — paste it manually."
  3. Log the PLAN entry in progress.txt anyway
     (plan was generated even if posting failed)
  4. Continue to next ticket (in batch mode)
```

### API Errors — Approve Description Update

```
Update description errors:
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────
PATCH /issues/{n}           PUT /issue/{key}            issueUpdate mutation

200 -> success              204 -> success              success: true -> OK

401 -> "Auth failed"        401 -> "Auth failed"        success: false ->
403 -> "No write access     403 -> "No edit                "Update failed"
        to issue"                   permission"
404 -> "Issue deleted"      404 -> "Ticket deleted"     errors -> parse
422 -> "Body too large.     400 -> "Invalid ADF.
        Plan may be too             Falling back
        long for GitHub."           to codeBlock."
                                    -> Retry with
                                       codeBlock
                                       wrapper

On failure:
  "Failed to update description for [{KEY}].
   Check your board permissions."
  Do NOT log APPROVE entry.
  Do NOT proceed to transition.
```

### API Errors — Post-Approval Transition

```
Transition errors:
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────

Remove label fails:         GET transitions fails:      Resolve state fails:
  404 (not present)           -> Skip transition,         -> Skip transition,
    -> Ignore (OK)               warn                       warn
  Other error:              Transition POST fails:
    -> Warn, continue         400 -> "Transition          issueUpdate fails:
                                not available.              -> Warn, continue
Add label fails:                Check workflow."
  422 (label invalid):        Other -> warn,
    -> Create label first       continue
    -> If create fails:
       warn, continue

ALL PLATFORMS:
  Transition failures are BEST-EFFORT.
  The plan is already in the description (Step 5 succeeded).
  Warn the user and let them move the ticket manually.

  "Could not transition [{KEY}] automatically.
   Move it to your implementation queue manually
   so /clancy:once picks it up."
```

### API Errors — Edit Plan Comment

```
Edit plan comment errors:
──────────────────────────────────────────────────────────────────

ALL PLATFORMS:
  Comment edit failures are BEST-EFFORT.
  The plan is already in the description.
  The comment is cosmetic only.

  On failure: warn and continue silently.
  "Could not update plan comment. The plan
   was promoted to the description successfully."
```

### API Errors — Skip Comment

```
Skip comment errors:
──────────────────────────────────────────────────────────────────

ALL PLATFORMS:
  Skip comments are BEST-EFFORT.
  The ticket is being skipped regardless.

  On failure: warn silently in console output.
  Do not stop. Do not retry.
  The SKIPPED log entry is written regardless.
```

### Network Errors

```
Network failure (any platform):
──────────────────────────────────────────────────────────────────

  fetch() throws (DNS failure, timeout, etc.)
       |
       v
  During queue fetch?
    -> "Could not reach {platform} — check network
        connection and {URL config variable}."
       (stop, nothing logged)

  During comment post (mid-batch)?
    -> Print plan to stdout (never lose the plan)
    -> Warn: "Network error posting comment.
              Plan printed above."
    -> Continue to next ticket

  During approve description update?
    -> "Network error updating description.
        Check connection and try again."
       (stop, do not log APPROVE)
```

---

## Part 6: Batch Mode

```
/clancy:plan N (where N is a positive integer)
       |
       v
  N > 10?
       |
  +----+----+
  Yes       No
  |         |
  v         v
"Maximum  N >= 5?
batch     |
size is +-+------+
10.     Yes      No
Planning |       |
10."     v       v
(cap   Confirm: Continue
 N=10) "Planning
        {N} tickets
        — each
        requires
        codebase
        exploration.
        Continue?
        [Y/n]"
           |
      +----+----+
      Y         N
      |         |
      v         v
   Continue   "Cancelled."
              (stop)
       |
       v
  Preflight (same as single mode)
       |
       v
  Fetch N tickets from planning queue:

  GitHub                    Jira                      Linear
  GET /issues               POST /search/jql          query { viewer {
    ?state=open               maxResults: N             assignedIssues(
    &labels={PLAN_LABEL}                                  first: N
    &assignee={user}                                      ...
    &per_page=N                                        ) } }

  Filter out PRs            (no extra filter)         (no extra filter)
       |
       v
  How many tickets returned?
       |
  +----+----+
  0         1+
  |         |
  v         v
"No issues For each ticket (sequential):
 in queue"    |
 (stop)       v
           Step 3b: Check for existing plan
              |
           +--+-----+-----+
           No plan   Has plan   Has plan
           |         no feedback + feedback
           |         |           |
           v         v           v
          Plan it   Skip:      Re-plan with
          (Steps    "Already   feedback
           4-5)      planned"  (auto-detect)
              |         |           |
              +--+------+-----------+
                 |
                 v
           Log (Step 6)
                 |
                 v
           Next ticket (no delay needed between tickets)
                 |
                 v
           All done:
           "Planned {M} ticket(s):"
           (summary with per-ticket status lines)


  Ctrl+C handling:
  ──────────────────────────────────────────────

  If user interrupts during batch:
    - Plans already posted are safe (comments exist on board)
    - The current ticket's plan is lost (was in progress)
    - Progress.txt has entries for completed tickets only
    - Display: nothing special (process exits)
```

---

## Part 7: Platform Comparison Tables

### API Endpoints Used

```
Operation               GitHub                    Jira                         Linear
──────────────────────  ────────────────────────  ─────────────────────────── ─────────────────────────
Resolve user            GET /user                 (currentUser() in JQL)      (viewer in GraphQL)

Fetch planning queue    GET /issues               POST /rest/api/3/           viewer.assignedIssues
                          ?state=open               search/jql                  (GraphQL query)
                          &labels={PLAN_LABEL}
                          &assignee={user}

Fetch specific ticket   GET /issues/{n}           GET /rest/api/3/            issues(filter: {
                                                    issue/{key}                 identifier: { eq }})
                                                    ?fields=...

Fetch comments          GET /issues/{n}/          (included in issue fetch    (included in GraphQL
                          comments                  via comment field)          query via comments
                                                                                nodes)

Post plan comment       POST /issues/{n}/         POST /rest/api/3/           commentCreate mutation
                          comments                  issue/{key}/comment

Edit plan comment       PATCH /issues/{n}/        PUT /rest/api/3/            commentUpdate mutation
                          comments/{id}             issue/{key}/comment/{id}

Post skip comment       POST /issues/{n}/         POST /rest/api/3/           commentCreate mutation
                          comments                  issue/{key}/comment

Update description      PATCH /issues/{n}         PUT /rest/api/3/            issueUpdate mutation
                          (body field)              issue/{key}
                                                    (description field)

Remove plan label       DELETE /issues/{n}/       N/A                         N/A
                          labels/{label}

Add impl label          POST /issues/{n}/         N/A                         N/A
                          labels

Transition status       N/A (uses labels)         POST /issue/{key}/          issueUpdate mutation
                                                    transitions                 (stateId field)

Fetch transitions       N/A                       GET /issue/{key}/           workflowStates
                                                    transitions                 (GraphQL query)
```

### Planning Queue Filters

```
                        GitHub                    Jira                         Linear
──────────────────────  ────────────────────────  ─────────────────────────── ─────────────────────────
Primary filter          Label:                    Status:                     State type:
                          CLANCY_PLAN_LABEL         CLANCY_PLAN_STATUS          CLANCY_PLAN_STATE_TYPE
                          (default:                 (default: "Backlog")        (default: "backlog")
                          "needs-refinement")

Secondary filter        None                      CLANCY_LABEL (if set)       None
                                                  CLANCY_JQL_SPRINT (if set)

Assignee filter         assignee={username}       assignee=currentUser()      viewer.assignedIssues
                          (resolved via /user)

Ordering                Default (created ASC)     ORDER BY priority ASC       orderBy: priority
```

### Post-Approval Transitions

```
                        GitHub                    Jira                         Linear
──────────────────────  ────────────────────────  ─────────────────────────── ─────────────────────────
Mechanism               Label swap                Status transition           State change
                        (remove + add)            (POST transitions)          (issueUpdate stateId)

Remove from plan queue  DELETE label:             Automatic (status           Automatic (state
                          {CLANCY_PLAN_LABEL}       changes)                    changes)

Add to impl queue       POST label:               Transition to              Move to "unstarted"
                          {CLANCY_LABEL}            CLANCY_STATUS_PLANNED      state type
                          (default: "clancy")       (if configured)

Configuration           Always happens            CLANCY_STATUS_PLANNED:      Always happens
                        (not configurable —          if set -> auto-transition (not configurable —
                         labels are the queue)       if not set -> manual       always moves to
                                                                                unstarted)

Failure handling        Best-effort (warn)        Best-effort (warn)          Best-effort (warn)
```

### Comment Format

```
                        GitHub                    Jira                         Linear
──────────────────────  ────────────────────────  ─────────────────────────── ─────────────────────────
Format                  Markdown                  ADF (Atlassian Document     Markdown
                                                    Format)

Plan comment marker     ## Clancy Implementation  ## Clancy Implementation    ## Clancy Implementation
                        Plan                      Plan (ADF heading)          Plan
                        (markdown H2)             (level 2 heading node)      (markdown H2)

Skip comment format     Markdown                  ADF                         Markdown

Approval note format    Markdown prepend          ADF prepend                 Markdown prepend

Size limit              ~65KB body                ~32KB ADF                   No documented limit

Fallback on complex     N/A (markdown native)     Wrap entire plan in         N/A (markdown native)
content                                             codeBlock ADF node
```

### Env Vars Summary

```
Variable                   Default              Platforms    Purpose
─────────────────────────  ──────────────────── ─────────── ─────────────────────────────
CLANCY_PLAN_STATUS         "Backlog"            Jira only    Status for planning queue
CLANCY_PLAN_LABEL          "needs-refinement"   GitHub only  Label for planning queue
CLANCY_PLAN_STATE_TYPE     "backlog"            Linear only  State type for planning queue
CLANCY_STATUS_PLANNED      (none)               Jira only    Target status after approval
                                                              (if unset: no auto-transition)
CLANCY_SKIP_COMMENTS       "true"               All          Post skip comments on board
                                                              (set "false" to disable)
CLANCY_ROLES               (none)               All          Must include "planner"
CLANCY_LABEL               "clancy"             GitHub/Jira  Implementation queue label
CLANCY_JQL_SPRINT          (none)               Jira only    Sprint filter for planning queue
FIGMA_API_KEY              (none)               All          Enables Figma design context
```

### Progress Log Entries

```
Scenario                              Log Entry
──────────────────────────────────── ────────────────────────────────────────────
Plan generated                        YYYY-MM-DD HH:MM | {KEY} | PLAN | {S/M/L}
Plan revised (feedback)               YYYY-MM-DD HH:MM | {KEY} | PLAN | {S/M/L} | REVISED
Plan skipped (irrelevant)             YYYY-MM-DD HH:MM | {KEY} | SKIPPED | {reason}
Plan skipped (infeasible)             YYYY-MM-DD HH:MM | {KEY} | SKIPPED | {reason}
Plan approved                         YYYY-MM-DD HH:MM | {KEY} | APPROVE | —
Comment post failed (plan printed)    YYYY-MM-DD HH:MM | {KEY} | PLAN | {S/M/L} | POST_FAILED
Already planned (no feedback)         (nothing logged)
Already planned (with feedback)       (re-plan: logged as REVISED above)
Approve: no plan found                (nothing logged)
Approve: description update failed    (nothing logged)
Auth/network failure                  (nothing logged)
```

### Error Handling Summary

```
Error Type              GitHub                    Jira                         Linear
──────────────────────  ────────────────────────  ─────────────────────────── ─────────────────────────
Not found               404                       404                         Empty nodes array

Auth failure            401                       401/403                     401/errors array

Rate limit              403 + X-RateLimit-        429 + Retry-After header    errors with code
                          Remaining: 0                                          RATELIMITED

Permission denied       403 (no rate headers)     403                         success: false on
                                                                                mutation

Server error            500/502/503               500/502/503                 errors array (GraphQL)

Issues disabled         410                       N/A                         N/A

Timeout                 15s per API call           30s per API call            30s per GraphQL call

Retry strategy          Check X-RateLimit-Reset   Honour Retry-After header   Wait 60s, retry once
                          Wait until reset          Wait, retry once
```
