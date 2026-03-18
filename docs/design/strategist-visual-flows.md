# Strategist Role — Visual Flows (All Platforms)

Comprehensive visual flow reference for `/clancy:brief` and `/clancy:approve-brief` across GitHub Issues, Jira Cloud, and Linear. Every scenario, every edge case, every platform difference.

---

## Table of Contents

1. [Command Input Resolution](#part-1-command-input-resolution)
2. [/clancy:brief Complete Flow](#part-2-clancybrief-complete-flow)
3. [/clancy:approve-brief Complete Flow](#part-3-clancyapprove-brief-complete-flow)
4. [Re-brief Flow](#part-4-re-brief-flow)
5. [Error Flows](#part-5-error-flows)
6. [--list Flow](#part-6---list-flow)
7. [Stale Brief Detection](#part-7-stale-brief-detection)
8. [Batch Mode](#part-8-batch-mode)
9. [Platform Comparison Tables](#part-9-platform-comparison-tables)

---

## Part 1: Command Input Resolution

### /clancy:brief Invocations

```
INVOCATION                                    RESOLVED MODE
────────────────────────────────────────────────────────────────────
/clancy:brief                              -> Interactive (prompt user)
/clancy:brief PROJ-123                     -> Board ticket (Jira)
/clancy:brief #42                          -> Board ticket (GitHub)
/clancy:brief ENG-42                       -> Board ticket (Linear)
/clancy:brief "Add dark mode"              -> Inline text
/clancy:brief --from docs/rfc.md           -> From file
/clancy:brief --fresh PROJ-123             -> Board ticket + discard existing
/clancy:brief --research #42               -> Board ticket + force web research
/clancy:brief --list                       -> Inventory display (no brief generated)
/clancy:brief --epic PROJ-50 "Add dark mode" -> Inline text + epic hint (for approve)
/clancy:brief --epic PROJ-50 PROJ-123      -> --epic IGNORED (board ticket = source is parent)
/clancy:brief 3                            -> Batch mode (3 tickets from queue)
```

### Input Parsing Decision Tree

```
/clancy:brief <input>
       |
       v
  Parse <input>
       |
       +-- No input?
       |     |
       |     v
       |   --list flag present?
       |     |
       |   +-+-------+
       |   Yes       No
       |   |         |
       |   v         v
       |  Show      Prompt user:
       |  inventory "What's the idea?"
       |  (stop)     |
       |             v
       |           Parse response
       |           (re-enter tree)
       |
       +-- Bare positive integer? (e.g. "3")
       |     |
       |     +-- Board = GitHub? -> Ambiguous: could be issue #3 or batch 3
       |     |     |               Ask: "Did you mean issue #3 or batch 3 tickets?"
       |     +-- Board = Jira?   -> Batch mode (3 tickets from queue)
       |     +-- Board = Linear? -> Batch mode (3 tickets from queue)
       |
       +-- Matches #\d+ ? (e.g. "#42")
       |     |
       |     +-- Board = GitHub? -> Fetch issue #42 from GitHub
       |     +-- Board = Jira?   -> ERROR: "#42 looks like a GitHub issue.
       |     |                      Jira uses PROJ-123 format."
       |     +-- Board = Linear? -> ERROR: "#42 looks like a GitHub issue.
       |                            Linear uses ENG-42 format."
       |
       +-- Matches [A-Z][A-Z0-9]+-\d+ ? (e.g. "PROJ-123" or "ENG-42")
       |     |
       |     +-- Board = GitHub? -> ERROR: "PROJ-123 doesn't look like a
       |     |                      GitHub issue. Use #42 format."
       |     +-- Board = Jira?   -> Fetch PROJ-123 from Jira
       |     +-- Board = Linear? -> Fetch ENG-42 from Linear
       |
       +-- Quoted string? (e.g. '"Add dark mode"')
       |     |
       |     v
       |   Inline text mode (all platforms)
       |
       +-- --from <path> ?
       |     |
       |     v
       |   Ticket ref also present? (e.g. "PROJ-123 --from docs/rfc.md")
       |     |
       |   +-+-------+
       |   Yes       No
       |   |         |
       |   v         v
       |  ERROR:    From file mode (all platforms)
       |  "Cannot
       |   use both
       |   a ticket
       |   reference
       |   and --from.
       |   Use one or
       |   the other."
       |   (stop)
       |
       +-- Unquoted non-matching text?
             |
             v
           Treat as inline text (all platforms)
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

### /clancy:approve-brief Invocations

```
INVOCATION                                    RESOLVED SELECTION
────────────────────────────────────────────────────────────────────
/clancy:approve-brief                      -> Auto-select (1 brief) or list (multiple)
/clancy:approve-brief 2                    -> Select by index (2nd unapproved brief)
/clancy:approve-brief auth-rework          -> Select by slug
/clancy:approve-brief PROJ-123             -> Match by Source field containing PROJ-123
/clancy:approve-brief #42                  -> Match by Source field containing #42
/clancy:approve-brief ENG-42              -> Match by Source field containing ENG-42
/clancy:approve-brief --epic PROJ-50       -> Auto-select + set parent to PROJ-50
/clancy:approve-brief --dry-run           -> Preview what would be created (no API calls)
```

### approve-brief Selection Decision Tree

```
/clancy:approve-brief <arg>
       |
       v
  Scan .clancy/briefs/ for unapproved files
  (files WITHOUT .approved marker)
       |
       v
  How many unapproved briefs?
       |
  +----+----+----+
  |         |    |
  0         1    2+
  |         |    |
  v         |    v
"No         |  <arg> provided?
unapproved  |    |
briefs."    |  +-+-------+
(stop)      |  Yes       No
            |  |         |
            |  v         v
            | Match by   Show numbered list:
            | arg        "[1] slug-a (Source: #50)
            | (below)     [2] slug-b (Source: inline)"
            |            Ask: "Which brief? [1-N]"
            |
            v
       <arg> provided?
            |
       +----+----+
       Yes       No
       |         |
       v         v
  Parse <arg>   Auto-select the 1 brief
       |
       +-- Matches \d+ ? -> Select by index
       |     |
       |     v
       |   Index in range?
       |   +-----+-----+
       |   Yes         No
       |   |           |
       |   v           v
       |  Load brief  "Index out of range"
       |
       +-- Matches #\d+ / [A-Z]+-\d+ ? -> Match by Source field
       |     |
       |     v
       |   Scan **Source:** lines for identifier
       |     |
       |   +-+-------+-------+
       |   0 matches  1 match  2+ matches
       |   |          |        |
       |   v          v        v
       |  "No brief   Load    "Multiple briefs
       |   for #42"   brief    match. Pick one:"
       |   (show                (numbered list)
       |   available)
       |
       +-- Other text? -> Match by slug (filename)
             |
             v
           Filename contains <arg>?
             |
           +-+-------+
           0 matches  1+ matches
           |          |
           v          v
          "No brief   Load first match
           for slug"  (or list if multiple)
```

### approve-brief: What Happens After Selection

```
Brief loaded successfully
       |
       v
  Already approved? (.approved marker exists)
       |
  +----+----+
  Yes       No
  |         |
  v         v
"Already   Continue to
approved    approval flow
on {date}"  (Part 3)
(stop)
```

---

## Part 2: /clancy:brief Complete Flow

### Master Flow Diagram

```
┌──────────────────────────────────────────────┐
│  /clancy:brief <input>                       │
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
│      Ping board endpoint                     │
│      FAIL -> "Check credentials" (stop)      │
│                                              │
│  1c. CLANCY_ROLES includes strategist?       │
│      (or unset for global) -> continue       │
│      Strategist not enabled -> stop          │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 1a: BRANCH FRESHNESS CHECK             │
│                                              │
│  git fetch origin                            │
│  Compare HEAD with origin/$CLANCY_BASE_BRANCH│
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
    commits"           |       (warn)
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
│  Step 2: GATHER IDEA                         │
│  (depends on input mode — see below)         │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 2a: GRILL PHASE (interactive only)     │
│                                              │
│  Running interactively (human present)?      │
│    NO (AFK/batch) -> skip to step 2b         │
│    YES -> interview the user exhaustively:   │
│                                              │
│  Walk the "design tree":                     │
│    - Ask clarifying questions about scope,   │
│      users, constraints, edge cases          │
│    - Explore the codebase to verify/inform   │
│      claims made during the conversation     │
│    - Resolve dependencies between decisions  │
│    - Continue until no open questions remain  │
│                                              │
│  Typical output: 5-20 clarifying questions   │
│  resolved before brief generation begins.    │
│                                              │
│  AFK auto-resolve: when running in AFK/batch │
│  mode, the strategist uses its own judgement  │
│  + codebase context to resolve open          │
│  questions. Unresolvable questions are listed │
│  in a ## Open Questions section of the brief │
│  for the PO to address during review.        │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 2b: AUTO-DETECT EXISTING BRIEF         │
│                                              │
│  Scan .clancy/briefs/ for match              │
│  (by ticket key or slug)                     │
└──────────────────────┬───────────────────────┘
                       │
              Existing brief?
                       │
          +────────────+────────────+
          |            |            |
          No           Yes +       Yes +
          |            feedback    no feedback
          |            |            |
          v            v            v
       Continue     --fresh?     --fresh?
       (generate     |            |
       fresh)     +--+--+      +--+--+
                  Yes   No     Yes   No
                  |     |      |     |
                  v     v      v     v
               Delete  Revise Delete "Already
               old &   brief  old &  briefed.
               start   with   start  Add feedback
               fresh   changes fresh  to revise."
                  |     |      |     (stop)
                  v     v      v
               Continue to Step 3
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 3: RELEVANCE CHECK                     │
│                                              │
│  Read .clancy/docs/STACK.md, ARCHITECTURE.md │
│  Compare idea domain vs codebase stack       │
│                                              │
│  Irrelevant?                                 │
│    YES -> "Skipping — targets {X}, codebase  │
│            is {Y}" (stop + log SKIPPED)      │
│    NO  -> continue                           │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4: RESEARCH (adaptive agents)          │
│                                              │
│  Assess complexity:                          │
│    Narrow   -> 1 codebase agent              │
│    Moderate -> 2 codebase agents             │
│    Broad    -> 3 codebase agents             │
│                                              │
│  Web research?                               │
│    --research flag   -> YES (add 1 agent)    │
│    New technology    -> YES (judgement)       │
│    Internal refactor -> NO                   │
│                                              │
│  Max: 4 agents total (3 codebase + 1 web)    │
│                                              │
│  Agents explore:                             │
│    - .clancy/docs/ (STACK, ARCHITECTURE)     │
│    - Affected code areas                     │
│    - Board for duplicates/related tickets    │
│    - Existing children of source ticket      │
│    - Web (if triggered)                      │
│                                              │
│  Display per-agent progress:                 │
│    Researching...                            │
│      Agent 1: Codebase structure ✅          │
│      Agent 2: Testing patterns ✅            │
│      Agent 3: Web research ✅ (3 sources)    │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 5: GENERATE BRIEF                      │
│                                              │
│  Using brief template:                       │
│    - Problem Statement                       │
│    - Goals / Non-Goals                       │
│    - Background Research (codebase + web)     │
│    - Related Existing Work                   │
│    - User Stories (behaviour-driven, see     │
│      guidance below)                         │
│    - Technical Considerations                │
│    - Ticket Decomposition (max 10 rows,      │
│      vertical slices, HITL/AFK tags)         │
│    - Open Questions (if any remain from      │
│      grill phase — AFK mode only)            │
│    - Success Criteria                        │
│    - Risks                                   │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 6: SAVE LOCALLY                        │
│                                              │
│  Path: .clancy/briefs/{YYYY-MM-DD}-{slug}.md │
│  Slug collision? -> append -2, -3, etc.      │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 7: POST TO BOARD                       │
│                                              │
│  Board-sourced?                              │
│    YES -> post brief as comment on source    │
│           ticket (see platform details)      │
│    NO  -> skip (inline/file = local only)    │
│                                              │
│  Comment post fails?                         │
│    -> Warn, continue (local file is truth)   │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 8: DISPLAY                             │
│                                              │
│  Print full brief to stdout                  │
│                                              │
│  Next steps differ by source:                │
│                                              │
│  BOARD-SOURCED (PROJ-123 / #42 / ENG-42):   │
│    "To request changes:                      │
│     • Comment on {KEY} on your board, then   │
│       re-run /clancy:brief {KEY} to revise   │
│     • Or add a ## Feedback section to the    │
│       brief file and re-run                  │
│     To approve: /clancy:approve-brief {KEY}  │
│     To start over: /clancy:brief --fresh"    │
│                                              │
│  INLINE / FILE (no board ticket):            │
│    "To request changes:                      │
│     • Add a ## Feedback section to:          │
│       .clancy/briefs/{date}-{slug}.md        │
│     • Or create a companion file:            │
│       .clancy/briefs/{date}-{slug}.feedback.md│
│     Then re-run /clancy:brief to revise      │
│     To approve: /clancy:approve-brief {slug} │
│     To start over: /clancy:brief --fresh"    │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 9: LOG                                 │
│                                              │
│  Append to .clancy/progress.txt:             │
│  YYYY-MM-DD HH:MM | BRIEF | {slug} |        │
│    {N} proposed tickets                      │
└──────────────────────────────────────────────┘
```

### Step 2a: Grill Phase — Detailed Guidance

The grill phase is inspired by the "design tree" concept (Frederick P. Brooks, *The Design of Design*). The goal is to walk every branch of the design tree systematically before generating the brief, resolving ambiguity upfront rather than encoding it into vague tickets.

```
Grill Phase Behaviour
──────────────────────────────────────────────────────────────────

INTERACTIVE MODE (human present):
  1. After gathering the idea (step 2), interview the user:
     - Scope: "What's in and what's out?"
     - Users: "Who uses this? What are the personas?"
     - Constraints: "Performance budget? Browser support? Auth?"
     - Edge cases: "What happens when X is empty / fails / times out?"
     - Dependencies: "Does this depend on other in-flight work?"
  2. Explore the codebase between questions to verify/inform
     (e.g. user says "we have a notification service" — check it)
  3. Resolve dependencies between decisions one by one
     (e.g. "you said SSO — does that mean the dashboard
      also needs role-based access?")
  4. Continue until no open questions remain
  5. The resolved answers feed directly into the brief

  Typical: 5-20 clarifying questions over 2-5 rounds.

AFK / BATCH MODE (no human):
  1. Auto-resolve questions using codebase context + board context
  2. List any genuinely unresolvable questions in the brief:
     ## Open Questions
     - [ ] Should the portal support SSO or email/password only?
     - [ ] Is the 50ms latency budget per-request or p99?
  3. The PO addresses these during brief review (feedback loop)
```

### Step 5: Brief Template — Detailed Guidance

#### User Stories

User stories describe desired system behaviour in plain language. They form the bridge between the problem statement and the ticket decomposition — every ticket should trace back to at least one user story.

```
User Story Format
──────────────────────────────────────────────────────────────────

As a [persona], I want to [action] so that [outcome].

Examples:
  As a customer, I want to view my order history so that I can
    track past purchases without contacting support.
  As an admin, I want to bulk-import users via CSV so that
    onboarding large teams doesn't require manual entry.
  As a developer, I want the auth module to expose a thin
    interface so that I can mock it in integration tests.

Guidelines:
  - Write 3-8 user stories per brief (more = scope too large)
  - Each story must be testable (implies acceptance criteria)
  - Stories should cover the primary personas, not every edge case
  - Edge cases belong in Technical Considerations, not stories
  - Every ticket in the decomposition must trace to ≥1 story
```

#### Ticket Decomposition — Vertical Slices

Tickets must be **vertical slices** (tracer bullets), not horizontal layers. Each ticket cuts through all integration layers needed to deliver one thin, working piece of functionality end-to-end.

```
Vertical Slice Guidance
──────────────────────────────────────────────────────────────────

WRONG (horizontal layers):
  #1 [M] Set up database schema for portal
  #2 [M] Build API endpoints for portal
  #3 [M] Create React components for portal
  #4 [S] Wire up API calls in frontend
  #5 [S] Add tests

  Problem: nothing works until #4 is done. No value is
  deliverable until the very end. Integration bugs surface late.

RIGHT (vertical slices):
  #1 [S] Portal route + empty dashboard shell (E2E skeleton)
  #2 [M] SSO login flow (DB + API + UI for auth)
  #3 [M] Role-based access control (middleware + UI guards)
  #4 [S] Dashboard layout with real data (one widget)
  #5 [L] Full customer data views (remaining widgets)
  #6 [S] Navigation and breadcrumbs

  Each ticket delivers a working, testable, deployable slice.
  Integration is proven from ticket #1 onwards.

VALIDATION RULE:
  If a ticket title mentions only one layer (e.g. "Set up
  database schema", "Create React components"), flag it and
  restructure into a vertical slice that delivers observable
  behaviour.
```

#### Ticket Decomposition — HITL/AFK Classification

Each ticket in the decomposition table includes a `Mode` column indicating whether it requires human-in-the-loop (HITL) intervention or can run autonomously (AFK).

```
HITL/AFK Classification
──────────────────────────────────────────────────────────────────

Decomposition table columns:
  | # | Title | Description | Size | Deps | Mode | Ticket |

Mode values:
  AFK  — Ticket can be implemented autonomously by /clancy:once
         or /clancy:run without human intervention.
  HITL — Ticket requires human judgement, approval, or input
         during implementation (e.g. design decisions, API key
         provisioning, third-party service setup, UX review).

Classification heuristics:
  AFK when:
    - Pure code change with clear spec (add endpoint, fix bug)
    - Refactoring with existing test coverage
    - Adding tests for existing behaviour
    - Wiring up existing services/modules
  HITL when:
    - Requires credentials or secrets not yet provisioned
    - Involves UX/design decisions not specified in the brief
    - Needs external service setup (DNS, CI config, etc.)
    - Requires human review before proceeding (security, legal)
    - Ambiguous requirements that the brief couldn't resolve

Why this matters:
  /clancy:run uses the Mode tag to decide whether to pick up a
  ticket automatically (AFK) or skip it for human attention (HITL).
  This prevents autonomous runs from getting stuck on tickets
  that need human input.
```

### Step 2: Gather Idea — Mode-Specific Flows

```
MODE: BOARD TICKET
──────────────────────────────────────────────────────────────────

  Input: PROJ-123 / #42 / ENG-42
       |
       v
  Fetch ticket from board API
       |
  +----+----+----+----+
  |    |    |    |    |
  200  404  401  403  5xx/timeout
  |    |    |    |    |
  v    v    v    v    v
 OK   "Not  "Auth "Perm- "Server error
       found" failed" ission  / try later"
       (stop) (stop) denied" (stop)
                     (stop)
       |
       v
  Is it a PR? (GitHub only: pull_request field)
       |
  +----+----+
  Yes       No
  |         |
  v         v
"#42 is    Check status/state
a PR,
not issue"
(stop)
       |
       v
  Status/State check:
       |
  +----+----+----+----+
  Done/     In       Backlog/    Other/
  Closed/   Progress Unstarted/  Unknown
  Completed Started  Triage
  Cancelled          Open
  |         |        |           |
  v         v        v           v
 Warn      Warn     Continue    Continue
 (ask      "In      silently
 proceed?) progress"
  |         |
  v         v
 Y/N      Continue
  |        (with
 stop     warning)
 or
 continue


MODE: INLINE TEXT
──────────────────────────────────────────────────────────────────

  Input: "Add dark mode support"
       |
       v
  Use text directly as idea
  No API call, no status check
  Source: "Add dark mode support"


MODE: FROM FILE
──────────────────────────────────────────────────────────────────

  Input: --from docs/rfc.md
       |
       v
  File exists?
       |
  +----+----+
  No        Yes
  |         |
  v         v
"File not  File empty?
found"     |
(stop)   +-+----+
         No     Yes
         |      |
         v      v
        Read   "File is
        file    empty"
        content (stop)
         |
         v
        File > 50KB?
         |
        +--+----+
        No      Yes
        |       |
        v       v
       Use     Warn, truncate
       full    internally,
       content continue


MODE: INTERACTIVE (no args)
──────────────────────────────────────────────────────────────────

  Input: (none)
       |
       v
  Prompt: "What's the idea?"
       |
       v
  User types response
       |
       v
  Response looks like ticket ref?
  (#42, PROJ-123, ENG-42)
       |
  +----+----+
  Yes       No
  |         |
  v         v
"Looks like Switch to
a ticket   inline text
ref.       mode
Fetching..."
  |
  v
Switch to
board ticket
mode
```

### Step 2: Platform-Specific Fetch Details

```
Step 2: Fetch source ticket
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────
GET /repos/{repo}/          GET /rest/api/3/issue/      POST /graphql
  issues/{number}             {key}?fields=...            query { issues(
                                                           filter: {
Headers:                    Headers:                       identifier: {
  Authorization: Bearer       Authorization:                 eq: "ENG-42"
  Accept: vnd.github+json     Basic {base64}             } }) { nodes {
                              Accept: application/json     id, title, ...
                                                         } } }

Response fields:            Response fields:            Response fields:
  .number                     .key                        .nodes[0].id
  .title                      .fields.summary             .nodes[0].identifier
  .body (markdown/null)       .fields.description (ADF)   .nodes[0].title
  .state (open/closed)        .fields.status              .nodes[0].description
  .pull_request (PR check)      .statusCategory.key       .nodes[0].state.type
  .labels[].name              .fields.issuetype.name      .nodes[0].parent
  .milestone                  .fields.parent              .nodes[0].children
                              .fields.customfield_10014   .nodes[0].team
                              .fields.comment.comments[]  .nodes[0].labels
                              .fields.components          .nodes[0].priority
                              .fields.priority

Checks:                     Checks:                     Checks:
  pull_request != null?       statusCategory.key ==       state.type ==
    -> "Is a PR" (stop)         "done"?                     "completed"?
  state == "closed"?            -> Warn (ask [y/N])         -> Warn (ask)
    -> Warn (ask [y/N])       statusCategory.key ==       state.type ==
  body == null?                 "indeterminate"?            "canceled"?
    -> Warn (title only)        -> Warn (In Progress)       -> Warn (ask)
                              issuetype.name ==           state.type ==
                                "Epic"?                     "started"?
                                -> Note (informational)     -> Warn (ask)
                                                          parent != null?
                                                            -> Warn (3-level
                                                               hierarchy)
                                                          team.id != config?
                                                            -> Warn (cross-team)
```

### Step 6: Post to Board — Platform Details

```
Step 6: Post brief as comment on source ticket
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
  # Clancy Strategic Brief    ## Clancy Strategic Brief   # Clancy Strategic Brief
  (H1 heading)                (H2 ADF heading node)       (H1 heading)

On failure:                 On failure:                 On failure:
  Warn, keep local file      Warn, keep local file       Warn, keep local file
```

---

## Part 3: /clancy:approve-brief Complete Flow

### Master Flow Diagram

```
┌──────────────────────────────────────────────┐
│  /clancy:approve-brief <arg>                 │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 1: PREFLIGHT                           │
│  Same as /clancy:brief:                      │
│    - .clancy/.env exists + valid             │
│    - Board credentials valid (ping)          │
│    - Branch freshness check                  │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 2: LOAD BRIEF                          │
│                                              │
│  Scan .clancy/briefs/ for unapproved files   │
│  Match by: auto / index / slug / ticket ID   │
│  (see Part 1 selection tree)                 │
│                                              │
│  Already approved? -> stop                   │
│  No match? -> stop                           │
│  Multiple? -> ask user to pick               │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 3: PARSE DECOMPOSITION TABLE           │
│                                              │
│  Extract from brief:                         │
│    - # (sequence)                            │
│    - Title                                   │
│    - Description                             │
│    - Size (S/M/L)                            │
│    - Dependencies (#1, #3, etc.)             │
│    - Mode (AFK/HITL)                         │
│    - Ticket column (if partially created)    │
│                                              │
│  Validate:                                   │
│    0 tickets -> "No decomposition" (stop)    │
│    >10 tickets -> Warn (continue anyway)     │
│    Tickets already in Ticket column -> skip  │
│      those (partial resume)                  │
│    Circular deps -> "Circular dependency     │
│      between #N and #M" (stop)              │
│                                              │
│  Topological sort:                           │
│    Order tickets by dependency graph so      │
│    blockers are created before dependents.   │
│    This ensures blocking relationships can   │
│    be linked immediately after creation.     │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4: CONFIRM WITH USER                   │
│                                              │
│  Display:                                    │
│    Brief: {slug}                             │
│    Parent: {ticket or "none"}                │
│    Tickets to create (dependency order):     │
│      [1] [S] [AFK]  Title — No deps          │
│      [2] [M] [HITL] Title — Blocks #3, #4    │
│      [3] [M] [AFK]  Title — After #2         │
│    Labels: {list}                            │
│    Issue type: {type} (Jira only)            │
│                                              │
│  Proceed? [Y/n]                              │
│    n -> stop                                 │
│    Y -> continue                             │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 4a: DRY-RUN CHECK                     │
│                                              │
│  --dry-run flag set?                         │
│    YES -> Display: "Dry run complete.        │
│            No tickets created."              │
│            (stop)                            │
│    NO  -> continue                           │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 5: RESOLVE PARENT                      │
│  (platform-specific — see below)             │
└──────────────────────┬───────────────────────┘
                       │
                  Parent source?
                       │
       +───────────────+───────────────+
       |               |               |
  Board-sourced     --epic flag     No parent
  (source ticket    provided        (inline/file,
  = parent)         |               no --epic)
       |            |               |
       v            v               v
  Validate:      Validate:      Warn: "No parent.
  Fetch parent   Fetch --epic   Tickets will be
  status/state   target         standalone."
       |            |           Continue
       v            v           (omit parent
  Exists? Not     Same checks    field)
  Done/Closed?    as parent
       |
  +----+----+
  OK        Bad
  |         |
  v         v
 Use as    "Not found" /
 parent    "Is Done" (stop)
       |
       +───────────────────────────────+
                       |
                       v
┌──────────────────────────────────────────────┐
│  Step 6: LOOK UP QUEUE STATE / LABELS        │
│  (platform-specific — see below)             │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 6a: PRE-CREATION RACE CHECK            │
│                                              │
│  Create .approved marker with O_EXCL         │
│  (exclusive create — atomic check)           │
│    EEXIST -> "Being approved by another      │
│              process" (stop)                  │
│    OK -> continue (marker acts as lock)       │
│                                              │
│  NOTE: If creation fails later, delete       │
│  the marker (partial failure = not approved) │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 7: CREATE CHILD TICKETS                │
│  Sequential in topological (dependency)      │
│  order, 500ms delay between each.            │
│  (platform-specific — see below)             │
│                                              │
│  For each ticket in dependency order:        │
│    Already created (Ticket column)?          │
│      -> Skip (resume from partial)           │
│    Create via API (include Mode tag in       │
│      description/labels — see platform docs) │
│      -> Success: record key, display:        │
│         "[1/6] + PROJ-201 — Title [AFK]"     │
│      -> Failure: see error flows (Part 5)    │
│    Wait 500ms                                │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 8: LINK DEPENDENCIES                   │
│  (platform-specific — see below)             │
│  200ms delay between each (Jira/Linear)      │
│                                              │
│  Best-effort: warn on failure, don't stop    │
│  Skip links for uncreated tickets (partial)  │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 9: UPDATE BRIEF FILE                   │
│                                              │
│  Add created ticket keys to Ticket column    │
│  Update Status: Draft -> Approved            │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 10: MARK APPROVED                      │
│                                              │
│  All tickets created?                        │
│    YES -> .approved marker stays             │
│    NO  -> DELETE .approved marker             │
│           (partial failure = not approved)    │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 11: POST SUMMARY                       │
│  (platform-specific — see below)             │
│                                              │
│  Board-sourced or --epic?                    │
│    YES -> Post tracking comment on parent    │
│    NO  -> Skip                               │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 12: DISPLAY SUMMARY                    │
│                                              │
│  "N tickets created under {parent}"          │
│  List all: key — title (size) [Mode]         │
│  "Dependencies linked: N"                    │
│  "AFK-ready: X | Needs human: Y"            │
│  "Next: /clancy:plan"                        │
└──────────────────────┬───────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────┐
│  Step 13: LOG                                │
│                                              │
│  YYYY-MM-DD HH:MM | APPROVE_BRIEF | {slug}  │
│    | {N} tickets created                     │
└──────────────────────────────────────────────┘
```

### Step 5: Resolve Parent — Platform Details

```
Step 5: Resolve parent
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────
Parent = issue number       Parent = issue key          Parent = issue UUID

GET /repos/{repo}/          GET /rest/api/3/issue/      POST /graphql
  issues/{n}                  {key}?fields=summary,       issues(filter: {
                               status,issuetype           identifier: {
                                                            eq: "{KEY}"
                                                          }})

Checks:                     Checks:                     Checks:
  pull_request? -> stop       statusCategory.key          state.type ==
  state closed? -> warn         == "done"? -> warn          "completed"?
    (ask [y/N])                  (ask [y/N])                 -> warn (ask [y/N])
                              issuetype.name ==           state.type ==
                                "Epic"? -> note             "canceled"?
                                (ideal case)                -> warn (ask [y/N])
                                                          team.id != config?
                                                            -> warn (cross-team
                                                               children)

No parent (standalone):     No parent (standalone):     No parent (standalone):
  Omit parent refs in        Omit parent and             Omit parentId from
  issue body                  customfield_10014            mutation input
  No tracking comment         from payload
```

### Step 6: Look Up Queue State / Labels — Platform Details

```
Step 6: Pre-creation lookups
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────

Labels to apply:            Fields to validate:         Lookups needed:
  CLANCY_PLAN_LABEL           Issue type exists?         Backlog state UUID
    (default:                   GET /issue/createmeta/     workflowStates(
    "needs-refinement")          {proj}/issuetypes          filter: { team,
  CLANCY_LABEL (if set)       Not found? -> stop with      type: "backlog" })
  component:{COMPONENT}        available types list       Fallback: triage,
    (if CLANCY_COMPONENT)                                   unstarted, any
  size:{S|M|L}              Fields to set:
                              project.key               Label UUIDs:
Label pre-creation:           summary                     team.labels query
  POST /repos/{repo}/labels   description (ADF)           Exact name match
  If 403 (no admin):          issuetype.name              Not found? ->
    -> Create issue without    parent.key (or               auto-create label
       label, then warn         customfield_10014)          issueLabelCreate
  If 422 (label invalid):     labels[]                    Also check workspace
    -> Retry without label,    components[] (if set)        labels (fallback)
       warn                    priority (inherit parent)

                            Labels:
                              CLANCY_LABEL (if set)
                              Jira auto-creates labels
                              (no pre-creation needed)
```

### Step 7: Create Child Tickets — Platform Details

```
Step 7: Create child tickets
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────
POST /repos/{repo}/issues   POST /rest/api/3/issue      mutation {
                                                          issueCreate(input:
Body:                       Body:                           $input) }
{                           {
  "title": "...",             "fields": {               Input:
  "body": "<markdown>",         "project":              {
  "labels": [                     { "key": "PROJ" },      "teamId": "...",
    "needs-refinement",         "summary": "...",         "title": "...",
    "size:M",                   "description":            "description": "...",
    "component:api"               { ADF },                "parentId": "...",
  ],                            "issuetype":              "stateId": "<backlog
  "assignees": [                  { "name": "Task" },       UUID>",
    "<resolved_user>"           "parent":                 "labelIds": [
  ]                               { "key": "PROJ-200" },   "<label UUIDs>"
}                               "labels": ["clancy"],   ],
                                "components": [           "priority": 0
                                  { "name": "api" }     }
Parent linking:                 ],
  "Parent: #50" in body         "priority":
  (cross-reference)               { "name": "Medium" }
                              }
Dependency linking:         }
  "Depends on #51" in body
                            Parent fallback (classic):
                              IF parent field fails
                              with 400 ("parent" error)
                              THEN retry with:
                                customfield_10014:
                                  "PROJ-200"
                              Cache field choice for
                              remaining tickets

On success (201):           On success (201):           On success:
  Record .number              Record .key, .id            Record .id,
  Display:                    Display:                      .identifier
   "[1/N] + #51 — Title"      "[1/N] + PROJ-201 —        Display:
                                 Title"                    "[1/N] + ENG-43 —
                                                             Title"

500ms delay ─────────────── 500ms delay ─────────────── 500ms delay
```

### Step 8: Link Dependencies — Platform Details

```
Step 8: Link dependencies
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────
NO SEPARATE API CALL        POST /rest/api/3/issueLink  mutation {
                                                          issueRelationCreate(
Dependencies are            Body:                         input: {
embedded in issue body:     {                               issueId: "...",
  "Depends on #51"            "type":                       relatedIssueId:"...",
  "Depends on #52"              { "name": "Blocks" },       type: blockedBy
                              "inwardIssue":              })
GitHub auto-creates           { "key": "PROJ-202" },    }
cross-references from       "outwardIssue":
"#51" mentions.               { "key": "PROJ-203" }    issueId = dependent
                            }                           relatedIssueId = blocker
No delay needed.
                            inward = blocker            On fail: warn, continue
                            outward = dependent         (best-effort)

                            On fail: warn, continue
                            (best-effort)

                            200ms delay between links   200ms delay between links
```

### Step 11: Post Summary — Platform Details

```
Step 11: Post tracking summary on parent
──────────────────────────────────────────────────────────────────

GitHub                      Jira                        Linear
─────────────────────       ─────────────────────       ─────────────────────
POST /repos/{repo}/         POST /rest/api/3/issue/     mutation {
  issues/{parent}/comments    {parent}/comment            commentCreate(input: {
                                                            issueId: "...",
Body: Markdown table        Body: ADF table               body: "..."
  "## Clancy — Approved       listing all tickets        })
   Tickets"                                             }
  | # | Ticket | Size |    Same content in ADF
  | 1 | #51... | S    |    format                     Body: Markdown table
  ...                                                   listing all tickets
                                                        with identifiers
Creates GitHub cross-
references automatically    On fail: warn, continue     On fail: warn, continue
                            (tickets exist regardless)  (tickets exist regardless)
On fail: warn, continue
```

---

## Part 4: Re-brief Flow

### Auto-detect Decision Tree

```
/clancy:brief PROJ-123 (or #42, ENG-42)
       |
       v
  Scan .clancy/briefs/ for existing brief
  matching this ticket key in **Source:** line
       |
  +----+----+
  No        Yes
  |         |
  v         v
Generate  --fresh flag?
fresh     |
brief   +-+------+
(normal Yes      No
 flow)  |        |
        v        v
     Delete   Check for feedback
     old      from 3 sources
     file,    (see below)
     start         |
     fresh    +----+----+
     (normal  No        Yes
      flow)   feedback  feedback
              |         |
              v         v
           "Already   Merge all feedback.
            briefed.  Generate revised brief
            Add       with "Changes From
            feedback  Previous Brief" section.
            to        Overwrite local file.
            revise."  Post new comment on
            (stop)    ticket.
```

### Feedback Sources Per Platform

```
Feedback detection — 3 sources checked in order:
──────────────────────────────────────────────────────────────────

Source 1: LOCAL BRIEF FILE
  Check for ## Feedback section appended to
  .clancy/briefs/{date}-{slug}.md

Source 2: COMPANION FILE
  Check for .clancy/briefs/{date}-{slug}.feedback.md

Source 3: BOARD COMMENTS (board-sourced only)
  Find the most recent "Clancy Strategic Brief" comment.
  Collect all comments posted AFTER it.

  GitHub                    Jira                      Linear
  ───────────────────       ───────────────────       ───────────────────
  GET /issues/{n}/          Included in initial       query { issue(id:
    comments                  GET /issue/{key}          "...") {
    ?per_page=100             ?fields=comment           comments {
                                                          nodes { body,
  Filter:                   Filter:                         createdAt,
    created_at >              comment.comments[]            user }
    brief_comment             where created >            }
    .created_at               brief_comment             }
    AND user.login !=         .created timestamp       }
    resolved_username
                            Walk ADF body for          Filter:
                            "Clancy Strategic            createdAt > brief
                            Brief" heading               comment createdAt

Merge order:
  1. Local ## Feedback section
  2. .feedback.md file
  3. Board comments (chronological)
  All passed to agent for revision.

IMPORTANT — Source determines available feedback channels:
──────────────────────────────────────────────────────────────────

  Board-sourced brief (PROJ-123 / #42 / ENG-42):
    ALL 3 sources available:
      ✅ ## Feedback section in brief file
      ✅ .feedback.md companion file
      ✅ Board comments on the ticket

  Inline text / --from file brief:
    ONLY local sources available (no board ticket to comment on):
      ✅ ## Feedback section in brief file
      ✅ .feedback.md companion file
      ❌ Board comments (no ticket exists)

  This means for inline/file briefs, the user MUST use one of:
    1. Edit .clancy/briefs/{date}-{slug}.md and add ## Feedback at the end
    2. Create .clancy/briefs/{date}-{slug}.feedback.md with their feedback
  There is no other way to provide feedback for non-board briefs.
```

### Re-brief vs Fresh — Edge Cases

```
Scenario: Local brief exists, board comment deleted
──────────────────────────────────────────────────────────────────
  Local file found (by slug/key)
  Board comment NOT found
       |
       v
  Local feedback section exists?
       |
  +----+----+
  Yes       No
  |         |
  v         v
Revise    Board-sourced?
with         |
local      +-+-------+
feedback   Yes       No
           |         |
           v         v
         "Already  "Already
          briefed.  briefed.
          Comment   Add a ##
          on {KEY}  Feedback
          on your   section to
          board, or the brief
          add a ##  file, or
          Feedback  create a
          section   .feedback.md
          to the    companion
          brief     file, then
          file,     re-run.
          then      Or run
          re-run.   /clancy:brief
          Or run    --fresh to
          /clancy:  start over."
          brief     (stop)
          --fresh
          to start
          over."
          (stop)


Scenario: Board comment exists, local file deleted
──────────────────────────────────────────────────────────────────
  Local file NOT found
  Board comment found for this ticket
       |
       v
  Re-download brief from board comment
  into .clancy/briefs/
       |
       v
  Then check for feedback (normal re-brief flow)


Scenario: Multiple brief comments on same ticket
──────────────────────────────────────────────────────────────────
  Multiple "Clancy Strategic Brief" comments found
       |
       v
  Use MOST RECENT (latest created_at) as the
  reference point for feedback detection.
  Older brief comments are ignored.
```

---

## Part 5: Error Flows

### Ticket Creation Failures

```
Creating N tickets...
       |
       v
  For each ticket (sequential, 500ms delay):
       |
       v
  ┌─ API call ─┐
  |            |
  v            v
Success      Failure
  |            |
  v            v
Record       What type of error?
key,         |
display      +---+---+---+---+---+
check        |   |   |   |   |   |
             400 401 403 404 429 5xx/
             |   |   |   |   |   timeout
             |   |   |   |   |   |
             v   |   v   v   |   v
          Parse  |  STOP STOP |  STOP
          error  |  all  all  |  all
          fields |             |
             |   |             |
             v   v             v
          Specific          Rate limited
          handling          |
          (below)           v
                         Honour Retry-After
                         (Jira) / wait 60s
                         (Linear) / check
                         X-RateLimit-Reset
                         (GitHub)
                            |
                            v
                         Retry once
                            |
                       +----+----+
                       OK        Still limited
                       |         |
                       v         v
                    Continue   STOP all
                    to next    remaining


Jira-specific 400 handling:
──────────────────────────────────────────────────────────────────

  400 error on POST /issue
       |
       v
  Error mentions "parent" field?
       |
  +----+----+
  Yes       No
  |         |
  v         v
Retry with  Parse errors object:
customfield_   issuetype? -> "Set CLANCY_BRIEF_ISSUE_TYPE"
10014          components? -> Retry without, warn
(Epic Link     priority? -> Retry without, warn
fallback)      project? -> "Check JIRA_PROJECT_KEY"
  |
  v
Success?
  |
+-+----+
Yes    No
|      |
v      v
Cache  Both parent and Epic Link failed
field  |
choice v
for    "Could not set parent. Continue without? [y/N]"
batch  |
       +--+----+
       Y       N
       |       |
       v       v
    Create   STOP
    without
    parent


GitHub-specific 422 handling:
──────────────────────────────────────────────────────────────────

  422 error on POST /issues
       |
       v
  Error about labels?
       |
  +----+----+
  Yes       No
  |         |
  v         v
Retry     Other validation
without   error -> STOP
bad       with message
labels,
warn


Partial creation result:
──────────────────────────────────────────────────────────────────

  All tickets attempted
       |
       v
  All created?
       |
  +----+----+
  Yes       No (partial)
  |         |
  v         v
Mark      DON'T mark approved
approved  (delete .approved marker
           if created for race check)
  |         |
  v         v
Post      DON'T post tracking comment
tracking  (incomplete state)
comment     |
  |         v
  |       Update brief file with
  |       tickets that DID get created
  |         |
  |         v
  |       Display:
  |         "Partial: M of N created"
  |         List created: check marks
  |         List failed: X marks
  |         List skipped: skip marks
  |         "Re-run to resume"
  |         |
  v         v
Summary   Log: "PARTIAL - M of N"
+ Log


Resume from partial:
──────────────────────────────────────────────────────────────────

  /clancy:approve-brief (re-run)
       |
       v
  Brief not marked approved
  Parse decomposition table
       |
       v
  Tickets with Ticket column filled?
       |
  +----+----+
  No        Yes (some already created)
  |         |
  v         v
Normal    "Resuming: M already exist"
flow      |
          v
        For each ticket:
          Ticket column filled? -> Skip (display "already exists")
          Ticket column empty?  -> Create (normal flow)
          |
          v
        Also check board for existing children
        with matching titles (duplicate guard)
          |
          v
        Case-insensitive exact title match found?
          |
        +-+----+
        No     Yes
        |      |
        v      v
      Create "Already has children with
             similar titles. Continue? [y/N]"
             Default: N (don't duplicate)
```

### Source Ticket Errors — All Platforms

```
/clancy:brief <ticket>
       |
       v
  Fetch ticket from board
       |
  +----+----+----+----+----+----+
  |    |    |    |    |    |    |
  OK   404  401  403  410  5xx  Network
  |    |    |    |    |    |    error
  |    |    |    |    |    |    |
  v    v    v    v    v    v    v

GitHub:
  OK   "Not  "Check "Check  "Issues "Server "Check
       found  TOKEN" token   disabled error"  network"
       in           scopes" on repo"
       repo"

Jira:
  OK   "Not  "Check "Check   N/A    "Jira   "Check
       found  JIRA_  JIRA_          Cloud    network
       —check USER,  perms"         error,   and
       ticket API_                  try      JIRA_
       key"   TOKEN"                later"   BASE_URL"

Linear:
  OK   "Not  "Check  N/A     N/A    "Linear  "Check
       found  LINEAR_                API      network"
       on     API_KEY.               error"
       Linear" No Bearer
              prefix!"
```

### Network and Auth Error Flows

```
Network failure (any platform):
──────────────────────────────────────────────────────────────────

  fetch() throws (DNS failure, timeout, etc.)
       |
       v
  "Could not reach {platform} — check network connection
   and {URL config variable}"
  (stop, nothing logged)


Auth failure during creation (token expired mid-batch):
──────────────────────────────────────────────────────────────────

  Token works for preflight ping
  Token fails during ticket creation (401)
       |
       v
  STOP immediately
  Report: "Auth failed during creation.
           {M} of {N} tickets created before failure."
  List created tickets
  DO NOT mark approved
  "Check credentials and re-run to resume"


Timeout handling:
──────────────────────────────────────────────────────────────────

  GitHub: 15s timeout per API call
  Jira: 30s timeout per API call
  Linear: 30s timeout per GraphQL call

  On timeout:
    -> Treat as creation failure
    -> Warn: "Request timed out. Ticket may have been
              created server-side. Check board before re-run."
    -> Enter partial failure flow
```

---

## Part 6: --list Flow

```
/clancy:brief --list
       |
       v
  .clancy/briefs/ directory exists?
       |
  +----+----+
  No        Yes
  |         |
  v         v
"No briefs Scan .clancy/briefs/ for all .md files
found. Run
/clancy:brief
to create
one."
(stop)
       |
       v
  For each file:
    Parse: date (from filename prefix)
    Parse: Source (from **Source:** line)
    Parse: Status (Draft or Approved — check .approved marker)
    Parse: Ticket count (from decomposition table, "?" if unparseable)
    Calculate: age (today - date)
    Check: stale? (unapproved + age > 7 days)
       |
       v
  Sort by date (newest first)
       |
       v
  0 briefs found?
       |
  +----+----+
  Yes       No
  |         |
  v         v
"No briefs Display table:
found. Run
/clancy:brief
to create
one."

Display format:
──────────────────────────────────────────────────────────────────

  Clancy — Briefs
  ================================================================

    [1] dark-mode-support        2026-03-14  Draft     3 tickets  Source: #50
    [2] customer-portal          2026-03-13  Approved  8 tickets  Source: PROJ-200  OK
    [3] real-time-notifications  2026-03-12  Draft     4 tickets  Source: ENG-42
    [4] auth-rework              2026-03-05  Draft     6 tickets  Source: file      STALE (9 days)

  3 unapproved drafts. 1 stale (>7 days).

  To approve: /clancy:approve-brief <slug or index>
  To review stale briefs: open the file and add ## Feedback, or delete it.
```

---

## Part 7: Stale Brief Detection (Hook)

```
SessionStart (clancy-check-update.js hook fires)
       |
       v
  .clancy/briefs/ directory exists?
       |
  +----+----+
  No        Yes
  |         |
  v         v
Skip      Scan all .md files
(nothing    |
to check)   v
          For each .md file:
            |
            v
          Corresponding .approved marker exists?
            |
          +-+----+
          Yes    No
          |      |
          v      v
         Skip   Parse date from filename prefix
         (approved,   (YYYY-MM-DD-slug.md)
          not stale)   |
                       v
                     Date parseable?
                       |
                     +-+----+
                     Yes    No
                     |      |
                     v      v
                   Compare  Use file mtime
                   with     (fallback)
                   today      |
                       |      |
                       +------+
                       |
                       v
                     Age > 7 days?
                       |
                     +-+----+
                     Yes    No
                     |      |
                     v      v
                   Count   Skip
                   as
                   stale
       |
       v
  Total stale count
       |
  +----+----+
  0         1+
  |         |
  v         v
Nothing   Write count to cache file
to show   (.clancy/.brief-stale-count)
            |
            v
          CLAUDE.md template reads cache
            |
            v
          Display in session:
          "N unapproved brief(s) older than 7 days.
           Run /clancy:brief --list to review."
```

---

## Part 8: Batch Mode

```
/clancy:brief N (where N is a positive integer)
       |
       v
  N > 10?
       |
  +----+----+
  Yes       No
  |         |
  v         v
"Max batch Preflight (same as single)
is 10.       |
Briefing     v
10."       Fetch N issues from planning queue:
  |
  |        GitHub                Jira                  Linear
  |        GET /issues           POST /search/jql      query { issues(
  |          ?state=open           "project=PROJ        filter: {
  |          &labels=              AND status=           team: { id: ... }
  |            {PLAN_LABEL}        {PLAN_STATUS}         state: { type:
  |          &assignee=            ORDER BY rank"          { eq: "unstarted"
  |            {username}          maxResults: N           } }
  |          &per_page=N                                 assignee: { ... }
  |                                                    }) }
  |        Filter out PRs        Filter out epics
  |        (pull_request          (issuetype)
  |         field)
  |
  +--------+
           |
           v
     How many issues returned?
           |
      +----+----+
      0         1+
      |         |
      v         v
   "No issues  For each issue (sequential):
    in queue"     |
    (stop)        v
               Already briefed? (check .clancy/briefs/)
                  |
               +--+-----+
               Yes      No
               |        |
               v        v
              Skip    Run full brief flow
              "Already (Steps 1b through 8)
               briefed"   |
                  |        v
                  +--------+
                           |
                           v
                     Next issue (no delay needed)
                           |
                           v
                     All done:
                     "Briefed M of N tickets. K skipped."
```

---

## Part 9: Platform Comparison Tables

### API Endpoints Used

```
Operation               GitHub                    Jira                         Linear
──────────────────────  ────────────────────────  ─────────────────────────── ─────────────────────────
Fetch single ticket     GET /issues/{n}           GET /rest/api/3/issue/{key}  issues(filter: {
                                                    ?fields=...                 identifier: { eq }})

Fetch comments          GET /issues/{n}/comments  (included in issue fetch)   issue(id) { comments }

Post comment            POST /issues/{n}/comments POST /issue/{key}/comment   commentCreate mutation

Create ticket           POST /issues              POST /rest/api/3/issue      issueCreate mutation

Link dependency         (in issue body text)      POST /rest/api/3/issueLink  issueRelationCreate
                                                    type: "Blocks"              type: blockedBy

Validate issue type     N/A                       GET /issue/createmeta/      N/A
                                                    {proj}/issuetypes

Look up backlog state   N/A                       N/A                         workflowStates(filter:
                                                                                { team, type })

Look up labels          N/A (auto-created         N/A (auto-created           team.labels query +
                          or 422 fallback)           by Jira)                   workspace fallback

Create label            POST /repos/{r}/labels    N/A (auto-created)          issueLabelCreate mutation

Scan for duplicates     GET /issues?state=open    POST /search/jql            issues(filter: { ... })
                          &per_page=30              text match
```

### Parent/Child Mechanisms

```
                        GitHub                    Jira                         Linear
──────────────────────  ────────────────────────  ─────────────────────────── ─────────────────────────
Native parent/child     NO                        YES (next-gen: parent       YES (parentId field)
                                                    field; classic:
                                                    customfield_10014)

How Clancy links        "Parent: #N" in           Try parent field first.     parentId: UUID in
parent to child         child issue body.          If 400 -> fallback to       issueCreate input
                        Cross-reference created     customfield_10014.
                        automatically by GitHub.   Cache field per project.

Multi-level nesting     N/A (text refs only)      Supported but varies        Supported. Warn user
                                                    by project type             about 3-level depth.

Cross-team parenting    N/A                       Possible (same instance)    Supported. Warn about
                                                                                team mismatch.
```

### Labels and Fields

```
                        GitHub                    Jira                         Linear
──────────────────────  ────────────────────────  ─────────────────────────── ─────────────────────────
Planning queue          Label:                    Status:                     State type:
                          CLANCY_PLAN_LABEL         CLANCY_PLAN_STATUS          "backlog" (or
                          (default:                 (default: "Backlog")         fallback: triage,
                          "needs-refinement")                                    unstarted)

Clancy label            Label:                    Label:                      Label:
                          CLANCY_LABEL              CLANCY_LABEL                CLANCY_LABEL
                          (must exist or create)    (auto-created by Jira)      (auto-create if
                                                                                 missing)

Component               Label:                    Field:                      Label:
                          component:{value}         components[].name           component:{value}
                          (create if missing)       (error if not in project,   (auto-create if
                                                     retry without)              missing)

Size                    Label:                    (not mapped)                (not mapped)
                          size:{S|M|L}

Issue type              N/A (all are issues)      CLANCY_BRIEF_ISSUE_TYPE     N/A (all are issues)
                                                    (default: "Task")

Priority                N/A                       Inherit parent's priority   priority: 0
                                                    (or omit if none)           (No priority)

Assignee                Resolved via GET /user    Not set (team assigns)      Not set (team assigns)
                          (cached per process)

Milestone               Not propagated to         N/A                         N/A
                          children

Sprint                  N/A                       Not set (backlog)           N/A

Fix version             N/A                       Not inherited               N/A

Estimates               N/A                       N/A                         Not set (team-specific
                                                                                 scale)
```

### Comment Format

```
                        GitHub                    Jira                         Linear
──────────────────────  ────────────────────────  ─────────────────────────── ─────────────────────────
Format                  Markdown                  ADF (Atlassian Document     Markdown
                                                    Format)

Marker heading          # Clancy Strategic Brief  ## Clancy Strategic Brief   # Clancy Strategic Brief
                        (H1)                      (H2 ADF heading node)       (H1)

Size limit              ~65KB body                ~32KB ADF                   No documented limit

Fallback on             N/A (markdown native)     Wrap entire brief in        N/A (markdown native)
complex content                                     codeBlock ADF node

Feedback detection      Scan comments with        Walk ADF body for marker    Query issue.comments,
                          created_at > brief        heading. Collect            sort by createdAt.
                          comment. Filter by         comments after brief       Collect after brief
                          user.login.                by timestamp.              comment.
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

Timeout                 15s                       30s                         30s

Retry strategy          Check X-RateLimit-Reset   Honour Retry-After header   Wait 60s, retry 2x max
                          Wait until reset          Wait, retry once
```

### Progress Log Entries

```
Scenario                              Log Entry
──────────────────────────────────── ────────────────────────────────────────────
Brief generated                       YYYY-MM-DD HH:MM | BRIEF | {slug} | N proposed tickets
Brief revised (feedback)              YYYY-MM-DD HH:MM | BRIEF | {slug} | REVISED - N proposed tickets
Brief skipped (not relevant)          YYYY-MM-DD HH:MM | BRIEF | {slug} | SKIPPED - not relevant ({reason})
Brief skipped (ticket Done)           YYYY-MM-DD HH:MM | BRIEF | {slug} | SKIPPED - ticket is Done
Brief skipped (not found)             YYYY-MM-DD HH:MM | BRIEF | {slug} | SKIPPED - ticket not found
Approve: full success                 YYYY-MM-DD HH:MM | APPROVE_BRIEF | {slug} | N tickets created
Approve: partial failure              YYYY-MM-DD HH:MM | APPROVE_BRIEF | {slug} | PARTIAL - M of N created
Brief already exists (no feedback)    (nothing logged)
Approve: already approved             (nothing logged)
Auth/network failure                  (nothing logged)
--list display                        (nothing logged)
```

### New Config Variables

```
Variable                   Default      Platforms    Purpose
─────────────────────────  ──────────── ─────────── ─────────────────────────────
CLANCY_BRIEF_ISSUE_TYPE    Task         Jira only    Issue type for created tickets
CLANCY_BRIEF_EPIC          (none)       All          Default parent for text/file briefs
CLANCY_COMPONENT           (none)       All          Auto-set on created tickets:
                                                       Jira: components[] field
                                                       GitHub: component:{val} label
                                                       Linear: component:{val} label
```

### File System Artifacts

```
Path                                              Purpose
──────────────────────────────────────────────── ─────────────────────────────────
.clancy/briefs/                                   Directory for all briefs
.clancy/briefs/{YYYY-MM-DD}-{slug}.md             Brief file (markdown)
.clancy/briefs/{YYYY-MM-DD}-{slug}.md.approved    Approval marker (empty or timestamp)
.clancy/briefs/{YYYY-MM-DD}-{slug}.feedback.md    Optional companion feedback file
.clancy/.brief-stale-count                        Cache file for stale brief hook
.clancy/progress.txt                              Progress log (appended)
```
