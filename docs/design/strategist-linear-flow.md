# Strategist Role — Linear Flow Document

Comprehensive flow and edge-case analysis for `/clancy:brief` and `/clancy:approve-brief` on Linear.

---

## Table of Contents

1. [Linear API Primitives](#1-linear-api-primitives)
2. [Happy Path: `/clancy:brief ENG-42`](#2-happy-path-clancybrief-eng-42)
3. [Happy Path: `/clancy:brief "Add real-time notifications"`](#3-happy-path-clancybrief-inline-text)
4. [Happy Path: `/clancy:brief --from docs/rfc.md`](#4-happy-path-clancybrief---from-file)
5. [Happy Path: `/clancy:approve-brief ENG-42`](#5-happy-path-clancyapprove-brief-eng-42)
6. [Edge Cases: Issue Resolution](#6-edge-cases-issue-resolution)
7. [Edge Cases: Issue State](#7-edge-cases-issue-state)
8. [Edge Cases: Parent/Child Relationships](#8-edge-cases-parentchild-relationships)
9. [Edge Cases: Labels and Components](#9-edge-cases-labels-and-components)
10. [Edge Cases: Workflow States](#10-edge-cases-workflow-states)
11. [Edge Cases: API Failures](#11-edge-cases-api-failures)
12. [Edge Cases: Idempotency and Re-runs](#12-edge-cases-idempotency-and-re-runs)
13. [Edge Cases: Multi-Team Workspaces](#13-edge-cases-multi-team-workspaces)
14. [Edge Cases: Permissions](#14-edge-cases-permissions)
15. [Edge Cases: Estimates and Priority](#15-edge-cases-estimates-and-priority)
16. [New Linear API Operations Required](#16-new-linear-api-operations-required)
17. [New Zod Schemas Required](#17-new-zod-schemas-required)

---

## 1. Linear API Primitives

### Identifier resolution: `ENG-42` to UUID

Linear's GraphQL API does **not** accept human-readable identifiers (e.g. `ENG-42`) as the `id` argument to the `issue()` query. The `id` field expects a UUID. To resolve a human-readable identifier, use the `issueVcsBranchSearch` query or filter on `identifier`:

```graphql
query($identifier: String!) {
  issueVcsBranchSearch(branchName: $identifier) {
    id
    identifier
    title
    description
    state { type }
    parent { id identifier title }
    children { nodes { id identifier title } }
    team { id key }
    labels { nodes { id name } }
    priority
    estimate
  }
}
```

**Alternative (more reliable):** Use the `issues` filter with `identifier` comparison:

```graphql
query($identifier: String!) {
  issues(filter: { identifier: { eq: $identifier } }) {
    nodes {
      id
      identifier
      title
      description
      state { id name type }
      parent { id identifier title }
      children { nodes { id identifier title state { type } } }
      team { id key }
      labels { nodes { id name } }
      priority
      estimate
    }
  }
}
```

**Decision:** Use the `issues(filter: { identifier: { eq: $identifier } })` approach. It is the most direct and reliable way to resolve a human-readable key to a UUID. The `issueVcsBranchSearch` is designed for VCS branch matching and may behave unexpectedly with exact identifiers.

### Auth header

Linear personal API keys are passed directly in the `Authorization` header — **no** `Bearer` prefix. This is already handled by the existing `linearGraphql()` function in `src/scripts/board/linear/linear.ts`.

### Rate limiting

Linear's GraphQL API uses a complexity-based rate limit (not simple per-request). Each query has a computed cost. The limit is approximately 1,500 complexity points per minute for personal API keys. Simple queries cost 1-10 points; mutations cost more. For batch ticket creation (max 10 tickets per brief), a 500ms delay between mutations is sufficient and matches the design doc's specification.

---

## 2. Happy Path: `/clancy:brief ENG-42`

### What the user does

Runs `/clancy:brief ENG-42` in a project with Linear configured in `.clancy/.env`.

### API calls Clancy makes

**Step 1 — Preflight:**
No Linear API call. Validates `.clancy/.env` exists, parses env vars with `linearEnvSchema`, runs branch freshness check.

**Step 2 — Fetch the source issue:**

```graphql
query($identifier: String!) {
  issues(filter: { identifier: { eq: $identifier } }) {
    nodes {
      id
      identifier
      title
      description
      state { id name type }
      parent { id identifier title }
      children { nodes { id identifier title state { type } } }
      team { id key }
      labels { nodes { id name } }
      priority
      estimate
    }
  }
}
```

Variables: `{ "identifier": "ENG-42" }`

**Step 2a — Validate team match:**
Compare `issue.team.id` against `LINEAR_TEAM_ID` from env. If they don't match, warn but continue (the issue exists, the user explicitly asked for it).

**Step 3 — Research:**
No additional Linear API calls. Codebase exploration only (read `.clancy/docs/`, explore affected areas). Web research if triggered by judgement or `--research` flag.

**Step 4 — Generate brief:**
Pure local computation. No API calls. Include `## Discovery` section with Q&A from the grill phase (each answer tagged with source: human, codebase, board, or web). Include `## Open Questions` for any unresolved questions.

**Step 5 — Save brief:**
Write to `.clancy/briefs/{YYYY-MM-DD}-{slug}.md`. No API calls.

**Step 6 — Post brief as comment on ENG-42:**

```graphql
mutation($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
    comment {
      id
    }
  }
}
```

Variables: `{ "issueId": "<UUID from step 2>", "body": "<full brief markdown>" }`

**Step 7 — Display brief locally.**

**Step 8 — Log to progress.txt.**

### On success

- Brief file created at `.clancy/briefs/2026-03-14-real-time-notifications.md`
- Comment posted on ENG-42 in Linear with the full brief
- Brief `Source` field reads: `[ENG-42] Add real-time notifications`
- Progress log entry: `2026-03-14 14:30 | BRIEF | real-time-notifications | 4 proposed tickets`
- User sees the full brief and next-step instructions

### On failure

See edge cases below for specific failure modes. General principle: if the comment fails to post, print the brief to stdout as fallback and warn.

### What gets logged to progress.txt

```
2026-03-14 14:30 | BRIEF | real-time-notifications | 4 proposed tickets
```

### What the user sees

```
Clancy — Brief

[ENG-42] Add real-time notifications
  Fetching issue from Linear...
  Exploring codebase... (2 agents)
  Generating brief...
  ✅ Brief saved to .clancy/briefs/2026-03-14-real-time-notifications.md
  ✅ Brief posted as comment on ENG-42

<full brief content>

Next steps:
  To request changes:
    • Comment on ENG-42 in Linear, then re-run /clancy:brief ENG-42 to revise
    • Or add a ## Feedback section to the brief file and re-run
  To approve: /clancy:approve-brief ENG-42
  To start over: /clancy:brief --fresh ENG-42

"Let me dust this for prints..."
```

---

## 3. Happy Path: `/clancy:brief "Add real-time notifications"`

### What the user does

Runs the command with inline text. No board ticket involved.

### API calls Clancy makes

**None to Linear.** The idea comes from inline text, not the board. Codebase research only.

### On success

- Brief file created at `.clancy/briefs/2026-03-14-add-real-time-notifications.md`
- No comment posted anywhere (no source ticket)
- Brief `Source` field reads: `"Add real-time notifications"`
- User is told to use `--epic ENG-XX` when approving if they want tickets created under a parent

### On failure

Only local failures possible (disk write). No API calls to fail.

### What gets logged

```
2026-03-14 14:30 | BRIEF | add-real-time-notifications | 3 proposed tickets
```

### What the user sees

```
Clancy — Brief

"Add real-time notifications"
  Exploring codebase... (1 agent)
  Generating brief...
  ✅ Brief saved to .clancy/briefs/2026-03-14-add-real-time-notifications.md

<full brief content>

Next steps:
  To request changes:
    • Add a ## Feedback section to:
      .clancy/briefs/2026-03-14-add-real-time-notifications.md
    • Or create a companion file:
      .clancy/briefs/2026-03-14-add-real-time-notifications.feedback.md
    Then re-run /clancy:brief to revise.
  To approve: /clancy:approve-brief add-real-time-notifications
  To attach to a parent: /clancy:approve-brief add-real-time-notifications --epic ENG-XX
  To start over: /clancy:brief --fresh "Add real-time notifications"

"Let me dust this for prints..."
```

---

## 4. Happy Path: `/clancy:brief --from docs/rfc.md`

### What the user does

Points Clancy at a local file containing a longer-form idea or RFC.

### API calls Clancy makes

**None to Linear.** File is read locally. Same as inline text — no board interaction during brief generation.

### On success

- Brief file created with slug derived from the file name: `.clancy/briefs/2026-03-14-rfc.md`
- Brief `Source` field reads: `docs/rfc.md`
- No comment posted

### Failure modes

- File doesn't exist: `Error: File not found: docs/rfc.md`
- File is empty: `Error: File is empty: docs/rfc.md`
- File is binary: `Error: Cannot read binary file: docs/rfc.md`
- File is extremely large (>50KB): Warn: `! Large file ({size}KB). Clancy will use the first ~50KB for context.` Truncate internally, continue.

---

## 5. Happy Path: `/clancy:approve-brief ENG-42`

### What the user does

After reviewing and being satisfied with the brief for ENG-42, runs `/clancy:approve-brief ENG-42`.

### Matching the brief

Scan `.clancy/briefs/` for unapproved files (no corresponding `.approved` marker). For each file, check the `**Source:**` line for the identifier `ENG-42`. If found, that's the brief to approve.

### API calls Clancy makes

**Step 1 — Preflight:** Validate env, branch freshness.

**Step 2 — Load brief:** Local file read. Parse the ticket decomposition table (including Mode column: AFK/HITL). Topological sort by dependency graph. Detect circular dependencies (error + stop).

**Step 3 — Confirm:** Display ticket list with sizes, mode tags, and parent (in dependency order). Show AFK/HITL breakdown. Ask Y/n.

**Step 4 — Resolve parent issue UUID (ENG-42):**

```graphql
query($identifier: String!) {
  issues(filter: { identifier: { eq: $identifier } }) {
    nodes {
      id
      identifier
      team { id key }
    }
  }
}
```

This gives us the UUID for `parentId` on child issues.

**Step 5 — Look up backlog state ID:**

```graphql
query($teamId: String!) {
  workflowStates(filter: {
    team: { id: { eq: $teamId } }
    type: { eq: "backlog" }
  }) {
    nodes { id name }
  }
}
```

This returns all states with type `backlog`. Use the first one. The `type` enum is what matters — team-specific state names (e.g. "Backlog", "Icebox", "To Do") vary but the type is always `backlog`.

**Step 6 — Look up label IDs (if needed):**

If `CLANCY_LABEL` is set, or if `CLANCY_COMPONENT` is set (needs `component:{value}` label):

```graphql
query($teamId: String!) {
  team(id: $teamId) {
    labels { nodes { id name } }
  }
}
```

Search the returned labels for exact name matches. If a label doesn't exist, create it (see edge case 9).

**Mode labels:** Also look up/create `clancy:afk` and `clancy:hitl` labels. Apply the appropriate one to each ticket based on its Mode classification. These labels are used by `/clancy:run` to decide whether to pick up the ticket autonomously.

**Step 7 — Create child issues (one per decomposition row, dependency order):**

For each ticket in topological (dependency) order, with 500ms delay between calls:

```graphql
mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      title
      url
    }
  }
}
```

Variables:

```json
{
  "input": {
    "teamId": "<LINEAR_TEAM_ID>",
    "title": "<ticket title from decomposition>",
    "description": "Epic: ENG-42\n\n<ticket description from decomposition>",
    "parentId": "<UUID of ENG-42>",
    "stateId": "<backlog state UUID>",
    "labelIds": ["<CLANCY_LABEL UUID>", "<component label UUID>", "<mode label UUID>"],
    "priority": 0
  }
}
```

**Epic reference:** The description always starts with `Epic: {parent-identifier}` (e.g., `Epic: ENG-42`). This text convention enables cross-platform epic completion detection — `fetchChildrenStatus` searches for this reference rather than relying on Linear's parent/child API (which requires UUIDs not available in the progress flow).

**Step 8 — Link dependencies:**

For tickets with dependencies (e.g. ticket #2 depends on #1), create issue relations:

```graphql
mutation($issueId: String!, $relatedIssueId: String!) {
  issueRelationCreate(input: {
    issueId: $issueId,
    relatedIssueId: $relatedIssueId,
    type: blockedBy
  }) {
    success
  }
}
```

Where `issueId` is the dependent ticket and `relatedIssueId` is the blocking ticket. Both are UUIDs from the `issueCreate` responses.

**Step 9 — Update brief file:** Add created ticket identifiers to the decomposition table.

**Step 10 — Mark approved:** Create `.approved` marker file.

**Step 11 — Post summary comment on parent (ENG-42):**

```graphql
mutation($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
  }
}
```

Body: a summary of created tickets with identifiers and links.

### On success

- 4 child issues created under ENG-42 in Linear, all in backlog state
- Dependencies linked via `issueRelationCreate`
- Brief file updated with ticket identifiers in the decomposition table
- `.approved` marker created
- Summary comment posted on ENG-42
- Progress log updated

### What gets logged

```
2026-03-14 15:00 | APPROVE_BRIEF | real-time-notifications | 4 tickets created
```

### What the user sees

```
Clancy — Approve Brief

Brief: real-time-notifications
Source: [ENG-42] Add real-time notifications
Parent: ENG-42

Tickets to create (dependency order):
  #1  [S] [AFK]  Set up WebSocket infrastructure — No deps
  #2  [M] [AFK]  Implement notification service — After #1
  #3  [S] [HITL] Add notification preferences UI — After #1
  #4  [S] [AFK]  Add notification badge component — After #2

AFK-ready: 3 | Needs human: 1

Create 4 tickets under ENG-42? [Y/n] Y

  [1/4] ✅ ENG-43 — Set up WebSocket infrastructure
  [2/4] ✅ ENG-44 — Implement notification service
  [3/4] ✅ ENG-45 — Add notification preferences UI
  [4/4] ✅ ENG-46 — Add notification badge component
  ✅ Dependencies linked
  ✅ Summary posted on ENG-42
  ✅ Brief marked as approved

4 tickets created under ENG-42.
Run /clancy:plan to generate implementation plans.

"Book 'em, Lou."
```

---

## 6. Edge Cases: Issue Resolution

### 6a. Identifier doesn't match any issue

**What the user does:** `/clancy:brief ENG-999` where ENG-999 doesn't exist.

**API call:** `issues(filter: { identifier: { eq: "ENG-999" } })` returns `{ nodes: [] }`.

**What happens:** Clancy detects empty result.

**What the user sees:**

```
✗ Issue ENG-999 not found on Linear. Check the identifier and try again.
```

**Logged:** Nothing. Command aborts.

### 6b. Identifier format is invalid

**What the user does:** `/clancy:brief eng42` (missing hyphen) or `/clancy:brief 42`.

**Detection:** Before making any API call, validate the identifier format. Linear identifiers follow the pattern `{TEAM_KEY}-{NUMBER}` (e.g. `ENG-42`). The regex is `/^[A-Z]{1,10}-\d+$/i`.

For bare numbers (e.g. `42`), this is ambiguous — could be a GitHub issue number. Since the board is Linear, reject with a helpful message.

**What the user sees:**

```
✗ "42" doesn't look like a Linear issue identifier. Linear uses the format TEAM-123 (e.g. ENG-42).
```

**Logged:** Nothing.

### 6c. Identifier belongs to a different team

**What the user does:** `/clancy:brief DES-15` where `LINEAR_TEAM_ID` is the Engineering team, but DES is the Design team.

**API call:** The `issues` filter query does not filter by team — it returns the issue regardless of team. The issue is found.

**What happens:** Compare `issue.team.id` with `LINEAR_TEAM_ID`. They differ.

**Decision:** Warn but continue. The user explicitly asked for this issue. The warning helps them understand that child tickets will be created under `LINEAR_TEAM_ID`, not the source issue's team.

**What the user sees:**

```
⚠ DES-15 belongs to team "Design", but your LINEAR_TEAM_ID is set to "Engineering".
  Child tickets will be created in the Engineering team.
  Continue? [Y/n]
```

If they proceed, the brief is generated normally. If they abort, nothing happens.

**Logged:** If they continue, normal brief log. If they abort, nothing.

---

## 7. Edge Cases: Issue State

### 7a. Issue is in a completed state

**What the user does:** `/clancy:brief ENG-42` where ENG-42 has state type `completed`.

**Detection:** The query returns `state { type }`. Check if `type` is `completed` or `canceled`.

**What the user sees:**

```
⚠ ENG-42 is in state "Done" (completed). Briefing a completed issue is unusual.
  Continue anyway? [Y/n]
```

**Rationale:** Don't hard-block. The user may want to re-open and decompose a ticket that was prematurely closed, or they may be briefing a "wishlist" item that was closed as "won't do" but is now being reconsidered.

### 7b. Issue is in a cancelled state

Same treatment as completed. Warn, allow override.

```
⚠ ENG-42 is in state "Cancelled" (canceled). Briefing a cancelled issue is unusual.
  Continue anyway? [Y/n]
```

### 7c. Issue is already in progress

**What the user does:** `/clancy:brief ENG-42` where ENG-42 has state type `started`.

**What the user sees:**

```
⚠ ENG-42 is in state "In Progress" (started). It may already be under active development.
  Continue anyway? [Y/n]
```

### 7d. Issue state type is `unstarted` or `backlog` or `triage`

No warning. These are the expected states for a vague ticket that needs decomposition.

---

## 8. Edge Cases: Parent/Child Relationships

### 8a. ENG-42 already has sub-issues

**What the user does:** `/clancy:brief ENG-42` or `/clancy:approve-brief ENG-42` where ENG-42 already has children.

**Detection:** The fetch query includes `children { nodes { id identifier title state { type } } }`. Check if `nodes.length > 0`.

**During `/clancy:brief`:** Informational only. Show existing children so the brief can account for them.

```
ℹ ENG-42 already has 3 sub-issues:
  • ENG-43 — Set up WebSocket infrastructure (backlog)
  • ENG-44 — Implement notification service (started)
  • ENG-45 — Add notification preferences UI (completed)

The brief will account for existing sub-issues to avoid duplication.
```

The brief generation step receives this context and should avoid proposing tickets that duplicate existing children.

**During `/clancy:approve-brief`:** This is the critical scenario. New children will be added alongside existing ones.

```
⚠ ENG-42 already has 3 sub-issues. New tickets will be added as additional children.

Existing sub-issues:
  • ENG-43 — Set up WebSocket infrastructure
  • ENG-44 — Implement notification service
  • ENG-45 — Add notification preferences UI

New tickets to create:
  #1  [S] Add notification badge component
  #2  [M] Add push notification support        (depends on #1)

Create 2 additional tickets under ENG-42? [Y/n]
```

**No conflict.** Linear's parent/child model allows multiple children. New children are simply appended. No risk of overwriting.

### 8b. ENG-42 already has a parent (it's a child issue itself)

**What the user does:** `/clancy:brief ENG-42` where ENG-42 is itself a child of ENG-10.

**Detection:** The query returns `parent { id identifier title }`. If present, ENG-42 has a parent.

**Decision:** Warn. The user is trying to make a child issue into a parent — creating a three-level hierarchy. Linear supports multi-level nesting, but it can get confusing.

```
⚠ ENG-42 is a sub-issue of ENG-10 (Project Alpha).
  Creating children under ENG-42 will produce a 3-level hierarchy: ENG-10 → ENG-42 → new tickets.
  Continue? [Y/n]
```

### 8c. `--epic` points to a non-existent issue

**What the user does:** `/clancy:approve-brief add-real-time-notifications --epic ENG-999`

**API call:** Resolve `ENG-999` — returns empty.

**What the user sees:**

```
✗ Epic ENG-999 not found on Linear. Check the identifier and try again.
```

**Logged:** Nothing.

### 8d. No `--epic` and no board source (inline/file brief)

**What the user does:** `/clancy:approve-brief add-real-time-notifications` with no `--epic` flag, and the brief was from inline text.

**What happens:** Tickets are created as top-level issues (no `parentId`). They are standalone in the backlog.

**What the user sees:**

```
ℹ No parent epic specified. Tickets will be created as standalone issues.
  To attach to a parent, re-run with: /clancy:approve-brief add-real-time-notifications --epic ENG-XX

Create 4 standalone tickets? [Y/n]
```

---

## 9. Edge Cases: Labels and Components

### 9a. `CLANCY_LABEL` is set but doesn't exist in the team

**What the user does:** Has `CLANCY_LABEL=clancy-managed` in `.clancy/.env`, but no such label exists in Linear.

**Detection:** Query team labels. Search for exact match. Not found.

**Decision:** Auto-create the label. Linear labels are lightweight — creating one is non-destructive.

**API call:**

```graphql
mutation($teamId: String!, $name: String!) {
  issueLabelCreate(input: { teamId: $teamId, name: $name }) {
    success
    issueLabel { id name }
  }
}
```

**What the user sees:**

```
ℹ Label "clancy-managed" not found in team — creating it.
  ✅ Label created.
```

**On failure to create label:** Warn and continue without the label. Labels are nice-to-have, not blocking.

```
⚠ Failed to create label "clancy-managed". Tickets will be created without it.
```

### 9b. `CLANCY_COMPONENT` is set

**Behaviour:** Linear doesn't have a dedicated component field. The design doc specifies using a `component:{value}` label (e.g. `component:api`).

**Detection:** Look up `component:api` in team labels. If not found, create it (same as 9a).

**What the user sees:** Same label creation flow. Both `CLANCY_LABEL` and `component:{value}` labels are collected into a single `labelIds` array on issue creation.

### 9c. `CLANCY_LABEL` has special characters

**What the user does:** Sets `CLANCY_LABEL=clancy: managed` (contains colon/space).

**Detection:** Linear labels can contain any characters. No validation issue. Pass through as-is.

### 9d. Label lookup returns a workspace-level label, not team-level

Linear has both workspace-level and team-level labels. The `team.labels` query returns only team-level labels. If `CLANCY_LABEL` exists as a workspace label but not a team label, the lookup will miss it.

**Solution:** Also query workspace labels if team labels don't match:

```graphql
query($name: String!) {
  issueLabels(filter: { name: { eq: $name } }) {
    nodes { id name }
  }
}
```

Workspace labels can be applied to any team's issues. If found at workspace level, use it. If not found anywhere, create at team level.

---

## 10. Edge Cases: Workflow States

### 10a. No backlog state type exists

**What the user does:** Team has customised their workflow and removed all backlog-type states.

**Detection:** `workflowStates(filter: { team: ..., type: { eq: "backlog" } })` returns empty `nodes`.

**Fallback:** Try `triage` type, then `unstarted` type. If none found, use the first state of any type (the team's default).

```graphql
# Fallback query — get all states, pick the first non-started one
query($teamId: String!) {
  workflowStates(filter: {
    team: { id: { eq: $teamId } }
  }) {
    nodes { id name type }
  }
}
```

**What the user sees:**

```
⚠ No "backlog" state found for team. Using "Triage" instead.
```

Or, if truly nothing reasonable:

```
⚠ Could not determine a backlog state. Tickets will use the team's default state.
```

### 10b. Multiple backlog-type states exist

Some teams have multiple states with type `backlog` (e.g. "Backlog" and "Icebox").

**Decision:** Use the first one returned by the API. Linear's API returns states in the order they appear in the workflow. The first `backlog` state is typically the most "active" backlog.

No warning needed. This is normal.

### 10c. `CLANCY_PLAN_STATE_TYPE` overrides the default

If `CLANCY_PLAN_STATE_TYPE` is set in `.clancy/.env`, use that state type instead of `backlog` for created issues. This allows teams to customise where new tickets land.

---

## 11. Edge Cases: API Failures

### 11a. Network failure during issue fetch (`/clancy:brief`)

**Detection:** `linearGraphql()` returns `undefined` (already handles network errors).

**What the user sees:**

```
✗ Could not reach Linear API. Check your network connection and try again.
```

**Logged:** Nothing.

### 11b. Network failure during comment post (`/clancy:brief`)

**What happens:** Brief is already saved locally. Only the comment post fails.

**What the user sees:**

```
  ✅ Brief saved to .clancy/briefs/2026-03-14-real-time-notifications.md
  ⚠ Failed to post comment on ENG-42. You can paste the brief manually.
```

**Logged:** Normal brief log entry. The brief exists locally — the comment is a convenience.

### 11c. Partial failure during ticket creation (`/clancy:approve-brief`)

**Scenario:** 4 tickets to create. Tickets 1 and 2 succeed. Ticket 3 fails (network blip). Ticket 4 not attempted.

**What happens:**

1. Tickets 1 and 2 exist in Linear and are fully functional
2. Ticket 3 creation fails
3. **Stop immediately** — do NOT attempt remaining tickets. A failure likely indicates a systemic issue (API outage, permission problem, rate limit). Continuing wastes rate limit budget and creates confusing partial state.
4. Report partial success

**What the user sees:**

```
  [1/4] ✅ ENG-43 — Set up WebSocket infrastructure
  [2/4] ✅ ENG-44 — Implement notification service
  [3/4] ✗ Failed to create "Add notification preferences UI" — Linear API error
  -  #4 not attempted

⚠ Partial creation: 2 of 4 tickets created

Created tickets are live on Linear. To complete:
  1. Fix the issue (check Linear status/permissions)
  2. Re-run /clancy:approve-brief ENG-42 to resume creating remaining tickets
```

**Idempotency for re-run:** Before creating each ticket, check if a child issue with the same title already exists under the parent. If it does, skip it and use the existing issue's UUID for dependency linking.

**Logged:** Nothing (brief not approved due to partial failure).

### 11d. Dependency linking fails

**Scenario:** All 4 tickets created successfully, but `issueRelationCreate` fails for one dependency.

**What happens:** Warn but still mark as approved. Dependency links are informational, not blocking. The user can manually add them in Linear.

**What the user sees:**

```
  [1/4] ✅ ENG-43 — Set up WebSocket infrastructure
  [2/4] ✅ ENG-44 — Implement notification service
  [3/4] ✅ ENG-45 — Add notification preferences UI
  [4/4] ✅ ENG-46 — Add notification badge component
  ⚠ Failed to link dependency: ENG-44 blocked by ENG-43. Add manually in Linear.
  ✅ Summary posted on ENG-42
  ✅ Brief marked as approved
```

### 11e. Auth failure (401/403)

**Detection:** `linearGraphql()` returns `undefined` after logging `HTTP 401` or `HTTP 403`.

**What the user sees:**

```
✗ Linear authentication failed. Check LINEAR_API_KEY in .clancy/.env.
  Hint: Linear personal API keys do NOT use the "Bearer" prefix.
```

### 11f. Rate limiting (429 or complexity exceeded)

**Detection:** Linear returns an error response with rate limit information in the `errors` array. The `linearGraphql()` function currently doesn't distinguish between error types — it needs enhancement.

**Proposed enhancement:** Check for rate limit errors in the response body:

```json
{
  "errors": [
    {
      "message": "Rate limit exceeded",
      "extensions": { "code": "RATELIMITED" }
    }
  ]
}
```

**What happens:** Wait 60 seconds (Linear's rate limit window), then retry. Max 2 retries.

**What the user sees:**

```
⚠ Linear rate limit reached. Waiting 60s before retrying...
```

### 11g. GraphQL errors (malformed query, invalid variables)

**Detection:** Response has `errors` array but no `data`.

**What the user sees:**

```
✗ Linear API error: <error message from response>
```

This indicates a bug in Clancy's GraphQL queries — should not happen in production but needs clean error handling.

---

## 12. Edge Cases: Idempotency and Re-runs

### 12a. Running `/clancy:approve-brief ENG-42` twice

**What the user does:** Runs approve-brief a second time after it already succeeded.

**Detection:** Check for `.approved` marker file for the matched brief.

**What the user sees:**

```
ℹ Brief "real-time-notifications" is already approved.
  Tickets were created on 2026-03-14. See progress.txt for details.
```

**No API calls made.** No duplicate tickets.

### 12b. Running `/clancy:approve-brief ENG-42` after partial failure (from 11c)

**What the user does:** Re-runs after a partial failure (brief NOT marked approved).

**Detection:** No `.approved` marker, but the brief's decomposition table has some ticket identifiers filled in (from the successful creations in the first run).

**What happens:**

1. Parse the decomposition table for already-created ticket identifiers
2. Additionally, query Linear for existing children of ENG-42 and match by title
3. For tickets already created: skip, use existing UUID for dependency linking
4. For tickets not yet created: create them

**What the user sees:**

```
ℹ Resuming from partial approval. 3 of 4 tickets already exist.

  ⏭ ENG-43 — Set up WebSocket infrastructure (already exists)
  ⏭ ENG-44 — Implement notification service (already exists)
  ✅ ENG-45 — Add notification preferences UI (created)
  ⏭ ENG-46 — Add notification badge component (already exists)
  ✅ Dependencies linked
  ✅ Brief marked as approved

4 tickets under ENG-42 (1 new, 3 existing).
```

### 12c. Running `/clancy:brief ENG-42` after brief already exists (no feedback)

**What the user does:** Runs `/clancy:brief ENG-42` again with no changes or feedback.

**Detection:** Existing brief file matches by source identifier. No feedback section, no `.feedback.md`, no new comments on ENG-42 after the brief comment.

**What the user sees:**

```
ℹ Brief for ENG-42 already exists: .clancy/briefs/2026-03-14-real-time-notifications.md
  No feedback found. Nothing to revise.

  To review: read the brief file
  To approve: /clancy:approve-brief ENG-42
  To start over: /clancy:brief --fresh ENG-42
```

### 12d. Running `/clancy:brief ENG-42` after feedback exists (auto-revision)

**What the user does:** Comments on ENG-42 in Linear with feedback, then re-runs `/clancy:brief ENG-42`.

**Detecting feedback comments:** Query comments on the issue and find the most recent Clancy brief comment (by marker `# Clancy Strategic Brief`). Any comments posted AFTER that one are feedback.

```graphql
query($issueId: String!) {
  issue(id: $issueId) {
    comments {
      nodes {
        id
        body
        createdAt
        user { id name }
      }
    }
  }
}
```

Sort by `createdAt`. Find the brief comment. Collect all subsequent comments as feedback.

**What happens:** Generate a revised brief incorporating the feedback. Include `### Changes From Previous Brief` section.

**What the user sees:**

```
ℹ Existing brief found for ENG-42. Feedback detected — revising.

Feedback:
  • @alice (2026-03-14 16:00): "We should also consider email notifications, not just in-app."
  • @bob (2026-03-14 16:30): "Keep it WebSocket only for v1."

  Revising brief...
  ✅ Brief updated: .clancy/briefs/2026-03-14-real-time-notifications.md
  ✅ Updated comment posted on ENG-42
```

### 12e. Running `/clancy:brief --fresh ENG-42`

**What the user does:** Wants to start completely over, ignoring any existing brief and feedback.

**What happens:** Delete the existing brief file, generate fresh from the ticket's title + description. Post new comment.

**What the user sees:**

```
ℹ Starting fresh brief for ENG-42 (ignoring existing brief and feedback).

  Fetching issue from Linear...
  Exploring codebase... (2 agents)
  Generating brief...
  ✅ Brief saved to .clancy/briefs/2026-03-14-real-time-notifications.md
  ✅ Brief posted as comment on ENG-42
```

---

## 13. Edge Cases: Multi-Team Workspaces

### 13a. Workspace has multiple teams

**Context:** Linear workspaces commonly have multiple teams (Engineering, Design, QA, etc.). The user configures `LINEAR_TEAM_ID` in `.clancy/.env` — this is the team where child tickets are created.

**Scenario:** User briefs issue `DES-15` from the Design team. Child tickets need to go into the Engineering team (per `LINEAR_TEAM_ID`).

**Behaviour:** Child tickets are created with `teamId: LINEAR_TEAM_ID` (Engineering), not the source issue's team. The `parentId` still points to `DES-15` — Linear allows cross-team parent/child relationships.

**What the user sees:** Warning from edge case 6c applies. If they confirm, tickets are created in the configured team.

### 13b. `LINEAR_TEAM_ID` is invalid

**What the user does:** Has a typo in `LINEAR_TEAM_ID` or the team was deleted.

**Detection:** The team ID is validated during preflight with a simple query:

```graphql
query($teamId: String!) {
  team(id: $teamId) {
    id
    name
    key
  }
}
```

If this returns null or errors, the team doesn't exist.

**What the user sees:**

```
✗ Linear team not found for LINEAR_TEAM_ID. Check your .clancy/.env configuration.
  Run /clancy:doctor to verify your setup.
```

**Logged:** Nothing.

### 13c. Team key changed

Linear allows changing a team's key (e.g. `ENG` to `ENGR`). Existing issue identifiers retain the old key.

**Impact:** None for Clancy. We resolve by exact `identifier` field, which preserves the original key. `ENG-42` remains `ENG-42` even if the team key changes to `ENGR`. New issues created will use the new key (e.g. `ENGR-46`).

---

## 14. Edge Cases: Permissions

### 14a. API key lacks write permissions

**Scenario:** The API key can read issues but not create them (restricted scope).

**Detection:** `issueCreate` mutation returns success: false or an error.

**What the user sees:**

```
✗ Failed to create ticket "Set up WebSocket infrastructure" — permission denied.
  Your LINEAR_API_KEY may not have write permissions. Generate a new key with full access.
```

**Logged:** Nothing.

### 14b. API key lacks comment permissions

**Scenario:** Key can create issues but not post comments. (Unlikely with personal API keys, but possible with OAuth tokens.)

**Detection:** `commentCreate` returns success: false.

**What the user sees:**

```
  ✅ Brief saved to .clancy/briefs/2026-03-14-real-time-notifications.md
  ⚠ Failed to post comment on ENG-42 — permission denied. You can paste the brief manually.
```

Brief still exists locally. Comment is best-effort.

### 14c. API key is a personal key vs OAuth token

**Context:** Personal API keys don't use `Bearer` prefix. OAuth tokens do. The existing `linearGraphql()` function passes the key directly in the `Authorization` header.

**Detection:** If the user accidentally includes `Bearer` in their `LINEAR_API_KEY` env var (e.g. `LINEAR_API_KEY=Bearer lin_api_...`), the request will likely fail with 401.

**Enhancement for `/clancy:doctor`:** Check if `LINEAR_API_KEY` starts with `Bearer ` and warn:

```
⚠ LINEAR_API_KEY appears to include "Bearer" prefix. Linear personal API keys should not use "Bearer".
  Remove the "Bearer " prefix from your .clancy/.env file.
```

---

## 15. Edge Cases: Estimates and Priority

### 15a. Should created tickets have estimates?

**Decision:** No. Estimates are set during planning (`/clancy:plan`) or manually by the team. The strategist proposes Size (S/M/L) in the decomposition table, but this is for human reference only — not mapped to Linear's estimate field.

**Rationale:** Linear's estimate scale is team-configurable (Fibonacci, T-shirt, linear, exponential). Mapping S/M/L to a numeric estimate without knowing the team's scale would produce incorrect values.

### 15b. Should tickets inherit parent's priority?

**Decision:** No. Set priority to `0` (No priority) on created tickets. The team triages and prioritises after creation.

**Rationale:** The parent's priority reflects the overall initiative. Individual child tickets may have different priorities based on dependency order and team capacity.

### 15c. Parent has labels — should children inherit?

**Decision:** No. Only apply `CLANCY_LABEL` and `CLANCY_COMPONENT` labels (if configured). The parent's labels are specific to the parent.

---

## 16. New Linear API Operations Required

These are the new GraphQL operations that need to be implemented in `src/scripts/board/linear/linear.ts` (or a new `linear-strategist.ts` module):

### 16a. Resolve issue by identifier

```graphql
query IssueByIdentifier($identifier: String!) {
  issues(filter: { identifier: { eq: $identifier } }) {
    nodes {
      id
      identifier
      title
      description
      state { id name type }
      parent { id identifier title }
      children { nodes { id identifier title state { type } } }
      team { id key name }
      labels { nodes { id name } }
      priority
      estimate
    }
  }
}
```

**Function:** `resolveIssueByIdentifier(apiKey: string, identifier: string): Promise<LinearIssueDetail | undefined>`

### 16b. Create issue

```graphql
mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      title
      url
    }
  }
}
```

Input type fields used:
- `teamId: String!` — from `LINEAR_TEAM_ID`
- `title: String!` — from decomposition table
- `description: String` — from decomposition table
- `parentId: String` — UUID of parent issue (optional)
- `stateId: String` — UUID of backlog state
- `labelIds: [String!]` — array of label UUIDs
- `priority: Int` — 0 (no priority)

**Function:** `createIssue(apiKey: string, input: CreateIssueInput): Promise<CreatedIssue | undefined>`

### 16c. Create issue relation (dependency)

```graphql
mutation CreateIssueRelation($issueId: String!, $relatedIssueId: String!, $type: IssueRelationType!) {
  issueRelationCreate(input: {
    issueId: $issueId
    relatedIssueId: $relatedIssueId
    type: $type
  }) {
    success
  }
}
```

**Function:** `createIssueRelation(apiKey: string, issueId: string, relatedIssueId: string, type: 'blockedBy'): Promise<boolean>`

### 16d. Create comment

```graphql
mutation CreateComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
    comment { id }
  }
}
```

**Function:** `createComment(apiKey: string, issueId: string, body: string): Promise<boolean>`

### 16e. Fetch issue comments (for feedback detection)

```graphql
query IssueComments($issueId: String!) {
  issue(id: $issueId) {
    comments(orderBy: createdAt) {
      nodes {
        id
        body
        createdAt
        user { id name }
      }
    }
  }
}
```

**Function:** `fetchIssueComments(apiKey: string, issueId: string): Promise<LinearComment[]>`

### 16f. Look up backlog state by type

```graphql
query BacklogState($teamId: String!) {
  workflowStates(filter: {
    team: { id: { eq: $teamId } }
    type: { eq: "backlog" }
  }) {
    nodes { id name type }
  }
}
```

**Function:** Already partially covered by `lookupWorkflowStateId()` but needs enhancement to filter by `type` instead of `name`.

**New function:** `lookupWorkflowStateByType(apiKey: string, teamId: string, stateType: string): Promise<string | undefined>`

### 16g. Look up team labels

```graphql
query TeamLabels($teamId: String!) {
  team(id: $teamId) {
    labels { nodes { id name } }
  }
}
```

**Function:** `fetchTeamLabels(apiKey: string, teamId: string): Promise<LinearLabel[]>`

### 16h. Look up workspace labels (fallback)

```graphql
query WorkspaceLabels($name: String!) {
  issueLabels(filter: { name: { eq: $name } }) {
    nodes { id name }
  }
}
```

**Function:** `findLabelByName(apiKey: string, name: string): Promise<string | undefined>`

### 16i. Create label

```graphql
mutation CreateLabel($teamId: String!, $name: String!) {
  issueLabelCreate(input: { teamId: $teamId, name: $name }) {
    success
    issueLabel { id name }
  }
}
```

**Function:** `createLabel(apiKey: string, teamId: string, name: string): Promise<string | undefined>` (returns label ID)

### 16j. Validate team

```graphql
query ValidateTeam($teamId: String!) {
  team(id: $teamId) {
    id
    name
    key
  }
}
```

**Function:** `validateTeam(apiKey: string, teamId: string): Promise<{ id: string; name: string; key: string } | undefined>`

---

## 17. New Zod Schemas Required

These schemas need to be added to `src/schemas/linear.ts`:

### 17a. Detailed issue (for `resolveIssueByIdentifier`)

```typescript
const linearIssueDetailSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.optional(z.nullable(z.string())),
  state: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
  }),
  parent: z.optional(z.nullable(z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.optional(z.string()),
  }))),
  children: z.optional(z.object({
    nodes: z.array(z.object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      state: z.optional(z.object({ type: z.string() })),
    })),
  })),
  team: z.object({
    id: z.string(),
    key: z.string(),
    name: z.optional(z.string()),
  }),
  labels: z.optional(z.object({
    nodes: z.array(z.object({
      id: z.string(),
      name: z.string(),
    })),
  })),
  priority: z.optional(z.number()),
  estimate: z.optional(z.nullable(z.number())),
});
```

### 17b. Issue creation response

```typescript
export const linearIssueCreateResponseSchema = z.object({
  data: z.optional(z.object({
    issueCreate: z.optional(z.object({
      success: z.optional(z.boolean()),
      issue: z.optional(z.object({
        id: z.string(),
        identifier: z.string(),
        title: z.string(),
        url: z.string(),
      })),
    })),
  })),
});
```

### 17c. Comment creation response

```typescript
export const linearCommentCreateResponseSchema = z.object({
  data: z.optional(z.object({
    commentCreate: z.optional(z.object({
      success: z.optional(z.boolean()),
      comment: z.optional(z.object({
        id: z.string(),
      })),
    })),
  })),
});
```

### 17d. Issue relation creation response

```typescript
export const linearIssueRelationCreateResponseSchema = z.object({
  data: z.optional(z.object({
    issueRelationCreate: z.optional(z.object({
      success: z.optional(z.boolean()),
    })),
  })),
});
```

### 17e. Issue comments response

```typescript
export const linearIssueCommentsResponseSchema = z.object({
  data: z.optional(z.object({
    issue: z.optional(z.object({
      comments: z.optional(z.object({
        nodes: z.array(z.object({
          id: z.string(),
          body: z.string(),
          createdAt: z.string(),
          user: z.optional(z.nullable(z.object({
            id: z.string(),
            name: z.optional(z.string()),
          }))),
        })),
      })),
    })),
  })),
});
```

### 17f. Team validation response

```typescript
export const linearTeamResponseSchema = z.object({
  data: z.optional(z.object({
    team: z.optional(z.nullable(z.object({
      id: z.string(),
      name: z.string(),
      key: z.string(),
    }))),
  })),
});
```

### 17g. Label creation response

```typescript
export const linearLabelCreateResponseSchema = z.object({
  data: z.optional(z.object({
    issueLabelCreate: z.optional(z.object({
      success: z.optional(z.boolean()),
      issueLabel: z.optional(z.object({
        id: z.string(),
        name: z.string(),
      })),
    })),
  })),
});
```

### 17h. Team labels response

```typescript
export const linearTeamLabelsResponseSchema = z.object({
  data: z.optional(z.object({
    team: z.optional(z.object({
      labels: z.optional(z.object({
        nodes: z.array(z.object({
          id: z.string(),
          name: z.string(),
        })),
      })),
    })),
  })),
});
```

### 17i. Workspace labels response

```typescript
export const linearWorkspaceLabelsResponseSchema = z.object({
  data: z.optional(z.object({
    issueLabels: z.optional(z.object({
      nodes: z.array(z.object({
        id: z.string(),
        name: z.string(),
      })),
    })),
  })),
});
```

---

## Appendix: Complete API Call Sequence

### `/clancy:brief ENG-42` — Full sequence

| Step | API Call | Purpose | Failure Impact |
|------|----------|---------|----------------|
| 1 | None | Preflight (local) | Abort |
| 2 | `issues(filter: { identifier: { eq: "ENG-42" } })` | Resolve issue | Abort |
| 3 | None | Codebase research (local) | Abort |
| 4 | None | Generate brief (local) | Abort |
| 5 | None | Save brief (local) | Abort |
| 6 | `commentCreate(input: { issueId, body })` | Post brief as comment | Warn, continue |
| 7 | None | Display (local) | N/A |
| 8 | None | Log (local) | N/A |

### `/clancy:approve-brief ENG-42` — Full sequence

| Step | API Call | Purpose | Failure Impact |
|------|----------|---------|----------------|
| 1 | None | Preflight (local) | Abort |
| 2 | None | Load brief (local) | Abort |
| 3 | None | Confirm with user | Abort if user says no |
| 4 | `issues(filter: { identifier: { eq: "ENG-42" } })` | Resolve parent UUID | Abort |
| 5 | `workflowStates(filter: { team, type: "backlog" })` | Find backlog state | Fallback, then abort |
| 6 | `team(id).labels` + `issueLabels(filter)` | Look up labels | Warn, continue without |
| 6a | `issueLabelCreate(input)` (conditional) | Create missing labels | Warn, continue without |
| 7 | `issueCreate(input)` x N (500ms delay) | Create child tickets | Partial: warn + don't approve |
| 8 | `issueRelationCreate(input)` x M | Link dependencies | Warn, continue |
| 9 | None | Update brief file (local) | Warn |
| 10 | None | Create .approved marker (local) | Warn |
| 11 | `commentCreate(input)` | Post summary on parent | Warn, continue |

### Total API calls for a 4-ticket approve-brief

- 1 issue resolution
- 1 workflow state lookup
- 1-3 label lookups/creates
- 4 issue creates
- 3 relation creates (typical for a 4-ticket decomposition)
- 1 summary comment

**Total: 10-13 GraphQL operations.** At 500ms delay between mutations, this takes approximately 5-7 seconds.
