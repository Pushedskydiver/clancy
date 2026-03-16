# Planner Role — Current Implementation State

Baseline document capturing the complete Planner role as built today (2026-03-15, branch `feature/pr-based-flow`).

---

## Table of Contents

1. [Overview](#overview)
2. [Enabling the Planner](#enabling-the-planner)
3. [/clancy:plan Command](#clancyplan-command)
4. [/clancy:approve Command](#clancyapprove-command)
5. [Env Vars](#env-vars)
6. [Init Integration](#init-integration)
7. [Settings Integration](#settings-integration)
8. [Help Integration](#help-integration)
9. [Env Schema (Zod)](#env-schema-zod)
10. [Bugs, Inconsistencies, and Gaps](#bugs-inconsistencies-and-gaps)

---

## Overview

The Planner is an **optional role** that refines backlog tickets into structured implementation plans before they reach the Implementer. It operates on a **separate planning queue** (earlier-stage tickets) so it never competes with `/clancy:once` for the same tickets.

**Source files:**
- Command: `src/roles/planner/commands/plan.md`
- Command: `src/roles/planner/commands/approve.md`
- Workflow: `src/roles/planner/workflows/plan.md`
- Workflow: `src/roles/planner/workflows/approve.md`
- Docs: `docs/roles/PLANNER.md`
- Env schema: `src/schemas/env.ts`

---

## Enabling the Planner

1. Add `CLANCY_ROLES="planner"` to `.clancy/.env`
2. Re-run the installer: `npx chief-clancy@latest --local` (or `--global`)
3. Can also be toggled via `/clancy:settings` (option `[R1]`)

The installer reads `CLANCY_ROLES` and copies planner command/workflow files into `.claude/commands/clancy/`. Core roles (implementer, reviewer, setup) are always installed regardless.

---

## /clancy:plan Command

### Command file (`src/roles/planner/commands/plan.md`)

Thin wrapper: states the purpose, accepts optional numeric argument and `--force`, references the workflow file, and instructs Claude to follow the plan workflow. Explicitly states: "Do not implement anything — planning only."

### Arguments

| Argument | Behaviour |
|---|---|
| (none) | Plan 1 ticket |
| `N` (numeric, e.g. `3`) | Plan up to N tickets, capped at 10 |
| `--force` | Re-plan tickets that already have a plan; reads feedback comments |
| Combined (e.g. `3 --force`) | Arguments can appear in any order |

If N > 10: caps at 10 with message `Maximum batch size is 10. Planning 10 tickets.`
If N >= 5: confirmation prompt `Planning {N} tickets — each requires codebase exploration. Continue? [Y/n]`

### Step-by-step workflow

#### Step 1 — Preflight checks

1. Check `.clancy/` exists and `.clancy/.env` is present. Stop if missing.
2. Source `.clancy/.env`, check board credentials are present.
3. Check `.clancy/docs/` — if empty or missing, warn:
   ```
   Plans will be less accurate without codebase context.
   Run /clancy:map-codebase first for better results.
   Continue anyway? [y/N]
   ```
   User can decline (stop) or confirm (continue without docs).

#### Step 2 — Parse arguments

Parse the numeric and `--force` arguments as described above.

#### Step 3 — Fetch backlog tickets

Detects board from `.clancy/.env` and fetches from the **planning queue**.

##### Jira

**JQL:**
```
project=$JIRA_PROJECT_KEY
[AND sprint in openSprints()]       -- if CLANCY_JQL_SPRINT is set
[AND labels = "$CLANCY_LABEL"]      -- if CLANCY_LABEL is set
AND assignee=currentUser()
AND status="$CLANCY_PLAN_STATUS"    -- defaults to "Backlog"
ORDER BY priority ASC
```

**API call:**
```
POST $JIRA_BASE_URL/rest/api/3/search/jql
Auth: Basic (JIRA_USER:JIRA_API_TOKEN)
Body: {"jql": "<above>", "maxResults": N, "fields": ["summary", "description", "issuelinks", "parent", "customfield_10014", "comment"]}
```

Key: includes `comment` field in the fetch so existing plans and feedback can be checked without a separate call.

##### GitHub Issues

1. Resolve username: `GET https://api.github.com/user` (not `@me` — breaks with fine-grained PATs)
2. Fetch issues:
   ```
   GET https://api.github.com/repos/$GITHUB_REPO/issues?state=open&assignee=$GITHUB_USERNAME&labels=$CLANCY_PLAN_LABEL&per_page=N
   ```
   - `CLANCY_PLAN_LABEL` defaults to `needs-refinement`
   - Filter out PRs (entries with `pull_request` key)
3. For each issue, fetch comments separately: `GET /repos/$GITHUB_REPO/issues/{number}/comments`

##### Linear

**GraphQL query:**
```graphql
query {
  viewer {
    assignedIssues(
      filter: {
        state: { type: { eq: "$CLANCY_PLAN_STATE_TYPE" } }
        team: { id: { eq: "$LINEAR_TEAM_ID" } }
      }
      first: $N
      orderBy: priority
    ) {
      nodes {
        id identifier title description
        parent { identifier title }
        comments { nodes { body createdAt } }
      }
    }
  }
}
```

- `CLANCY_PLAN_STATE_TYPE` defaults to `backlog`
- No label filter (unlike Jira/GitHub)
- Comments are fetched inline with the issue (no separate call)

**Error handling (all boards):**
- API failure: `Board API error: {status}. Check credentials or run /clancy:doctor.` Stop.
- No tickets: displays a "Nothing to see here" message with board-specific guidance. For GitHub, reminds that planning uses `CLANCY_PLAN_LABEL` (not `CLANCY_LABEL`). Stop.

#### Step 3b — Check for existing plans (unless --force)

Scans each ticket's comments for the marker `## Clancy Implementation Plan`.

| Condition | Behaviour |
|---|---|
| No plan found | Proceed to step 4 |
| Has plan, no `--force` | Skip: `Already planned. Use --force to re-plan.` |
| Has plan, with `--force` | Proceed to step 3c (read feedback) |

#### Step 3c — Read feedback comments (--force only)

Reads all comments posted **after** the most recent `## Clancy Implementation Plan` comment. These are presumed to be PO/team feedback. No special syntax required — just normal board comments.

This feedback is passed to the plan generation step as additional context.

#### Step 4 — For each ticket: Generate plan

Displays header:
```
Clancy — Plan
"Let me consult my crime files..." — Planning {N} ticket(s).
```

Per-ticket progress:
```
[{KEY}] {Title}
  Exploring codebase...
  Plan posted as comment.
```

##### 4a. Quick feasibility scan

Scans ticket title and description for non-codebase signals before investing time in exploration.

**Fail signals (skip immediately):**
- External platform references (Google Tag Manager, Salesforce, AWS console, etc.)
- Human process steps (get sign-off, coordinate with, schedule meeting, etc.)
- Non-code deliverables (write runbook, create presentation, update wiki)
- Infrastructure ops (rotate API keys in prod, scale fleet, restart service)

If infeasible: `[{KEY}] {Title} — not a codebase change. Skipping.` with reason.

**Pass signals:** Anything mentioning code, components, features, bugs, UI, API, tests, refactoring, or lacking enough context to determine (benefit of the doubt).

##### 4b. Check for previous implementation (QA return detection)

Checks `.clancy/progress.txt` for a previous entry matching the ticket key ending with `| DONE`. If found:
- Flag as "Previously implemented — returned from QA"
- Read QA/review comments from the board
- Focus the plan on what likely went wrong and what needs fixing

##### 4c. Read codebase context

If `.clancy/docs/` exists, reads:
- `STACK.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`, `TESTING.md`, `DESIGN-SYSTEM.md`, `ACCESSIBILITY.md`, `DEFINITION-OF-DONE.md`

These inform the plan's technical approach, affected files, and test plan.

##### 4d. Figma design context (if applicable)

If ticket description contains a Figma URL **and** `FIGMA_API_KEY` is configured: fetches design context via 3 MCP calls (metadata, design context, screenshot). Informs acceptance criteria and affected components.

If Figma URL present but no API key: notes in plan "Figma URL present but API key not configured."

##### 4e. Explore source files

**S-sized tickets (simple/obvious):** Single-pass — Glob and Read directly.

**M/L-sized tickets (broad scope):** 2-3 parallel Explore subagents:
- Agent 1: Files matching ticket keywords, existing similar implementations
- Agent 2: Related test files, test patterns in affected areas
- Agent 3: (UI tickets) Component structure, design system usage, accessibility patterns

Size is estimated from ticket title/description before exploration (rough heuristic).

##### 4f. Generate plan

Uses this exact template:

```markdown
## Clancy Implementation Plan

**Ticket:** [{KEY}] {Title}
**Planned:** {YYYY-MM-DD}

### Summary
{1-3 sentences}

### Acceptance Criteria
- [ ] {Specific, testable criterion}

### Technical Approach
{2-4 sentences}

### Affected Files
| File | Change |
|------|--------|
| `src/path/file.ts` | {What changes and why} |

### Edge Cases
- {Specific edge case and handling}

### Test Plan
- [ ] {Specific test to write or verify}

### Dependencies
{Blockers, prerequisites, external deps. "None" if clean.}

### Size Estimate
**{S / M / L}** — {Brief justification}

---
*Generated by Clancy.
To request changes: comment on this ticket, then run `/clancy:plan --force` to re-plan with your feedback.
To approve: run `/clancy:approve {KEY}` to promote this plan to the ticket description.*
```

**If re-planning with feedback**, a `### Changes From Previous Plan` section is prepended before Summary.

**Quality rules:**
- Acceptance criteria must be testable, never vague
- Affected files must be real files found during exploration, not guesses
- Edge cases must be ticket-specific, not generic
- Size: S (< 1 hour, few files), M (1-4 hours, moderate), L (4+ hours, significant)
- If affected files > 15: note "Consider splitting this ticket"
- If UI ticket without Figma URL: note in plan
- If ticket mentions tech not in STACK.md: note in plan

**Dependency detection:**

| Type | Detection | Action |
|------|-----------|--------|
| Blocked by another ticket | Jira: issuelinks (type "Blocks"). GitHub: referenced issues. Linear: relations. | List blocking tickets. Note "Complete {KEY} first." |
| External API dependency | Mentioned in description or inferred from code | Include integration approach or mark as blocked |
| Unfinished design | UI ticket with no Figma/design reference | Note "Design dependency — no spec provided." |
| Library upgrade | Ticket mentions upgrading a dependency | Include upgrade as prerequisite step |
| Infra in the repo | DB migrations, docker-compose, CI config | Include in affected files, plan normally |

#### Step 5 — Post plan as comment

##### Jira

```
POST $JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/comment
Auth: Basic (JIRA_USER:JIRA_API_TOKEN)
Body: ADF JSON (Atlassian Document Format)
```

ADF mappings:
- `## Heading` -> heading node (level 2)
- `### Heading` -> heading node (level 3)
- `- bullet` -> bulletList > listItem > paragraph
- `- [ ] checkbox` -> taskList > taskItem (state: "TODO")
- `| table |` -> table > tableRow > tableCell
- `**bold**` -> marks: strong
- `` `code` `` -> marks: code
- Fallback: wrap complex sections in codeBlock node

##### GitHub

```
POST https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/comments
Auth: Bearer $GITHUB_TOKEN
Body: {"body": "<markdown plan>"}
```

GitHub accepts Markdown directly.

##### Linear

```
POST https://api.linear.app/graphql
Auth: $LINEAR_API_KEY (no Bearer prefix)
Body: mutation commentCreate(input: { issueId, body: "<markdown plan>" })
```

Linear accepts Markdown directly.

**On failure:** Prints the plan to stdout as fallback so the user can paste it manually. Never loses the plan.

#### Step 6 — Log

Appends to `.clancy/progress.txt`:
```
YYYY-MM-DD HH:MM | {KEY} | PLAN | {S/M/L}
```

#### Step 7 — Summary

```
Planned {N} ticket(s):

  [{KEY1}] {Title} — M | 6 files | Comment posted
  [{KEY2}] {Title} — S | 2 files | Comment posted
  [{KEY3}] {Title} — already planned
  [{KEY4}] {Title} — infeasible (external admin)

Plans written to your board. After review, run /clancy:approve {KEY} to promote.

"Let me dust this for prints..."
```

---

## /clancy:approve Command

### Command file (`src/roles/planner/commands/approve.md`)

Requires a ticket key argument (e.g. `/clancy:approve PROJ-123`). References the approve workflow.

### Step-by-step workflow

#### Step 1 — Preflight checks

Same as plan: check `.clancy/` and `.clancy/.env` exist, source credentials.

#### Step 2 — Parse argument

Requires a ticket key. If none provided: `Usage: /clancy:approve PROJ-123`. Stop.

Ticket key is case-insensitive. Accepts `PROJ-123`, `proj-123`, or `#123` (GitHub).

#### Step 3 — Fetch the plan comment

##### Jira

```
GET $JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/comment
Auth: Basic (JIRA_USER:JIRA_API_TOKEN)
```

##### GitHub

Strip `#` prefix if present, then:
```
GET https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/comments
Auth: Bearer $GITHUB_TOKEN
```

##### Linear

Uses `issueSearch` (fuzzy text search) to find the issue by identifier:
```graphql
query {
  issueSearch(query: "$IDENTIFIER", first: 5) {
    nodes { id identifier title description comments { nodes { body createdAt } } }
  }
}
```

**Important:** After fetching, verifies the returned issue's `identifier` field exactly matches the provided key (case-insensitive). If no exact match: `Issue {KEY} not found.`

Searches comments for the most recent one containing `## Clancy Implementation Plan`.

If no plan found: `No Clancy plan found for {KEY}. Run /clancy:plan first.` Stop.

#### Step 3b — Check for existing plan in description

Checks if the ticket description already contains `## Clancy Implementation Plan`. If it does:
```
This ticket's description already contains a Clancy plan.
Continuing will add a duplicate.

[1] Continue anyway
[2] Cancel
```

#### Step 4 — Confirm

```
Clancy — Approve

[{KEY}] {Title}
Size: {S/M/L} | {N} affected files
Planned: {date from plan}

Promote this plan to the ticket description? [Y/n]
```

#### Step 5 — Update ticket description

Appends the plan below the existing description with an `---` separator. **Never overwrites** the original description.

Format: `{existing description}\n\n---\n\n{full plan content}`

##### Jira

1. Fetch current description: `GET .../issue/$TICKET_KEY?fields=description`
2. Merge existing ADF with a `rule` node (horizontal rule) and plan as new ADF nodes
3. Update: `PUT .../issue/$TICKET_KEY` with `{"fields": {"description": <merged ADF>}}`
4. Fallback: wrap plan in codeBlock if ADF construction fails

##### GitHub

1. Fetch current body: `GET .../issues/$ISSUE_NUMBER`
2. Patch: `PATCH .../issues/$ISSUE_NUMBER` with `{"body": "<existing>\n\n---\n\n<plan>"}`

##### Linear

1. Fetch current description via GraphQL
2. Update via `issueUpdate` mutation with appended plan

#### Step 6 — Confirm and log

**On success:**
```
Plan promoted to description for [{KEY}].

Move [{KEY}] to your implementation queue (e.g. "To Do") so /clancy:once picks it up.

"Book 'em, Lou." — The ticket is ready for /clancy:once.
```

Log entry: `YYYY-MM-DD HH:MM | {KEY} | APPROVE | —`

**On failure:** `Failed to update description for [{KEY}]. Check your board permissions.`

### What approve does NOT do

- Does NOT transition the ticket status (tells user to move it manually)
- Does NOT swap labels (e.g. remove `needs-refinement`, add `clancy` on GitHub)
- Does NOT regenerate the plan — takes it verbatim from the comment
- Uses the most recent plan comment if multiple exist

---

## Env Vars

### Planner-specific env vars

| Var | Board | Default | Purpose |
|-----|-------|---------|---------|
| `CLANCY_PLAN_STATUS` | Jira | `Backlog` | Jira status name for the planning queue |
| `CLANCY_PLAN_LABEL` | GitHub | `needs-refinement` | GitHub label marking issues for planning |
| `CLANCY_PLAN_STATE_TYPE` | Linear | `backlog` | Linear state type enum for the planning queue |
| `CLANCY_ROLES` | All | (empty) | Comma-separated list of optional roles; include `planner` to enable |

### Shared env vars used by the planner

| Var | Purpose |
|-----|---------|
| `CLANCY_LABEL` | Jira only: additional label filter applied on top of planning queue |
| `CLANCY_JQL_SPRINT` | Jira only: if set, adds sprint filter to planning query |
| `FIGMA_API_KEY` | If set, fetches Figma design context during plan generation |

### Defaults per board

| Board | Planning queue filter | Implementation queue filter |
|-------|----------------------|---------------------------|
| Jira | `status = "Backlog"` (CLANCY_PLAN_STATUS) | `status = "To Do"` (CLANCY_JQL_STATUS) |
| GitHub | label: `needs-refinement` (CLANCY_PLAN_LABEL) | label: `clancy` (CLANCY_LABEL) |
| Linear | `state.type: "backlog"` (CLANCY_PLAN_STATE_TYPE) | `state.type: "unstarted"` |

---

## Init Integration

Source: `src/roles/setup/workflows/init.md`

### Step 4c — Optional roles

During init, after scaffolding, the user is offered optional roles:

```
Clancy includes the Implementer, Reviewer, and Setup roles by default.
You can enable additional roles:

  [1] Planner — Refine vague tickets into structured implementation plans

Enter roles to enable (e.g. 1 or "all") or press Enter to skip:
```

Accepts numbers, role names, "all", or Enter to skip.

If selected: writes `CLANCY_ROLES="planner"` to `.clancy/.env`. The installer reads this on the next run to copy planner files.

### Step 4d — Planning queue status (Jira only, if Planner selected)

Only shown if:
- User selected Planner in Step 4c, OR
- Re-running init and `CLANCY_ROLES` already includes `planner`
- Board is Jira

```
Which Jira status should Clancy pick planning tickets from?

[1] Backlog (default)
[2] Enter a different value
```

Stores as `CLANCY_PLAN_STATUS` in `.clancy/.env`.

**Note:** There is no equivalent Step 4d for GitHub or Linear during init. GitHub and Linear users get their planner queue config defaults only. They must use `/clancy:settings` to change `CLANCY_PLAN_LABEL` or `CLANCY_PLAN_STATE_TYPE`.

---

## Settings Integration

Source: `src/roles/setup/workflows/settings.md`

### [R1] Planner role toggle

```
Planner role — currently: {enabled / disabled}
The Planner refines vague backlog tickets into structured implementation plans.
Commands: /clancy:plan, /clancy:approve

[1] Enable
[2] Disable
[3] Cancel
```

- Enable: adds `planner` to `CLANCY_ROLES`, shows re-run installer message
- Disable: removes `planner` from `CLANCY_ROLES`, but **keeps** planner-specific settings (`CLANCY_PLAN_STATUS`, etc.) for frictionless re-enabling

### [P1] Plan queue config (board-dependent, only shown if Planner enabled)

**Jira — Plan queue status:**
```
[1] Backlog (default)
[2] Enter a different value
```
Writes `CLANCY_PLAN_STATUS`.

**GitHub — Plan label:**
```
[1] needs-refinement (default)
[2] Enter a different label name
```
Writes `CLANCY_PLAN_LABEL`.

**Linear — Plan state type:**
```
[1] backlog (default)
[2] triage
[3] Enter a different value
```
Writes `CLANCY_PLAN_STATE_TYPE`.

---

## Help Integration

Source: `src/roles/setup/commands/help.md`

The Planner section appears with an `*(optional — enable via CLANCY_ROLES=planner in .clancy/.env)*` note:

| Command | Description |
|---|---|
| `/clancy:plan` | Refine backlog tickets into structured implementation plans |
| `/clancy:plan 3` | Plan up to 3 tickets in batch mode |
| `/clancy:plan --force` | Re-plan tickets that already have a plan (reads feedback) |
| `/clancy:approve` | Promote an approved plan to the ticket description |

---

## Env Schema (Zod)

Source: `src/schemas/env.ts`

All three planner env vars are defined in the `sharedEnvSchema` as optional strings:

```typescript
CLANCY_PLAN_STATUS: z.optional(z.string()),
CLANCY_PLAN_LABEL: z.optional(z.string()),
CLANCY_PLAN_STATE_TYPE: z.optional(z.string()),
```

Also in shared: `CLANCY_ROLES: z.optional(z.string())`

These are inherited by all board-specific schemas (`jiraEnvSchema`, `githubEnvSchema`, `linearEnvSchema`) via `z.extend(sharedEnvSchema, {...})`.

No validation beyond "optional string" — no enum check for `CLANCY_PLAN_STATE_TYPE`, no default value enforcement at the schema level. Defaults are applied in the workflow markdown files only.

---

## Scaffold Integration

Source: `src/roles/setup/workflows/scaffold.md`

### .env.example templates

**Jira .env.example** includes:
```
# ─── Optional: Planner queue ─────────────────────────────────────────────────
# Status for backlog tickets that /clancy:plan fetches from (default: Backlog)
# Only used if Planner role is enabled via CLANCY_ROLES
# CLANCY_PLAN_STATUS="Backlog"
```

**GitHub .env.example** includes:
```
# ─── Planner Queue (optional — requires CLANCY_ROLES to include "planner") ───
# Label for backlog issues that /clancy:plan fetches from (default: needs-refinement)
# CLANCY_PLAN_LABEL="needs-refinement"
```

**Linear .env.example:** Does NOT include `CLANCY_PLAN_STATE_TYPE`. (See bugs section.)

---

## The Complete Workflow (End-to-End)

```
/clancy:plan          Post plan as comment on ticket
      |
Review + feedback     Team comments on the ticket normally
      |
/clancy:plan --force  Re-plan incorporating feedback (optional, repeat as needed)
      |
/clancy:approve       Promote plan to description
      |
(Manual)              User moves ticket to implementation queue
      |
/clancy:once          Implementer picks it up with full plan context
```

### Plan comment identification

The marker text `## Clancy Implementation Plan` is used by both commands:
- `/clancy:plan` checks for it to detect already-planned tickets
- `/clancy:approve` searches for it to find the plan to promote

### Progress.txt format

| Action | Log entry |
|--------|-----------|
| Plan | `YYYY-MM-DD HH:MM \| {KEY} \| PLAN \| {S/M/L}` |
| Approve | `YYYY-MM-DD HH:MM \| {KEY} \| APPROVE \| —` |

### GitHub label-as-queue flow (documented in PLANNER.md)

1. User manually adds `needs-refinement` label
2. `/clancy:plan` picks up issues with that label
3. `/clancy:approve` removes `needs-refinement` and adds `clancy`
4. `/clancy:once` picks up issues with `clancy` label
5. On completion, Clancy closes the issue

**However:** the approve workflow does not actually implement the label swap. See bugs section.

---

## Bugs, Inconsistencies, and Gaps

### 1. Approve does NOT transition ticket status or swap labels

**Documentation claim** (`docs/roles/PLANNER.md` line 53-54, 58-63):
> "/clancy:approve moves the ticket from the planning status to the implementation status"
> "/clancy:approve removes needs-refinement and adds clancy (the implementation queue label)"

**Actual implementation** (`src/roles/planner/workflows/approve.md`):
The workflow only appends the plan to the ticket description and tells the user:
> "Move [{KEY}] to your implementation queue (e.g. 'To Do') so /clancy:once picks it up."

There is no step to transition Jira/Linear status, and no step to swap GitHub labels. The user must do this manually. The documentation is incorrect about this being automated.

### 2. Linear .env.example missing CLANCY_PLAN_STATE_TYPE

The Jira `.env.example` includes `CLANCY_PLAN_STATUS` and the GitHub `.env.example` includes `CLANCY_PLAN_LABEL`, but the Linear `.env.example` does not include `CLANCY_PLAN_STATE_TYPE`. Linear users who enable the Planner have no `.env.example` reference for this setting.

### 3. No init Step 4d equivalent for GitHub or Linear

During init, only Jira users get a planning queue configuration step (Step 4d). GitHub and Linear users who enable the Planner get only the defaults (`needs-refinement` and `backlog` respectively) with no opportunity to customize during init. They must use `/clancy:settings` afterward.

### 4. No validation of CLANCY_PLAN_STATE_TYPE values

The Zod schema accepts any string for `CLANCY_PLAN_STATE_TYPE`, but Linear state types are an enum (`backlog`, `unstarted`, `started`, `completed`, `canceled`, `triage`). An invalid value would silently return no results from the API.

### 5. GitHub planning uses CLANCY_PLAN_LABEL, not CLANCY_LABEL

GitHub has two separate label systems:
- `CLANCY_PLAN_LABEL` (default: `needs-refinement`) for the planning queue
- `CLANCY_LABEL` (default: `clancy`) for the implementation queue

This is by design but could confuse users. The plan workflow does include a GitHub-specific note in the "no tickets found" message to help.

### 6. Linear approve uses issueSearch (fuzzy)

The approve workflow uses `issueSearch` (fuzzy text search) to find Linear issues by identifier, then verifies the exact match. This could theoretically return no results if the identifier matches common terms, though the post-fetch exact match check mitigates this.

### 7. Plan template in PLANNER.md docs differs from workflow

The `docs/roles/PLANNER.md` describes the plan template sections as:
> Summary, Size estimate, Affected files, Approach, Acceptance criteria, Risks & edge cases, Footer

But the actual template in the workflow (`src/roles/planner/workflows/plan.md`) has:
> Summary, Acceptance Criteria, Technical Approach, Affected Files, Edge Cases, Test Plan, Dependencies, Size Estimate, Footer

The docs use different section names and a different order, and omit Test Plan and Dependencies.

### 8. No batch mode for approve

`/clancy:approve` only accepts a single ticket key. There is no batch approval (e.g. `/clancy:approve PROJ-123 PROJ-124`). This means approving multiple planned tickets requires running the command multiple times.

### 9. Jira comment field included in planning query but not in approve fetch

The plan workflow fetches the `comment` field directly in the JQL search response. The approve workflow makes a separate `GET .../issue/$TICKET_KEY/comment` call. This is not a bug — it's just a different approach — but the approve workflow requires an extra API call that could be avoided.

### 10. No CLANCY_LABEL filter for Linear planning queue

The Jira planning query includes `CLANCY_LABEL` as an additional filter on top of `CLANCY_PLAN_STATUS`, but the Linear planning query has no equivalent label filter. Linear planning fetches all issues matching the state type and team, assigned to the current user.
