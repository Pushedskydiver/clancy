# Jira Strategist Flow — Complete Scenarios and Edge Cases

Covers every scenario for `/clancy:brief` and `/clancy:approve-brief` when the board is Jira Cloud.

---

## Table of Contents

1. [Context: Jira APIs Used](#context-jira-apis-used)
2. [Context: Parent/Child Relationships in Jira](#context-parentchild-relationships-in-jira)
3. [Context: ADF Construction](#context-adf-construction)
4. [Happy Path 1 — Brief From Board Ticket](#happy-path-1--brief-from-board-ticket)
5. [Happy Path 2 — Brief From Inline Text](#happy-path-2--brief-from-inline-text)
6. [Happy Path 3 — Brief From File](#happy-path-3--brief-from-file)
7. [Happy Path 4 — Approve Brief (Board-Sourced)](#happy-path-4--approve-brief-board-sourced)
8. [Happy Path 5 — Approve Brief (Text/File-Sourced with --epic)](#happy-path-5--approve-brief-textfile-sourced-with---epic)
9. [Happy Path 6 — Approve Brief (Text/File-Sourced, No Epic)](#happy-path-6--approve-brief-textfile-sourced-no-epic)
10. [Edge Cases: Brief Command](#edge-cases-brief-command)
11. [Edge Cases: Approve-Brief Command](#edge-cases-approve-brief-command)
12. [Edge Cases: Jira API](#edge-cases-jira-api)
13. [Edge Cases: ADF](#edge-cases-adf)
14. [Edge Cases: Re-brief Flow](#edge-cases-re-brief-flow)
15. [Edge Cases: Idempotency](#edge-cases-idempotency)
16. [Summary of New API Calls](#summary-of-new-api-calls)
17. [New Env Vars for Jira](#new-env-vars-for-jira)

---

## Context: Jira APIs Used

### Existing (already in `jira.ts`)

| Operation | Method | Endpoint |
|---|---|---|
| Search tickets | POST | `/rest/api/3/search/jql` |
| Get transitions | GET | `/rest/api/3/issue/{key}/transitions` |
| Transition issue | POST | `/rest/api/3/issue/{key}/transitions` |
| Ping project | GET | `/rest/api/3/project/{key}` |

### New (needed for Strategist)

| Operation | Method | Endpoint | Purpose |
|---|---|---|---|
| Fetch single issue | GET | `/rest/api/3/issue/{key}?fields=summary,description,status,issuetype,parent,customfield_10014,components,fixVersions,priority,comment,project` | Read source ticket for brief |
| Create issue | POST | `/rest/api/3/issue` | Create child tickets |
| Post comment | POST | `/rest/api/3/issue/{key}/comment` | Post brief as ADF comment |
| Create issue link | POST | `/rest/api/3/issueLink` | Link dependencies between children |
| Get create metadata | GET | `/rest/api/3/issue/createmeta/{projectKey}/issuetypes` | Validate issue type exists in project |

### Authentication

All requests use Basic auth: `Authorization: Basic <base64(JIRA_USER:JIRA_API_TOKEN)>`. Built by existing `buildAuthHeader()` and `jiraHeaders()`.

### Rate Limiting

Jira Cloud enforces rate limits per user per tenant. The documented limit is ~100 requests per minute for most endpoints, but this varies by plan and endpoint. Atlassian returns `429 Too Many Requests` with a `Retry-After` header (seconds).

**Strategy:** 500ms delay between issue creation calls (as specified in design doc). On 429, honour `Retry-After` header, wait, retry once. If second attempt also 429, abort remaining and report partial success.

---

## Context: Parent/Child Relationships in Jira

This is the most critical Jira-specific complexity. There are three mechanisms:

### 1. Next-gen / Team-managed projects

Use the `parent` field directly on issue creation:

```json
{
  "fields": {
    "project": { "key": "PROJ" },
    "summary": "Child ticket title",
    "issuetype": { "name": "Task" },
    "parent": { "key": "PROJ-200" }
  }
}
```

The parent can be any issue type (Story, Task, Bug, Epic). No special field configuration needed. This is the modern approach and works for all issue types.

### 2. Classic / Company-managed projects — Epic Link

Use `customfield_10014` (the "Epic Link" custom field). This only works when the parent is an Epic issue type:

```json
{
  "fields": {
    "project": { "key": "PROJ" },
    "summary": "Child ticket title",
    "issuetype": { "name": "Task" },
    "customfield_10014": "PROJ-200"
  }
}
```

The custom field ID for Epic Link varies by instance but `customfield_10014` is the most common default. If it differs, the create call will fail with a field-not-found error.

### 3. Classic / Company-managed projects — Sub-task

Use `parent` field, but the child must be of issue type "Sub-task" (id typically `5` or `10000`). Sub-tasks have different behaviour (can't be moved between parents, don't appear in some views).

### Clancy's Strategy: Try `parent` First, Fall Back to `customfield_10014`

1. **Attempt creation with `parent` field.** This works on all next-gen projects and on classic projects for non-Epic parent types.
2. **If the API returns 400 with an error mentioning `parent` field** (e.g., "Field 'parent' cannot be set"), retry with `customfield_10014` instead. This fallback only works if the parent issue is an Epic.
3. **If both fail**, report the error and suggest the user check their project type and configuration.
4. **Cache the result** for the session — once we know which field works for a project, use it for all subsequent creations in that batch.

**Why not detect project type first?** The `GET /rest/api/3/project/{key}` response includes a `style` field (`classic` or `next-gen`) but this is not always reliable. Trying and falling back is more robust.

---

## Context: ADF Construction

Jira Cloud REST API v3 requires Atlassian Document Format (ADF) for issue descriptions and comments. Markdown is not accepted.

### ADF Structure

```json
{
  "version": 1,
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "Hello world" }
      ]
    }
  ]
}
```

### Key Node Types for Brief Content

| Markdown | ADF Node |
|---|---|
| `# Heading` | `{ "type": "heading", "attrs": { "level": 1 }, "content": [...] }` |
| `## Heading` | `{ "type": "heading", "attrs": { "level": 2 }, "content": [...] }` |
| `plain text` | `{ "type": "paragraph", "content": [{ "type": "text", "text": "..." }] }` |
| `**bold**` | `{ "type": "text", "text": "...", "marks": [{ "type": "strong" }] }` |
| `- bullet` | `{ "type": "bulletList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph", "content": [...] }] }] }` |
| `1. numbered` | `{ "type": "orderedList", "content": [{ "type": "listItem", ... }] }` |
| `\| table \|` | `{ "type": "table", "content": [{ "type": "tableRow", "content": [{ "type": "tableCell", "content": [...] }] }] }` |
| `---` | `{ "type": "rule" }` |
| `` `code` `` | `{ "type": "text", "text": "...", "marks": [{ "type": "code" }] }` |
| code block | `{ "type": "codeBlock", "content": [{ "type": "text", "text": "..." }] }` |

### Fallback Strategy

If ADF construction fails for complex content (nested lists, tables with rich formatting), wrap the entire brief in a `codeBlock` node. This preserves readability at the cost of formatting. The Planner role already uses this pattern (documented in `plan.md` Step 5).

### Comment Body Format

```json
{
  "body": {
    "version": 1,
    "type": "doc",
    "content": [ /* ADF nodes */ ]
  }
}
```

---

## Happy Path 1 — Brief From Board Ticket

**Scenario:** `/clancy:brief PROJ-200` where PROJ-200 is a vague Jira ticket like "Add customer portal".

### What the User Does

Runs `/clancy:brief PROJ-200` from the project root.

### Step-by-Step Flow

#### 1. Preflight

- Verify `.clancy/.env` exists, parse with `jiraEnvSchema`
- Verify `CLANCY_ROLES` includes `strategist` (or is unset for global installs)
- Build auth: `buildAuthHeader(JIRA_USER, JIRA_API_TOKEN)`
- Branch freshness check: `git fetch origin`, compare HEAD with `origin/$CLANCY_BASE_BRANCH`

#### 2. Validate Input — Fetch Source Ticket

**API Call:**
```
GET {JIRA_BASE_URL}/rest/api/3/issue/PROJ-200?fields=summary,description,status,issuetype,parent,customfield_10014,components,fixVersions,priority,comment,project
Headers: Authorization: Basic {auth}, Accept: application/json
```

**On Success (200):**
- Extract `summary` (title), `description` (ADF → plain text via `extractAdfText()`), `status.name`, `issuetype.name`
- Store issue type for later (is it already an Epic?)
- Read `comment.comments[]` for existing brief comments and feedback
- Continue to Step 3

**On 404:**
- Display: `X PROJ-200 not found — check the ticket key and project`
- Log: `YYYY-MM-DD HH:MM | BRIEF | proj-200 | SKIPPED — ticket not found`
- Stop

**On 401/403:**
- Display: `X Jira auth failed — check JIRA_USER and JIRA_API_TOKEN in .clancy/.env`
- Stop (don't log — credential issue, not a ticket issue)

#### 3. Status Validation

Check `status.statusCategory.key` (not `status.name`, which is user-customisable):
- `"done"` → Warn: `! PROJ-200 is in status "{status.name}" (Done). Briefing a completed ticket is unusual.`
  - Ask: `Continue anyway? [y/N]` (default No)
  - If N: Log: `YYYY-MM-DD HH:MM | BRIEF | proj-200 | SKIPPED — ticket is Done` — Stop
  - If Y: Continue (note status in the brief's Source line)
- `"indeterminate"` (In Progress) → Warn: `! PROJ-200 is In Progress — briefing anyway. Consider pausing active work first.`
  - Continue (don't block — the user may be re-briefing intentionally)
- `"new"` (To Do / Backlog) → Continue silently (ideal state)
- `"undefined"` / missing → Continue (don't block on status quirks)

#### 4. Auto-detect: Existing Brief?

Scan `.clancy/briefs/` for files where the `**Source:**` line contains `PROJ-200`.

- **No existing brief** → generate fresh (continue to Step 5)
- **Existing brief + feedback found** → auto-revise (read existing brief + feedback, pass to agent)
- **Existing brief + no feedback** → Display: `Already briefed. To revise, add feedback comments on PROJ-200, then re-run. To start fresh: /clancy:brief --fresh PROJ-200`
  - Stop

**Where to find feedback:**
1. Check for `## Feedback` section appended to the local brief file
2. Check for `.feedback.md` companion file
3. Fetch comments from PROJ-200 posted AFTER the brief comment (identified by `## Clancy Strategic Brief` marker), using timestamps

#### 5. Relevance Check

Read `.clancy/docs/STACK.md` and `ARCHITECTURE.md`. Compare the idea's domain against the codebase technology.

- If irrelevant: `Skip PROJ-200 — this idea targets {platform}, but this codebase is {stack}`
  - Log: `YYYY-MM-DD HH:MM | BRIEF | proj-200 | SKIPPED — not relevant (iOS idea, React codebase)`
  - Stop

#### 6. Research (Adaptive Agents)

- Assess complexity from title + description
- Launch 1-3 codebase agents + optionally 1 web research agent
- Agents explore codebase, read `.clancy/docs/`, scan board for related tickets

**Board scan for duplicates — API Call:**
```
POST {JIRA_BASE_URL}/rest/api/3/search/jql
Body: { "jql": "project=\"PROJ\" AND summary ~ \"customer portal\" ORDER BY created DESC", "maxResults": 5, "fields": ["summary", "status", "key"] }
```

#### 7. Generate Brief

Using the brief template. Populate all sections from research findings. Include `### External Research` only if web research was conducted.

Ticket Decomposition table: max 10 rows. Each ticket gets: Title, Description (1-2 sentences), Size (S/M/L), Dependencies (references to other tickets in the table by `#N`), Mode (AFK or HITL).

**Vertical slice rule:** Each ticket must be a vertical slice cutting through all layers needed to deliver one piece of working functionality. If a ticket title mentions only one layer (e.g. "Set up database schema"), restructure it into a slice that delivers observable behaviour (e.g. "Portal route + DB schema + basic list view").

**HITL/AFK classification:** Tag each ticket as AFK (can be implemented autonomously) or HITL (needs human input — credentials, design decisions, external setup, ambiguous requirements).

#### 8. Save Locally

Write to `.clancy/briefs/{YYYY-MM-DD}-add-customer-portal.md`.

If slug collision: `.clancy/briefs/{YYYY-MM-DD}-add-customer-portal-2.md`.

#### 9. Post Brief as Comment on PROJ-200

**API Call:**
```
POST {JIRA_BASE_URL}/rest/api/3/issue/PROJ-200/comment
Headers: Authorization: Basic {auth}, Content-Type: application/json, Accept: application/json
Body: {
  "body": {
    "version": 1,
    "type": "doc",
    "content": [ /* ADF representation of the brief */ ]
  }
}
```

**On Success (201):**
- Display: `Brief posted as comment on PROJ-200`
- Continue

**On Failure (any non-2xx):**
- Display: `! Failed to post brief comment on PROJ-200. Brief saved locally at .clancy/briefs/{file}. Paste it manually.`
- Continue (don't stop — local file is the source of truth)

#### 10. Display

Print the full brief to stdout. Show next steps:
```
Next steps:
  To request changes:
    • Comment on PROJ-200 in Jira, then re-run /clancy:brief PROJ-200 to revise
    • Or add a ## Feedback section to the brief file and re-run
  To approve: /clancy:approve-brief PROJ-200
  To start over: /clancy:brief --fresh PROJ-200
```

#### 11. Log

```
YYYY-MM-DD HH:MM | BRIEF | add-customer-portal | 6 proposed tickets
```

Uses the `BRIEF` progress status (new, added to `ProgressStatus` type).

---

## Happy Path 2 — Brief From Inline Text

**Scenario:** `/clancy:brief "Add customer portal with SSO login and role-based access"`

### Differences From Board-Sourced

1. **No API call to fetch a ticket** — the idea text is the input directly
2. **No status validation** — there's no ticket to check
3. **No comment posted** — there's no ticket to comment on
4. **Source line in brief:** `**Source:** "Add customer portal with SSO login and role-based access"`
5. **Brief file slug:** derived from the text, e.g., `{YYYY-MM-DD}-add-customer-portal-with-sso.md` (truncated to reasonable length)
6. **No auto-detect for existing brief** by ticket key — match by slug instead
7. **No duplicate scan by ticket key** — only text-based similarity search on the board

### What Gets Saved

`.clancy/briefs/{YYYY-MM-DD}-add-customer-portal-with-sso.md`

### Next Steps Shown

```
Next steps:
  To request changes:
    • Add a ## Feedback section to:
      .clancy/briefs/{date}-add-customer-portal-with-sso.md
    • Or create a companion file:
      .clancy/briefs/{date}-add-customer-portal-with-sso.feedback.md
    Then re-run /clancy:brief to revise.
  To approve: /clancy:approve-brief add-customer-portal-with-sso
  To attach to a parent: /clancy:approve-brief add-customer-portal-with-sso --epic PROJ-200
  To start over: /clancy:brief --fresh "Add customer portal with SSO"
```

### Log

```
YYYY-MM-DD HH:MM | BRIEF | add-customer-portal-with-sso | 6 proposed tickets
```

---

## Happy Path 3 — Brief From File

**Scenario:** `/clancy:brief --from docs/rfcs/customer-portal.md`

### Differences From Inline Text

1. **Read file content** instead of using inline text
2. **File must exist** — if not: `X File not found: docs/rfcs/customer-portal.md`
3. **Source line:** `**Source:** docs/rfcs/customer-portal.md`
4. **Slug derived from filename:** `{YYYY-MM-DD}-customer-portal.md`
5. **Clancy does NOT manage the source file** — no writes, no modifications

### Edge Case: File Is Empty

- Display: `X File is empty: docs/rfcs/customer-portal.md`
- Stop

### Edge Case: File Is Very Large (>50KB)

- Warn: `! Large file (52KB). Clancy will use the first ~50KB for context.`
- Truncate internally, continue

---

## Happy Path 4 — Approve Brief (Board-Sourced)

**Scenario:** `/clancy:approve-brief PROJ-200` after a brief has been generated and reviewed.

### What the User Does

Runs `/clancy:approve-brief PROJ-200`.

### Step-by-Step Flow

#### 1. Preflight

Same as brief: `.clancy/.env`, credentials, board detection.

#### 2. Load Brief

Scan `.clancy/briefs/` for unapproved files (no `.approved` marker file) where the `**Source:**` line contains `PROJ-200`.

- **No match:** `X No unapproved brief found for PROJ-200`  — Stop
- **Multiple matches:** List them with index and ask user to confirm
- **One match:** Load it

#### 3. Parse Ticket Decomposition

Read the `## Ticket Decomposition` table from the brief. Extract:
- `#` (sequence number)
- `Title`
- `Description`
- `Size`
- `Dependencies` (references like `#1`, `#3`)
- `Mode` (AFK or HITL)

Validate: at least 1 ticket, at most 10. Detect circular dependencies (error + stop). Topological sort by dependency graph so blockers are created before dependents.

#### 4. Confirm With User

Display:
```
Creating 6 tickets under PROJ-200 (dependency order):

  #1  [S] [AFK]  Portal route + empty dashboard shell — No deps
  #2  [M] [HITL] SSO login flow (needs IdP config) — No deps
  #3  [M] [AFK]  Role-based access control — After #2
  #4  [S] [AFK]  Dashboard layout with real data — After #1
  #5  [L] [AFK]  Full customer data views — After #3, #4
  #6  [S] [AFK]  Navigation and breadcrumbs — After #4

Parent epic: PROJ-200 (Add customer portal)
Issue type: Task (override with CLANCY_BRIEF_ISSUE_TYPE)
Labels: clancy (from CLANCY_LABEL)
AFK-ready: 5 | Needs human: 1

Proceed? [Y/n]
```

User confirms with Y (or Enter).

#### 5. Validate Issue Type Exists

**API Call:**
```
GET {JIRA_BASE_URL}/rest/api/3/issue/createmeta/{JIRA_PROJECT_KEY}/issuetypes
Headers: Authorization: Basic {auth}, Accept: application/json
```

**Parse response:** Look for an issue type matching `CLANCY_BRIEF_ISSUE_TYPE` (default: `Task`).

- **Found:** continue with its `id`
- **Not found:** Display: `X Issue type "Task" not available in project PROJ. Available types: Story, Bug, Sub-task. Set CLANCY_BRIEF_ISSUE_TYPE in .clancy/.env`
  - Stop

#### 6. Create Child Tickets (Sequential, Dependency Order, 500ms Delay)

For each ticket in topological (dependency) order:

**API Call:**
```
POST {JIRA_BASE_URL}/rest/api/3/issue
Headers: Authorization: Basic {auth}, Content-Type: application/json, Accept: application/json
Body: {
  "fields": {
    "project": { "key": "PROJ" },
    "summary": "Set up portal route structure",
    "description": {
      "version": 1,
      "type": "doc",
      "content": [
        {
          "type": "paragraph",
          "content": [
            { "type": "text", "text": "Create the base route structure for the customer portal, including layout components and route guards." }
          ]
        }
      ]
    },
    "issuetype": { "name": "Task" },
    "parent": { "key": "PROJ-200" },
    "labels": ["clancy", "clancy:afk OR clancy:hitl"]
  }
}
```

**Mode label:** Include `clancy:afk` or `clancy:hitl` label based on the ticket's Mode classification. This label is used by `/clancy:run` to decide whether to pick up the ticket autonomously or skip it for human attention.

**Conditional fields (included when env vars are set):**

- `CLANCY_COMPONENT` → `"components": [{ "name": "portal" }]`
- Parent ticket has `priority` → `"priority": { "name": "Medium" }` (inherit parent's priority — see edge case discussion)
- Parent ticket has `fixVersions` → do NOT inherit (versions are release-scoped, not task-scoped; the user assigns versions deliberately)

**On Success (201):**
- Parse response for `key` (e.g., `PROJ-201`) and `id`
- Store mapping: `#1 → PROJ-201` for dependency linking
- Display: `  [1/6] + PROJ-201 — Set up portal route structure`
- Wait 500ms before next creation

**On 400 with `parent` field error (classic project):**
- Retry with `customfield_10014` instead of `parent` (only if PROJ-200 is an Epic):
  ```json
  {
    "fields": {
      "project": { "key": "PROJ" },
      "summary": "...",
      "issuetype": { "name": "Task" },
      "customfield_10014": "PROJ-200"
    }
  }
  ```
- Cache field choice for remaining tickets in this batch

**On 400 with other error:**
- Display: `X Failed to create ticket #1 "Set up portal route structure": {error message}`
- See partial failure handling below

**On 429 (rate limited):**
- Read `Retry-After` header (seconds)
- Display: `! Rate limited by Jira. Waiting {N}s...`
- Wait, retry once
- If still 429: abort remaining, report partial success

#### 7. Link Dependencies

For each ticket with dependencies (e.g., `#3` depends on `#2`), create an issue link:

**API Call:**
```
POST {JIRA_BASE_URL}/rest/api/3/issueLink
Headers: Authorization: Basic {auth}, Content-Type: application/json, Accept: application/json
Body: {
  "type": { "name": "Blocks" },
  "inwardIssue": { "key": "PROJ-202" },
  "outwardIssue": { "key": "PROJ-203" }
}
```

Where "Blocks" means: PROJ-202 (the dependency) blocks PROJ-203 (the dependent).

**On Success (201):** Silent (links are secondary)

**On Failure:** Warn: `! Could not link PROJ-203 → PROJ-202 (dependency). Link manually if needed.`
- Continue — dependency links are best-effort. The tickets exist regardless.

**Delay:** 200ms between link creation calls (lighter-weight than issue creation).

#### 8. Update Brief File

Add the created ticket keys to the decomposition table in the local brief file:

```markdown
| #   | Title   | Description     | Size | Dependencies | Ticket    |
| --- | ------- | --------------- | ---- | ------------ | --------- |
| 1   | Set up portal route structure | ... | S | None | PROJ-201 |
| 2   | Implement SSO integration | ... | M | None | PROJ-202 |
```

#### 9. Mark Approved

Create marker file: `.clancy/briefs/{YYYY-MM-DD}-add-customer-portal.md.approved`

This is an empty file. Its presence indicates the brief has been approved and tickets created.

#### 10. Post Tracking Summary on Parent

Post a comment on the parent ticket (PROJ-200) listing all created child tickets:

**API Call:**
```
POST {JIRA_BASE_URL}/rest/api/3/issue/PROJ-200/comment
Headers: Authorization: Basic {auth}, Content-Type: application/json, Accept: application/json
Body: {
  "body": {
    "version": 1,
    "type": "doc",
    "content": [ /* ADF table listing all created tickets with keys, titles, and sizes */ ]
  }
}
```

**Content (as ADF table):**
```
## Clancy — Approved Tickets

| # | Ticket   | Title                                | Size |
|---|----------|--------------------------------------|------|
| 1 | PROJ-201 | Set up portal route structure        | S    |
| 2 | PROJ-202 | Implement SSO integration            | M    |
| 3 | PROJ-203 | Build role-based access control      | M    |
| 4 | PROJ-204 | Create portal dashboard layout       | S    |
| 5 | PROJ-205 | Implement customer data views        | L    |
| 6 | PROJ-206 | Add portal navigation and breadcrumbs| S    |
```

**On Success (201):** Display: `Tracking summary posted on PROJ-200`

**On Failure:** Warn: `! Failed to post tracking summary on PROJ-200. Tickets are created regardless.` — Continue (best-effort, not blocking)

#### 11. Summary

Display:
```
Approved: 6 tickets created under PROJ-200

  PROJ-201  [S] Set up portal route structure
  PROJ-202  [M] Implement SSO integration
  PROJ-203  [M] Build role-based access control
  PROJ-204  [S] Create portal dashboard layout
  PROJ-205  [L] Implement customer data views
  PROJ-206  [S] Add portal navigation and breadcrumbs

Dependencies linked: 4

Next steps:
  - Tickets are in Backlog, ready for planning
  - Run /clancy:plan to generate implementation plans
```

#### 12. Log

```
YYYY-MM-DD HH:MM | APPROVE_BRIEF | add-customer-portal | 6 tickets created
```

Uses `APPROVE_BRIEF` progress status (new).

---

## Happy Path 5 — Approve Brief (Text/File-Sourced with --epic)

**Scenario:** `/clancy:approve-brief add-customer-portal --epic PROJ-200`

### Differences From Board-Sourced

1. **Brief loaded by slug** instead of ticket key
2. **Parent specified via `--epic` flag** — used in `parent` field on creation
3. **Same creation flow** as Happy Path 4 from Step 5 onwards
4. **`--epic` validated:** fetch PROJ-200 to confirm it exists and isn't Done

### Validation of --epic Target

**API Call:**
```
GET {JIRA_BASE_URL}/rest/api/3/issue/PROJ-200?fields=summary,status,issuetype
```

- **404:** `X Epic PROJ-200 not found`
- **Status Done:** `! Epic PROJ-200 is in status "Done". Continue anyway? [y/N]` (default No — user may choose to proceed)
- **Success:** Use as parent, continue

---

## Happy Path 6 — Approve Brief (Text/File-Sourced, No Epic)

**Scenario:** `/clancy:approve-brief add-customer-portal` (no `--epic` flag, brief was from text/file)

### Behaviour

1. Check env for `CLANCY_BRIEF_EPIC` default
2. If set: use it as the parent (validate same as `--epic`)
3. If not set: create tickets **without a parent** (standalone tasks in the backlog)
   - Display: `! No parent epic specified. Tickets will be created as standalone tasks. Use --epic PROJ-KEY to attach to a parent.`
   - Continue — this is valid, just suboptimal for organisation

### No Parent Means

- Omit `parent` field and `customfield_10014` from the creation payload
- Tickets appear in the project backlog as top-level tasks
- They still get the `CLANCY_LABEL` label so they're in the implementer queue

---

## Edge Cases: Brief Command

### EC-1: Ticket Key Format Invalid

**Input:** `/clancy:brief proj-200` (lowercase) or `/clancy:brief 200`

**Behaviour:**
- Validate against `ISSUE_KEY_PATTERN` (`/^[A-Z][A-Z0-9]+-\d+$/`)
- `proj-200` fails validation
- Display: `X Invalid Jira ticket key "proj-200". Expected format: PROJ-123`
- Don't attempt API call

### EC-2: Ticket Exists But Is in "Done" Status

**Covered in Happy Path 1, Step 3.** Status category `"done"` → warn and ask `[y/N]` (default No). User can proceed if they intentionally want to brief a completed ticket.

### EC-3: Ticket Is Already an Epic Issue Type

**Input:** `/clancy:brief PROJ-200` where PROJ-200 has `issuetype.name === "Epic"`.

**Behaviour:** No conversion needed. Epics can have children via the `parent` field (next-gen) or `customfield_10014` (classic). The ticket stays as-is. This is actually the ideal scenario — the vague ticket is already the right type to be a parent.

**Display:** `PROJ-200 is an Epic — child tickets will be created under it.` (informational, continue)

### EC-4: Ticket Already Has Children/Sub-tasks

**Input:** `/clancy:brief PROJ-200` where PROJ-200 already has 3 sub-tasks.

**Behaviour:** This doesn't affect the brief at all. The brief is a research and decomposition step — it doesn't create tickets. It just proposes a decomposition.

**However, the research phase should note existing children.** During research, scan for existing children:

```
POST {JIRA_BASE_URL}/rest/api/3/search/jql
Body: { "jql": "parent = PROJ-200 ORDER BY created ASC", "maxResults": 20, "fields": ["summary", "status"] }
```

If children exist, include them in the `### Related Existing Work` section of the brief:
```
### Related Existing Work
PROJ-200 already has 3 child tickets:
- PROJ-201: Set up database schema (In Progress)
- PROJ-202: Create API endpoints (To Do)
- PROJ-203: Write unit tests (To Do)

The proposed decomposition accounts for these existing tickets. New tickets should not duplicate this work.
```

This informs the PO during review.

### EC-5: Network Failure During Ticket Fetch

**Behaviour:** `fetch()` throws (DNS failure, timeout, etc.)

- Display: `X Could not reach Jira — check your network connection and JIRA_BASE_URL`
- Stop

### EC-6: Jira Returns 500/502/503

**Behaviour:**
- Display: `X Jira returned HTTP {status}. This is usually a temporary Jira Cloud issue. Try again in a few minutes.`
- Stop

### EC-7: Ticket Description Is Empty

**Behaviour:** `description` field is null or empty ADF (`{"version":1,"type":"doc","content":[]}`).

- `extractAdfText()` returns `""` — this is fine
- The brief is generated from the title alone
- The agents have less context but can still research the codebase
- No special handling needed

### EC-8: Ticket Description Is Extremely Long (>10KB ADF)

**Behaviour:** `extractAdfText()` will extract all text. This is fine — the text is used as input context for the agents, and Claude can handle large inputs.

No truncation of the ticket content. Truncation only applies to `--from` files.

### EC-9: Project Key Doesn't Match JIRA_PROJECT_KEY

**Input:** `/clancy:brief ABC-200` but `.clancy/.env` has `JIRA_PROJECT_KEY=PROJ`.

**Behaviour:** Allow it. The user might have access to multiple projects. The API call uses the full key `ABC-200`, not the project key from env. The project key from env is only used for JQL queries and ping validation, not for single-issue fetches.

### EC-10: Interactive Mode (No Args)

**Input:** `/clancy:brief` with no arguments.

**Behaviour:** Prompt the user: `What's the idea? (Enter a ticket key like PROJ-123, or describe it in quotes)`

Parse the response:
- Matches `ISSUE_KEY_PATTERN` → treat as board ticket input
- Anything else → treat as inline text input

---

## Edge Cases: Approve-Brief Command

### EC-11: No Unapproved Briefs Exist

**Input:** `/clancy:approve-brief PROJ-200` but all briefs have `.approved` markers.

**Behaviour:**
- Display: `X No unapproved briefs found. Run /clancy:brief to create one first.`
- Stop

### EC-12: Multiple Unapproved Briefs, No Identifier Given

**Input:** `/clancy:approve-brief` with 3 unapproved briefs.

**Behaviour:** Show numbered list:
```
Multiple unapproved briefs found:

  [1] add-customer-portal (PROJ-200) — 2 days old
  [2] dark-mode-support ("Add dark mode...") — 5 days old
  [3] auth-rework (docs/rfcs/auth-rework.md) — 1 day old

Which brief to approve? [1-3]
```

### EC-13: Partial Creation Failure

**Scenario:** Creating 8 tickets. Tickets 1-3 created successfully, ticket 4 returns 500, tickets 5-8 not attempted.

**Behaviour:**
1. Display error for ticket 4: `X Failed to create ticket #4 "Implement search filters": HTTP 500`
2. **Do NOT attempt remaining tickets** — stop creation loop
3. Display partial success summary:
   ```
   ! Partial creation: 3 of 8 tickets created

     PROJ-201  [S] Set up portal route structure
     PROJ-202  [M] Implement SSO integration
     PROJ-203  [M] Build role-based access control
     X  #4  Implement search filters — FAILED (HTTP 500)
     -  #5-#8 not attempted

   Created tickets are live on Jira. To complete:
     1. Fix the issue (check Jira status/permissions)
     2. Re-run /clancy:approve-brief to resume creating remaining tickets
   ```
4. **Do NOT mark as approved** — the `.approved` marker is only created on full success
5. **Do link dependencies** for the tickets that were created (best-effort)
6. **Do update the brief file** with the keys that were created (partial update)
7. Log: `YYYY-MM-DD HH:MM | APPROVE_BRIEF | add-customer-portal | PARTIAL — 3 of 8 tickets created`

**Why stop instead of skipping?** A 500 error likely indicates a systemic issue (Jira outage, permission problem). Continuing would likely fail on all remaining tickets too, wasting rate limit budget and creating confusing partial state.

### EC-14: Issue Type Not Available in Project

**Covered in Happy Path 4, Step 5.** Display available types, suggest setting `CLANCY_BRIEF_ISSUE_TYPE`.

### EC-15: Component Not Found (CLANCY_COMPONENT)

**Scenario:** `CLANCY_COMPONENT=portal` but the Jira project doesn't have a component named "portal".

**API Response:** 400 with error like `Component name 'portal' is not valid`.

**Behaviour:**
- Display: `! Component "portal" not found in project PROJ. Creating tickets without component. Add the component in Jira project settings, then update tickets manually.`
- Retry creation **without** the `components` field
- Continue — component is a nice-to-have, not a blocker

### EC-16: Label Doesn't Exist (CLANCY_LABEL)

**Behaviour:** Jira auto-creates labels on first use. No validation needed. The `labels` array field accepts any string — Jira creates the label if it doesn't exist.

### EC-17: User Lacks "Create Issue" Permission

**API Response:** 403 on `POST /rest/api/3/issue`.

**Behaviour:**
- Display: `X Permission denied. Your Jira account doesn't have "Create Issue" permission in project PROJ. Contact your Jira admin.`
- Stop (don't attempt remaining tickets)

### EC-18: Running `/clancy:approve-brief` Twice (Idempotency)

**Scenario:** User runs `/clancy:approve-brief PROJ-200`, tickets created, `.approved` marker set. User runs it again.

**Behaviour:**
- The brief file has an `.approved` marker, so it's filtered out of the unapproved scan
- Display: `X No unapproved brief found for PROJ-200. This brief was already approved.`
- Stop

**No duplicate tickets are created.** The `.approved` marker is the idempotency guard.

### EC-19: Brief File Manually Edited After Generation

**Scenario:** User modifies the decomposition table (adds tickets, changes titles, removes rows).

**Behaviour:** `approve-brief` re-parses the table at execution time. Whatever is in the table at that moment is what gets created. This is expected and intentional — the human review step includes editing the brief.

### EC-20: Brief Has 0 Tickets in Decomposition

**Scenario:** User removes all rows from the decomposition table.

**Behaviour:**
- Display: `X No tickets found in the decomposition table. Add at least one ticket to the brief before approving.`
- Stop

### EC-21: Brief Has >10 Tickets

**Scenario:** The generated brief has 12 tickets (shouldn't happen, but could from manual editing).

**Behaviour:**
- Display: `! Brief has 12 tickets (max recommended: 10). Large decompositions may indicate the idea should be split further.`
- **Don't block** — proceed after warning. The limit is advisory, not enforced.

### EC-22: Sprint Assignment

**Question:** Should created tickets be added to the current sprint?

**Answer:** No. Created tickets land in the Backlog (project default status for the issue type). Sprint assignment is a deliberate planning activity done by the team. Clancy creates tickets in the backlog ready for the planner, not for immediate sprint work.

No `sprint` field is set on creation.

### EC-23: Priority Inheritance

**Question:** Should child tickets inherit the parent's priority?

**Answer:** Yes, if the parent has a priority set. This provides a reasonable default that the team can override.

- Fetch parent's `priority.name` during the initial issue fetch (Step 2 of approve-brief, or cached from the brief step)
- Set `"priority": { "name": "{parent_priority}" }` on each created ticket
- If parent has no priority (null): omit field, Jira uses the project default

### EC-24: fixVersion Inheritance

**Question:** Should child tickets inherit `fixVersions`?

**Answer:** No. Fix versions represent release targets and are assigned deliberately during sprint planning. Auto-inheriting could pollute release scope tracking.

### EC-25: Dependency Ticket Reference Resolution

**Scenario:** Ticket #3 depends on `#1, #5`. But ticket #5 failed to create (partial failure from EC-13).

**Behaviour:** Only link to tickets that were successfully created. If `#5` wasn't created, skip that link silently. The dependency information is still in the brief for manual linking later.

---

## Edge Cases: Jira API

### EC-26: Jira Server vs Jira Cloud

**Scope:** Clancy targets Jira Cloud only. Jira Server/Data Center uses different API versions and authentication.

**Detection:** Not attempted. If someone configures a Jira Server URL:
- The REST API v3 endpoints may not exist → 404 errors
- ADF format may not be supported → 400 errors on comment/description
- Basic auth works the same way

**Behaviour:** No special handling. Errors will surface naturally. The `pingJira` check during preflight/init will catch most issues early.

**Future consideration:** Could add a `JIRA_CLOUD=false` flag to switch to API v2 and wiki markup. Out of scope for v0.6.0.

### EC-27: Jira Custom Field for Epic Link Varies

**Scenario:** The "Epic Link" field is not `customfield_10014` on this Jira instance.

**Behaviour:** The fallback from `parent` to `customfield_10014` may fail. If both attempts fail:
- Display: `X Could not set parent on created ticket. Your Jira instance may use a different Epic Link field. Create tickets without parent and link manually, or switch to a team-managed project.`
- Offer to continue without parent: `Continue creating tickets without parent? [y/N]` (default No)
- If Y: create remaining tickets without parent field

### EC-28: Concurrent Brief/Approve Runs

**Scenario:** Two terminal sessions both running `/clancy:approve-brief` for the same brief.

**Behaviour:** Race condition on the `.approved` marker file. Possible outcome: duplicate tickets.

**Mitigation:** Check for `.approved` marker immediately before the first API call (not just during brief loading). This narrows the race window. Full locking (e.g., lockfile) is out of scope for v0.6.0 — this is an unlikely scenario for a CLI tool.

### EC-29: Jira Field Validation Errors

**Scenario:** The `POST /rest/api/3/issue` call returns 400 with field-specific errors, e.g.:
```json
{
  "errors": {
    "issuetype": "The issue type selected is invalid."
  },
  "errorMessages": []
}
```

**Behaviour:** Parse the `errors` object from the response body. Display the specific field error:
- `X Failed to create ticket #1: issuetype — The issue type selected is invalid.`

Common field errors and their user-facing messages:
| Jira Error | Clancy Message |
|---|---|
| `issuetype` invalid | Set `CLANCY_BRIEF_ISSUE_TYPE` to a valid type |
| `parent` cannot be set | Project may be classic — trying Epic Link fallback |
| `components` invalid | Component not found — creating without it |
| `priority` invalid | Priority name mismatch — creating without it |
| `project` not found | Check `JIRA_PROJECT_KEY` in `.clancy/.env` |

### EC-30: Jira Response Timeout

**Scenario:** `POST /rest/api/3/issue` takes >30 seconds.

**Behaviour:** Use a 30-second timeout on all Jira API calls (consistent with the 10-second timeout in `pingEndpoint`; creation calls need more time).

On timeout:
- Display: `X Jira request timed out creating ticket #4. Jira may be under heavy load.`
- Treat as creation failure, same as EC-13 partial failure flow

---

## Edge Cases: ADF

### EC-31: Brief Contains Markdown Not Representable in ADF

**Scenario:** The generated brief contains nested blockquotes, footnotes, or other Markdown not in the ADF spec.

**Behaviour:** The ADF builder should handle known node types (heading, paragraph, bulletList, orderedList, table, codeBlock, rule). For anything unrecognised:
1. Try to render as a plain paragraph
2. If structure is too complex, wrap in a `codeBlock` node (preserves content, loses formatting)

This matches the existing pattern in the Planner's `plan.md` Step 5.

### EC-32: ADF Comment Exceeds Jira's Size Limit

**Scenario:** The brief ADF is very large (Jira has a ~32KB limit on comment bodies for some plans).

**Behaviour:** Unlikely for a brief (typical brief is 2-5KB of Markdown, ~5-15KB as ADF). If it happens:
- Jira returns 400 with a size-related error
- Display: `! Brief too large for Jira comment. Brief saved locally at .clancy/briefs/{file}. Link to it from the ticket manually.`
- Don't block the workflow

### EC-33: Finding the Brief Comment Later (Re-brief)

**Identification:** The brief comment starts with an `## Clancy Strategic Brief` heading (ADF heading node, level 2, text "Clancy Strategic Brief").

**Scanning comments:**
```
GET {JIRA_BASE_URL}/rest/api/3/issue/PROJ-200?fields=comment
```

Response includes `comment.comments[]` array. Each comment has:
- `id` — comment ID
- `body` — ADF document
- `created` — ISO timestamp
- `author.accountId` — who posted it

Walk each comment's ADF body looking for a heading node with text matching "Clancy Strategic Brief". Use `extractAdfText()` on the body and check for the substring.

For re-brief, find all comments posted AFTER the most recent brief comment. These are the feedback comments.

---

## Edge Cases: Re-brief Flow

### EC-34: Board Feedback + Local Feedback

**Scenario:** User added a `## Feedback` section to the local brief file AND posted comments on PROJ-200 after the brief comment.

**Behaviour:** Merge both sources. Read local feedback first, then board feedback (chronological order within board comments). Pass all feedback to the agent for revision.

### EC-35: Brief Comment Was Deleted from Jira

**Scenario:** Someone deleted the brief comment from PROJ-200. User runs `/clancy:brief PROJ-200` again.

**Behaviour:**
- Local brief file still exists → auto-detect finds it
- No brief comment on board → no board feedback to read (local feedback still applies)
- If no feedback from any source: "Already briefed" (skip)
- If `--fresh`: regenerate from scratch
- The new brief will be posted as a new comment (not updating the deleted one)

### EC-36: Multiple Brief Comments on Same Ticket

**Scenario:** User ran `/clancy:brief PROJ-200` three times with `--fresh`, creating three brief comments.

**Behaviour:** Always use the MOST RECENT brief comment (latest `created` timestamp) as the reference point for feedback scanning. Older brief comments are ignored.

---

## Edge Cases: Idempotency

### EC-37: Same Brief Approved from Two Different Machines

**Scenario:** Developer A approves the brief on their machine. Developer B, with a stale local copy (no `.approved` marker), also approves.

**Behaviour:** Duplicate tickets created. There is no server-side idempotency guard.

**Mitigation:** The brief comment on Jira could be updated with ticket keys after approval (already planned in Step 8 of approve-brief). Developer B would see those keys during confirmation and realise tickets already exist.

**Additional safeguard:** Before creating tickets, scan the board for existing children of PROJ-200 and compare titles:

```
POST {JIRA_BASE_URL}/rest/api/3/search/jql
Body: { "jql": "parent = PROJ-200", "maxResults": 50, "fields": ["summary"] }
```

If any existing child summaries match the proposed ticket titles (case-insensitive exact title match):
```
! PROJ-200 already has children with similar titles:
  - PROJ-201: "Set up portal route structure" (matches proposed ticket #1)

This brief may have already been approved. Continue anyway? [y/N]
```

Default to N (don't create duplicates).

---

## Summary of New API Calls

| # | Method | Endpoint | When Used |
|---|---|---|---|
| 1 | GET | `/rest/api/3/issue/{key}?fields=...` | Fetch source ticket for brief; validate `--epic` target |
| 2 | POST | `/rest/api/3/issue/{key}/comment` | Post brief as ADF comment on source ticket |
| 3 | GET | `/rest/api/3/issue/createmeta/{projectKey}/issuetypes` | Validate issue type before creation |
| 4 | POST | `/rest/api/3/issue` | Create each child ticket |
| 5 | POST | `/rest/api/3/issueLink` | Link dependencies between children |
| 6 | POST | `/rest/api/3/search/jql` | Scan for existing children (duplicate guard); scan for related tickets (research) |

---

## New Env Vars for Jira

| Variable | Default | Jira Field | Purpose |
|---|---|---|---|
| `CLANCY_BRIEF_ISSUE_TYPE` | `Task` | `issuetype.name` | Issue type for created child tickets |
| `CLANCY_BRIEF_EPIC` | (none) | `parent.key` or `customfield_10014` | Default parent for text/file-sourced briefs |
| `CLANCY_COMPONENT` | (none) | `components[].name` | Auto-set component on created tickets |

These are added to `sharedEnvSchema` (not Jira-specific) since GitHub and Linear also use them (with different field mappings).

---

## Progress Log Entries

| Scenario | Log Line |
|---|---|
| Brief generated | `YYYY-MM-DD HH:MM \| BRIEF \| {slug} \| {N} proposed tickets` |
| Brief skipped (not relevant) | `YYYY-MM-DD HH:MM \| BRIEF \| {slug} \| SKIPPED — not relevant ({reason})` |
| Brief skipped (ticket Done) | `YYYY-MM-DD HH:MM \| BRIEF \| {slug} \| SKIPPED — ticket is Done` |
| Brief skipped (not found) | `YYYY-MM-DD HH:MM \| BRIEF \| {slug} \| SKIPPED — ticket not found` |
| Brief revised | `YYYY-MM-DD HH:MM \| BRIEF \| {slug} \| REVISED — {N} proposed tickets` |
| Approve full success | `YYYY-MM-DD HH:MM \| APPROVE_BRIEF \| {slug} \| {N} tickets created` |
| Approve partial | `YYYY-MM-DD HH:MM \| APPROVE_BRIEF \| {slug} \| PARTIAL — {M} of {N} tickets created` |

**New ProgressStatus values:** `BRIEF`, `APPROVE_BRIEF` (added to the `ProgressStatus` type in `src/types/remote.ts`).

Note: The progress log format for brief/approve-brief uses the slug as the key (second column), not a ticket key. This is because text/file-sourced briefs don't have a ticket key. For board-sourced briefs, the ticket key appears in the slug or can be cross-referenced via the brief file's `**Source:**` line.
