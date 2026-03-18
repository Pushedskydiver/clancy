# Strategist Role: GitHub Issues — Complete Flow & Edge Cases

This document covers every scenario for `/clancy:brief` and `/clancy:approve-brief` when the board provider is GitHub Issues. It is an implementation reference — not user docs.

---

## Table of Contents

1. [GitHub Issues Constraints](#1-github-issues-constraints)
2. [API Reference](#2-api-reference)
3. [New Schemas & Types](#3-new-schemas--types)
4. [Happy Path: /clancy:brief #50](#4-happy-path-clancybrief-50)
5. [Happy Path: /clancy:brief "Add dark mode"](#5-happy-path-clancybrief-add-dark-mode)
6. [Happy Path: /clancy:brief --from docs/rfc.md](#6-happy-path-clancybrief---from-docsrfcmd)
7. [Happy Path: /clancy:brief (interactive)](#7-happy-path-clancybrief-interactive)
8. [Happy Path: /clancy:approve-brief](#8-happy-path-clancyapprove-brief)
9. [Edge Cases: Issue Validation](#9-edge-cases-issue-validation)
10. [Edge Cases: Re-brief Flow](#10-edge-cases-re-brief-flow)
11. [Edge Cases: approve-brief Failures](#11-edge-cases-approve-brief-failures)
12. [Edge Cases: API Failures](#12-edge-cases-api-failures)
13. [Edge Cases: Idempotency & Race Conditions](#13-edge-cases-idempotency--race-conditions)
14. [Edge Cases: Labels & Components](#14-edge-cases-labels--components)
15. [Edge Cases: Milestones](#15-edge-cases-milestones)
16. [Edge Cases: Batch Mode](#16-edge-cases-batch-mode)
17. [Edge Cases: Stale Brief Detection](#17-edge-cases-stale-brief-detection)
18. [Issue Body Format](#18-issue-body-format)
19. [Summary Table](#19-summary-table)

---

## 1. GitHub Issues Constraints

GitHub Issues has no native epic, parent/child, or dependency concepts. The workarounds are:

| Concept | GitHub Equivalent | Mechanism |
|---------|------------------|-----------|
| Epic / parent | Issue (the source issue) | Cross-referenced via "Parent: #N" in child body |
| Child tickets | Issues | Created via `POST /repos/{owner}/{repo}/issues` |
| Dependencies | None (native) | "Depends on #N" text in issue body |
| Component filter | Label | `component:{value}` label (e.g. `component:api`) |
| Planning queue | Label | `CLANCY_PLAN_LABEL` (default `needs-refinement`) |
| Size | Label | `size:S`, `size:M`, `size:L` labels |

**Milestone interaction:** GitHub milestones are orthogonal to the parent/child relationship Clancy creates. Milestones group issues by release/sprint. They do NOT serve as the epic relationship — the source issue itself is the parent. Milestones are preserved if set on the parent but not propagated to children (the user sets milestones manually for release planning).

---

## 2. API Reference

### Fetch a single issue

```
GET /repos/{owner}/{repo}/issues/{number}
Authorization: Bearer {GITHUB_TOKEN}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

**Response (200):**
```json
{
  "number": 50,
  "title": "Redesign settings page",
  "body": "The settings page needs...",
  "state": "open",
  "labels": [{"name": "enhancement"}],
  "milestone": {"title": "v2.0", "number": 3},
  "pull_request": null,
  "html_url": "https://github.com/owner/repo/issues/50"
}
```

Key: if `pull_request` key is present and non-null, this is a PR, not an issue.

**Error responses:**
- `404` — issue does not exist (or repo is private and token lacks access)
- `401` — bad/expired token
- `403` — rate limited or insufficient permissions
- `410` — issue was transferred or deleted

### Fetch issue comments

```
GET /repos/{owner}/{repo}/issues/{number}/comments
Authorization: Bearer {GITHUB_TOKEN}
```

Returns array of `{ id, body, created_at, user: { login } }`. Paginated (30 per page default, max 100 via `per_page`).

### Post a comment

```
POST /repos/{owner}/{repo}/issues/{number}/comments
Authorization: Bearer {GITHUB_TOKEN}
Content-Type: application/json

{"body": "markdown content"}
```

**Response (201):** `{ id, body, created_at, html_url }`
**Errors:** 404 (issue not found), 403 (no write access), 422 (body empty)

### Create an issue

```
POST /repos/{owner}/{repo}/issues
Authorization: Bearer {GITHUB_TOKEN}
Content-Type: application/json

{
  "title": "string",
  "body": "markdown",
  "labels": ["label1", "label2"],
  "assignees": ["username"],
  "milestone": 3
}
```

**Response (201):**
```json
{
  "number": 51,
  "title": "...",
  "html_url": "https://github.com/owner/repo/issues/51",
  "labels": [...],
  "state": "open"
}
```

**Errors:**
- `403` — no write access or rate limited
- `404` — repo not found
- `410` — issues disabled on this repo
- `422` — validation error (bad label name, bad milestone number, invalid assignee)

**Note on labels:** If a label in the `labels` array does not exist on the repo, GitHub returns `422`. Clancy must either pre-create labels or handle this gracefully.

### Add labels (separate endpoint)

```
POST /repos/{owner}/{repo}/issues/{number}/labels
Content-Type: application/json

{"labels": ["label1", "label2"]}
```

This adds labels without removing existing ones. Returns the full label set.

### Check rate limit

```
GET /repos/{owner}/{repo}/rate_limit
```

Or check `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers on every response.

---

## 3. New Schemas & Types

### Zod schema for single issue fetch (extends existing `githubIssueSchema`)

The existing `githubIssueSchema` in `src/schemas/github.ts` needs extending for the strategist:

```typescript
/** Extended schema for fetching a single issue (GET /repos/.../issues/{n}). */
export const githubSingleIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.optional(z.nullable(z.string())),
  state: z.string(),                         // "open" | "closed"
  pull_request: z.optional(z.unknown()),
  labels: z.array(z.object({ name: z.string() })),
  milestone: z.optional(z.nullable(z.object({
    title: z.string(),
    number: z.number(),
  }))),
  html_url: z.string(),
});

/** Response from issue creation. */
export const githubCreatedIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  labels: z.array(z.object({ name: z.string() })),
});
```

### ProgressStatus additions

In `src/types/remote.ts`, add `BRIEF` and `APPROVE_BRIEF`:

```typescript
export type ProgressStatus =
  | 'DONE' | 'SKIPPED' | 'PR_CREATED' | 'PUSHED'
  | 'PUSH_FAILED' | 'LOCAL' | 'PLAN' | 'APPROVE'
  | 'REWORK' | 'BRIEF' | 'APPROVE_BRIEF';
```

### Env schema additions

In `src/schemas/env.ts`, add to `sharedEnvSchema`:

```typescript
CLANCY_BRIEF_ISSUE_TYPE: z.optional(z.string()),  // Jira only, ignored for GitHub
CLANCY_BRIEF_EPIC: z.optional(z.string()),         // Default parent key (e.g. "#100")
CLANCY_COMPONENT: z.optional(z.string()),          // Component filter label
```

---

## 4. Happy Path: /clancy:brief #50

**What the user does:** Runs `/clancy:brief #50` in a repo with GitHub Issues configured.

### Step 1 — Preflight

1. Check `.clancy/.env` exists. If not: stop with setup message.
2. Parse `.clancy/.env`, call `detectBoard()` -> returns `{ provider: 'github', env: { GITHUB_TOKEN, GITHUB_REPO, ... } }`.
3. Ping GitHub: `GET /repos/{owner}/{repo}` via `pingGitHub()`. If fails: stop with error.
4. Branch freshness check (shared preflight — see design doc Step 1a).
5. Relevance check deferred until after issue is fetched (need the title/description first).

### Step 2 — Parse arguments

- Input: `#50`
- Detected mode: **board ticket**
- Parse `#50` -> issue number `50`
- Accept formats: `#50`, `50` (bare number when GitHub board detected)

### Step 3 — Fetch the source issue

**API call:**
```
GET /repos/{GITHUB_REPO}/issues/50
Headers: githubHeaders(GITHUB_TOKEN)
```

**On success (200):**
1. Validate response against `githubSingleIssueSchema`.
2. Check `pull_request` field — if present and non-null, this is a PR, not an issue. Stop with:
   ```
   ✗ #50 is a pull request, not an issue. Provide an issue number.
   ```
3. Check `state` — if `"closed"`, warn:
   ```
   ⚠ #50 is closed. Brief it anyway? [y/N]
   ```
   If user declines: stop. If confirms: continue with a note in the brief that the source issue is closed.
4. Extract: `title`, `body` (may be null/empty), `labels`, `milestone`.

**On failure:**
- `404`: `✗ Issue #50 not found in {GITHUB_REPO}. Check the issue number.` Stop.
- `401`: `✗ GitHub auth failed — check GITHUB_TOKEN in .clancy/.env` Stop.
- `403`: `✗ GitHub permission denied — check token scopes (needs repo access)` Stop.
- Network error: `✗ Could not reach GitHub — check network connection` Stop.

### Step 3a — Fetch existing comments

**API call:**
```
GET /repos/{GITHUB_REPO}/issues/50/comments?per_page=100
Headers: githubHeaders(GITHUB_TOKEN)
```

**Purpose:** Check for existing Clancy brief comment (re-brief detection) and gather any human feedback.

1. Scan comments for marker `# Clancy Strategic Brief`. If found:
   - Check for feedback comments posted AFTER the brief comment (by `created_at`).
   - If feedback exists: enter re-brief flow (see [Section 10](#10-edge-cases-re-brief-flow)).
   - If no feedback: skip with `⏭ #50 already briefed. Add feedback on the issue, then re-run to revise.`
   - If `--fresh` flag: ignore existing brief entirely, generate from scratch.
2. If no existing brief comment: proceed to research.

### Step 3b — Relevance check

Now that we have the issue title and description, check relevance against `.clancy/docs/STACK.md` and `ARCHITECTURE.md`. If irrelevant:
```
⏭ Skipping — this idea targets {platform}, but this codebase is {stack}
```
Log: `2026-03-14 10:30 | BRIEF | #50 | SKIPPED — not relevant (iOS, codebase is React web)`
Stop.

### Step 4 — Research (adaptive agents)

Determine complexity from issue title + body:
- **Narrow** (e.g. "Fix typo in header"): 1 codebase agent
- **Moderate** (e.g. "Add dark mode support"): 2 codebase agents
- **Broad** (e.g. "Redesign authentication system"): 3 codebase agents

**Codebase research (always):**
- Read `.clancy/docs/` (STACK.md, ARCHITECTURE.md, CONVENTIONS.md, etc.)
- Explore affected areas using Glob + Read
- Scan open issues for duplicates (optional — `GET /repos/{GITHUB_REPO}/issues?state=open&per_page=30` and text-match against title)

**Web research (judgement-based or `--research`):**
- Parallel agent alongside codebase agents
- Max 4 agents total

### Step 5 — Generate brief

Using the brief template from the design doc. The `Source` field records the origin:
```markdown
**Source:** [#50] Redesign settings page
```

### Step 6 — Save locally

Write to `.clancy/briefs/{YYYY-MM-DD}-redesign-settings-page.md`.

**Slug generation:**
- Derive from issue title: lowercase, replace non-alphanumeric with hyphens, trim, truncate to 50 chars.
- If file exists: append `-2`, `-3`, etc.

### Step 7 — Post as comment on #50

**API call:**
```
POST /repos/{GITHUB_REPO}/issues/50/comments
Headers: githubHeaders(GITHUB_TOKEN), Content-Type: application/json
Body: {"body": "<full brief markdown>"}
```

GitHub accepts Markdown directly — no ADF conversion needed.

**On success (201):**
- Display: `Brief posted as comment on #50.`

**On failure:**
- `403`: `⚠ Failed to post brief to #50 (permission denied). Brief saved locally.`
- `404`: `⚠ Issue #50 no longer exists. Brief saved locally.`
- Network error: `⚠ Failed to post brief to #50 (network error). Brief saved locally.`

In all failure cases, the brief is still saved locally in `.clancy/briefs/`. The user can manually paste it.

### Step 8 — Display

Show the full brief to the user, then:
```
Brief saved to .clancy/briefs/2026-03-14-redesign-settings-page.md
Posted as comment on #50.

Next steps:
  Review and edit the brief, then run /clancy:approve-brief to create tickets.
  To revise: add feedback on #50, then re-run /clancy:brief #50.
```

### Step 9 — Log

Append to `.clancy/progress.txt`:
```
2026-03-14 10:30 | BRIEF | redesign-settings-page | 4 proposed tickets
```

**What the user sees (full output):**
```
Clancy — Brief
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Let me consult my crime files..." — Researching #50.

[#50] Redesign settings page
  Exploring codebase... (2 agents)
  ✅ Brief generated — 4 tickets proposed

<full brief content>

Brief saved to .clancy/briefs/2026-03-14-redesign-settings-page.md
Posted as comment on #50.

Next steps:
  To request changes:
    • Comment on #50 on GitHub, then re-run /clancy:brief #50 to revise
    • Or add a ## Feedback section to the brief file and re-run
  To approve: /clancy:approve-brief #50
  To start over: /clancy:brief --fresh #50
```

---

## 5. Happy Path: /clancy:brief "Add dark mode"

**What the user does:** Runs `/clancy:brief "Add dark mode support"` — idea not yet on a board.

### Differences from board-sourced flow

1. **No issue fetch** — the idea comes from the inline text.
2. **No comment posting** — there is no issue to comment on.
3. **Source field** in brief: `**Source:** "Add dark mode support"`
4. **No re-brief detection** from board comments — re-brief only via local `.clancy/briefs/` file detection.
5. **No parent issue** — when `/clancy:approve-brief` runs, tickets are standalone unless `--epic #N` is provided.

### Step 2 — Parse arguments

- Input: `"Add dark mode support"`
- Detected mode: **inline text** (string is quoted and does not match `#\d+` pattern)

### Steps 3-4 — Research

Same codebase + optional web research. No issue fetch.

### Step 5 — Save

Write to `.clancy/briefs/2026-03-14-add-dark-mode-support.md`.

### Step 6 — No board posting

Brief is local only. Display:
```
Brief saved to .clancy/briefs/2026-03-14-add-dark-mode-support.md

This brief is local-only (not linked to a board issue).
To create tickets under a parent issue: /clancy:approve-brief --epic #100
To create standalone tickets: /clancy:approve-brief

Next steps:
  To request changes:
    • Add a ## Feedback section to:
      .clancy/briefs/2026-03-14-add-dark-mode-support.md
    • Or create a companion file:
      .clancy/briefs/2026-03-14-add-dark-mode-support.feedback.md
    Then re-run /clancy:brief to revise.
  To approve: /clancy:approve-brief add-dark-mode-support
  To start over: /clancy:brief --fresh "Add dark mode support"
```

### Progress log

```
2026-03-14 10:30 | BRIEF | add-dark-mode-support | 3 proposed tickets
```

---

## 6. Happy Path: /clancy:brief --from docs/rfc.md

**What the user does:** Runs `/clancy:brief --from docs/rfcs/auth-rework.md`.

### Differences from other flows

1. **File read** — Clancy reads the file content as the idea source.
2. **Source field** in brief: `**Source:** docs/rfcs/auth-rework.md`
3. Same as inline text for board interaction — no issue fetch, no comment posting.

### Step 2 — Parse arguments

- Input: `--from docs/rfcs/auth-rework.md`
- Detected mode: **from file**
- Resolve path relative to project root. If file does not exist:
  ```
  ✗ File not found: docs/rfcs/auth-rework.md
  ```
  Stop.
- Read file contents. If empty:
  ```
  ⚠ File docs/rfcs/auth-rework.md is empty. Nothing to brief.
  ```
  Stop.

### Slug generation

Derive from filename: `auth-rework` (strip extension, strip date prefix if present).

### Everything else

Same as inline text flow — local brief, no board posting.

---

## 7. Happy Path: /clancy:brief (interactive)

**What the user does:** Runs `/clancy:brief` with no arguments.

### Step 2 — Prompt

Display:
```
What's the idea? Describe it in a sentence or two:
```

User types their idea. Clancy uses the response as the idea text. Flow continues as inline text mode.

If the user enters something that looks like a ticket reference (e.g. `#50` or `PROJ-123`), detect this and switch to board-sourced mode automatically:
```
That looks like an issue reference. Fetching #50...
```

---

## 8. Happy Path: /clancy:approve-brief

**What the user does:** Runs `/clancy:approve-brief` after reviewing a brief.

### Step 1 — Preflight

Same as brief — check `.clancy/.env`, detect board, ping GitHub.

### Step 2 — Load brief

1. Scan `.clancy/briefs/` for `.md` files WITHOUT a corresponding `.approved` marker file.
2. Filter to unapproved briefs.

**Selection logic:**
- No args + 1 unapproved brief: auto-select.
- No args + multiple unapproved briefs: display numbered list, ask user to pick.
- By index: `/clancy:approve-brief 2` — select the 2nd unapproved brief.
- By slug: `/clancy:approve-brief auth-rework` — match filename.
- By ticket: `/clancy:approve-brief #50` — scan `**Source:**` lines for `#50`.
- No unapproved briefs found:
  ```
  No unapproved briefs found. Run /clancy:brief to generate one.
  ```
  Stop.

### Step 3 — Parse the brief

Extract from the brief markdown:
- **Source** — determines if board-sourced (has `#N`) or inline/file.
- **Ticket Decomposition table** — parse each row for: index, title, description, size, dependencies, mode (AFK/HITL).
- **Parent issue** — from Source if board-sourced, or from `--epic` flag.

Validate:
- Decomposition table must exist and have at least 1 row.
- If 0 rows: `✗ Brief has no ticket decomposition. Edit the brief and add tickets.` Stop.
- If >10 rows: `⚠ Brief proposes {N} tickets (max 10). Only the first 10 will be created.` Truncate.
- If circular dependencies detected: `✗ Circular dependency between #N and #M.` Stop.
- Topological sort by dependency graph so blockers are created before dependents.

### Step 4 — Confirm

Display:
```
Clancy — Approve Brief
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Brief: redesign-settings-page
Parent: #50

Tickets to create (dependency order):
  [1] [S] [AFK]  Add settings layout component — No deps
  [2] [M] [AFK]  Implement theme toggle — After #1
  [3] [S] [AFK]  Add keyboard navigation — After #1
  [4] [M] [AFK]  Write integration tests — After #1, #2, #3

Labels: needs-refinement, component:frontend
AFK-ready: 4 | Needs human: 0

Create 4 issues? [Y/n]
```

If user declines: stop.

### Step 5 — Determine labels

Labels applied to every created issue:

1. **Planning queue label** — `CLANCY_PLAN_LABEL` (default `needs-refinement`). This puts them in the planner's queue.
2. **Clancy label** — `CLANCY_LABEL` if set (e.g. `clancy`).
3. **Component label** — `component:{CLANCY_COMPONENT}` if `CLANCY_COMPONENT` is set.
4. **Size label** — `size:{S|M|L}` from the decomposition table.
5. **Mode label** — `clancy:afk` or `clancy:hitl` from the Mode column. Used by `/clancy:run` to decide whether to pick up the ticket autonomously.

**Label pre-creation:** Before creating issues, check if all required labels exist on the repo. For each label that might not exist, attempt creation via POST (GitHub has no idempotent PUT for labels):

```
POST /repos/{owner}/{repo}/labels
Content-Type: application/json

{"name": "needs-refinement", "color": "d4c5f9"}
```

**Error handling:** If label creation fails (403 — no admin access), fall back to creating issues without that label and warn:
```
⚠ Could not create label "needs-refinement" (insufficient permissions). Issues created without it.
```

**Recommended approach:** Try to create the issue with labels included in the body. If GitHub returns 422 with a validation error about labels, retry without labels and warn.

### Step 6 — Create child issues

For each ticket in topological (dependency) order, with a **500ms delay** between API calls:

**API call:**
```
POST /repos/{GITHUB_REPO}/issues
Headers: githubHeaders(GITHUB_TOKEN), Content-Type: application/json
Body: {
  "title": "{ticket title}",
  "body": "<see Section 18 for body format>",
  "labels": ["needs-refinement", "size:M", "component:frontend"],
  "assignees": ["{resolved_username}"]
}
```

**Assignee resolution:** Use `resolveUsername(GITHUB_TOKEN)` (already implemented and cached). Assign the authenticated user to all created issues so they appear in their queue.

**On success (201):**
- Record the created issue number (`response.number`) and URL (`response.html_url`).
- Display: `  [1/4] ✅ #51 — Add settings layout component`

**On failure:**
- See [Section 12](#12-edge-cases-api-failures) for partial creation handling.

### Step 7 — Link to parent

If a parent issue exists (board-sourced or `--epic`), post a tracking comment on the parent issue listing all created children:

**API call:**
```
POST /repos/{GITHUB_REPO}/issues/{parent_number}/comments
Body: {"body": "<tracking comment — see below>"}
```

**Tracking comment format:**
```markdown
## Clancy — Approved Tickets

The following tickets were created from the strategic brief:

| # | Ticket | Size | Dependencies |
|---|--------|------|-------------|
| 1 | #51 — Add settings layout component | S | None |
| 2 | #52 — Implement theme toggle | M | #51 |
| 3 | #53 — Add keyboard navigation | S | #51 |
| 4 | #54 — Write integration tests | M | #51, #52, #53 |

Created by [Clancy](https://github.com/Pushedskydiver/clancy) on 2026-03-14.
```

This comment creates automatic GitHub cross-references from the parent to each child.

**If parent comment fails:** Warn but do not fail — the issues are already created.

### Step 8 — Update brief file

Edit the local brief file `.clancy/briefs/2026-03-14-redesign-settings-page.md`:
- Update the decomposition table to include created issue numbers:

```markdown
| #   | Title   | Description     | Size | Dependencies | Ticket |
| --- | ------- | --------------- | ---- | ------------ | ------ |
| 1   | Add settings layout component | ... | S | None | #51 |
| 2   | Implement theme toggle | ... | M | #1 | #52 |
```

- Update `**Status:** Draft` to `**Status:** Approved`

### Step 9 — Mark approved

Create marker file: `.clancy/briefs/2026-03-14-redesign-settings-page.approved`

Contents: timestamp only.
```
2026-03-14 10:45
```

### Step 10 — Summary

Display:
```
Clancy — Approve Brief
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4 tickets created under #50:

  [1/4] ✅ #51 — Add settings layout component (S)
  [2/4] ✅ #52 — Implement theme toggle (M)
  [3/4] ✅ #53 — Add keyboard navigation (S)
  [4/4] ✅ #54 — Write integration tests (M)

Tracking comment posted on #50.
Brief marked as approved.

Next: run /clancy:plan to generate implementation plans.
```

### Step 11 — Log

```
2026-03-14 10:45 | APPROVE_BRIEF | redesign-settings-page | 4 tickets created (#51, #52, #53, #54)
```

---

## 9. Edge Cases: Issue Validation

### 9a. Issue #50 does not exist

**What happens:** `GET /repos/{GITHUB_REPO}/issues/50` returns 404.

**What the user sees:**
```
✗ Issue #50 not found in owner/repo. Check the issue number and repo.
```

**Logged:** Nothing — command stops before any work.

### 9b. Issue #50 is a pull request

**What happens:** `GET /repos/{GITHUB_REPO}/issues/50` returns 200 but `pull_request` field is present and non-null.

**Detection:** Check `response.pull_request !== undefined && response.pull_request !== null`.

**What the user sees:**
```
✗ #50 is a pull request, not an issue. Provide an issue number for briefing.
```

**Logged:** Nothing.

### 9c. Issue #50 is closed

**What happens:** `GET /repos/{GITHUB_REPO}/issues/50` returns 200 with `state: "closed"`.

**What the user sees:**
```
⚠ #50 is closed. Brief it anyway? [y/N]
```

If user confirms: proceed. The brief's Source line notes the state:
```markdown
**Source:** [#50] Redesign settings page (closed)
```

If user declines: stop. Nothing logged.

### 9d. Issue #50 has no body (title only)

**What happens:** `body` is `null` or `""`.

**Behaviour:** This is fine. The brief is generated from the title alone. The research step explores the codebase based on the title. The brief may be less detailed, but there is no reason to block.

**Display note during research:**
```
[#50] Redesign settings page
  ⚠ No issue description — briefing from title only.
  Exploring codebase...
```

### 9e. Issue number is invalid

**Input:** `/clancy:brief #abc` or `/clancy:brief #0` or `/clancy:brief #-5`

**What the user sees:**
```
✗ Invalid issue number: "#abc". Use a positive integer (e.g. /clancy:brief #50).
```

**Parsing rule:** Strip `#` prefix, parse as integer. Must be >= 1.

### 9f. --epic #100 but #100 does not exist

**What the user does:** `/clancy:approve-brief --epic #100`

**What happens:** Before creating any child issues, validate the epic:
```
GET /repos/{GITHUB_REPO}/issues/100
```

If 404:
```
✗ Epic issue #100 not found in owner/repo. Check the issue number.
```
Stop. No tickets created.

If #100 is a PR:
```
✗ #100 is a pull request, not an issue. Provide an issue number as the epic.
```
Stop.

If #100 is closed: warn but proceed (same as 9c).

### 9g. --epic without a value

**What the user does:** `/clancy:approve-brief --epic`

**What the user sees:**
```
✗ --epic requires an issue number (e.g. --epic #100).
```

---

## 10. Edge Cases: Re-brief Flow

### 10a. Issue #50 already has a Clancy brief comment — no feedback

**Detection:** Scan comments for `# Clancy Strategic Brief` marker. Found at comment with `created_at: "2026-03-10T..."`. No comments posted after it (or only bot comments).

**What the user sees:**
```
⏭ #50 already briefed (2026-03-10). No feedback found.
   Add comments on #50 with your feedback, then re-run /clancy:brief #50 to revise.
   Or use /clancy:brief --fresh #50 to start from scratch.
```

**Logged:** Nothing — no work done.

### 10b. Issue #50 has a brief comment AND subsequent feedback

**Detection:** Brief comment found. Comments exist with `created_at` after the brief comment's `created_at`, posted by a user other than the bot (compare `user.login` against the resolved username).

**What happens:**
1. Read original brief (from local file OR from the comment body).
2. Read all feedback comments.
3. Generate revised brief with `### Changes From Previous Brief` section.
4. Save new brief locally (overwrite the existing file).
5. Post new comment on #50 (new comment, not edit — preserves history).
6. Display the revised brief.

**What the user sees:**
```
[#50] Redesign settings page
  Found existing brief with 2 feedback comments. Revising...
  Exploring codebase... (2 agents)
  ✅ Brief revised — 5 tickets proposed (was 4)

<revised brief>

Updated brief saved to .clancy/briefs/2026-03-14-redesign-settings-page.md
Revised brief posted as comment on #50.
```

**Logged:**
```
2026-03-14 11:00 | BRIEF | redesign-settings-page | 5 proposed tickets (revision)
```

### 10c. Re-brief with --fresh flag

**What the user does:** `/clancy:brief --fresh #50`

**What happens:** Ignores any existing brief and feedback. Generates from scratch as if no brief existed. Overwrites local file. Posts new comment on issue.

**What the user sees:**
```
[#50] Redesign settings page
  --fresh: ignoring existing brief. Generating from scratch...
  Exploring codebase...
```

### 10d. Local brief exists but no board comment

This can happen if the comment posting failed on a previous run.

**Detection:** File `.clancy/briefs/2026-03-14-redesign-settings-page.md` exists with Source `[#50]`, but no `# Clancy Strategic Brief` comment found on #50.

**Behaviour:** Treat as if no brief exists on the board. Check local file for `## Feedback` section. If present: revise. If not: ask if user wants to re-brief or post the existing one:
```
Found local brief for #50 but it wasn't posted to the issue.
[1] Post existing brief to #50
[2] Re-generate the brief
[3] Cancel
```

### 10e. Board comment exists but local file is missing

This can happen if the user deleted the local file.

**Detection:** Comment with `# Clancy Strategic Brief` found on #50, but no matching local file.

**Behaviour:** Re-download the brief from the comment into `.clancy/briefs/`. Then follow normal re-brief detection (check for feedback).

---

## 11. Edge Cases: approve-brief Failures

### 11a. User runs approve-brief but brief was from inline text (no parent)

**What the user does:** `/clancy:approve-brief` for a brief with Source `"Add dark mode support"`.

**Behaviour:** Create standalone issues (no parent linking). Display:
```
Clancy — Approve Brief
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Brief: add-dark-mode-support
Parent: none (inline brief)

Tickets to create:
  [1] Add theme context provider (S)
  [2] Implement CSS variable system (M) — depends on #1
  [3] Add toggle component (S) — depends on #1

No parent issue — tickets will be standalone.
To link to a parent: /clancy:approve-brief --epic #100

Create 3 standalone issues? [Y/n]
```

If user confirms: create issues without parent linking. No tracking comment posted. Dependencies still use cross-references between the newly created issues.

### 11b. User edits the brief between brief and approve

**What happens:** This is expected and fine. The approve workflow reads the current file contents, not a cached version. If the user changed ticket titles, sizes, or count, the approve workflow uses the edited version.

**Edge case within this:** If the user removes the decomposition table entirely:
```
✗ Brief has no ticket decomposition table. Edit the brief and add a table.
```

### 11c. Parent issue is closed between brief and approve

**What happens:** During approve, validate the parent issue state:
```
GET /repos/{GITHUB_REPO}/issues/{parent_number}
```

If closed:
```
⚠ Parent issue #50 is now closed. Create tickets anyway? [y/N]
```

If user confirms: create tickets. The tracking comment will still be posted on the closed issue (GitHub allows commenting on closed issues).

If user declines: stop. No tickets created.

### 11d. approve-brief run twice (idempotency)

**Detection:** The brief file already has an `.approved` marker file.

**What the user sees:**
```
Brief "redesign-settings-page" is already approved (2026-03-14 10:45).
Tickets were created: #51, #52, #53, #54

To re-create tickets, delete the .approved marker:
  rm .clancy/briefs/2026-03-14-redesign-settings-page.approved
```

Stop. No duplicate tickets created.

**Why not auto-detect by scanning board?** Checking every issue on the repo to see if these exact titles already exist is expensive and fragile (title could be edited). The `.approved` marker is the source of truth for idempotency.

### 11e. approve-brief with ambiguous selection

**What the user does:** `/clancy:approve-brief` with 3 unapproved briefs.

**What the user sees:**
```
Multiple unapproved briefs found:

  [1] redesign-settings-page (2026-03-14) — 4 tickets — Source: #50
  [2] add-dark-mode (2026-03-12) — 3 tickets — Source: inline
  [3] auth-rework (2026-03-10) — 6 tickets — Source: docs/rfcs/auth-rework.md

Which brief to approve? [1-3]
```

### 11f. approve-brief by ticket identifier with no match

**What the user does:** `/clancy:approve-brief #99`

**What happens:** Scan all unapproved brief files. None have `#99` in the Source field.

**What the user sees:**
```
No unapproved brief found for #99.

Unapproved briefs available:
  [1] redesign-settings-page — Source: #50
  [2] add-dark-mode — Source: inline

Run /clancy:brief #99 to generate a brief for that issue.
```

---

## 12. Edge Cases: API Failures

### 12a. Rate limiting (403 with rate limit headers)

**Detection:** Response status 403 AND `X-RateLimit-Remaining: 0` header present.

**During brief (single API call):**
```
✗ GitHub API rate limit reached. Resets at {X-RateLimit-Reset as local time}.
   Try again after the reset, or use a different token.
```

**During approve-brief (creating multiple issues):**
After each API call, check `X-RateLimit-Remaining`. If < 5:
```
⚠ Approaching GitHub rate limit ({remaining} remaining). Pausing for 60 seconds...
```
Wait 60 seconds, then continue.

If rate limit is hit mid-creation: see partial creation (12c).

### 12b. 401 during ticket creation

**What happens:** Token expired or was revoked between preflight ping and ticket creation.

**What the user sees:**
```
✗ GitHub auth failed during ticket creation. Check GITHUB_TOKEN.
   {N} of {total} tickets created before failure.
```

Then list what was created (see 12c).

### 12c. Partial creation (3 of 5 tickets created, then failure)

This is the most complex failure mode. Clancy must handle it gracefully.

**What happens:**
1. Tickets #1, #2, #3 created successfully (#51, #52, #53).
2. Ticket #4 fails (403 rate limit, 500 server error, network timeout).
3. Clancy stops creating tickets.

**Recovery strategy:**
1. Do NOT mark the brief as approved (no `.approved` marker).
2. DO update the brief file with the tickets created so far (add `#51`, `#52`, `#53` to the decomposition table).
3. Do NOT post tracking comment on parent (incomplete).
4. Display:

```
⚠ Partial creation: 3 of 5 tickets created before failure.

  [1/5] ✅ #51 — Add settings layout component (S)
  [2/5] ✅ #52 — Implement theme toggle (M)
  [3/5] ✅ #53 — Add keyboard navigation (S)
  [4/5] ✗  Write integration tests — GitHub API error: 403 (rate limited)
  [5/5] ⏭  Add e2e tests — skipped (previous failure)

Brief updated with created tickets but NOT marked as approved.
Re-run /clancy:approve-brief to create the remaining tickets.
```

**On re-run:** When `/clancy:approve-brief` is run again for this brief:
1. The brief is not marked approved, so it appears in the unapproved list.
2. Parse the decomposition table — tickets with a `Ticket` column value (e.g. `#51`) are already created.
3. Skip already-created tickets, create only the remaining ones.
4. Display:

```
Resuming: 2 tickets already created (#51, #52, #53). Creating 2 remaining.

  [1/5] ⏭ #51 — already created
  [2/5] ⏭ #52 — already created
  [3/5] ⏭ #53 — already created
  [4/5] ✅ #54 — Write integration tests (M)
  [5/5] ✅ #55 — Add e2e tests (M)

All 5 tickets created. Brief marked as approved.
```

### 12d. 422 validation error (bad label)

**What happens:** GitHub returns 422 because a label in the request does not exist on the repo.

**Strategy:** Retry without the offending label:
1. Parse the 422 error response for label validation details.
2. Remove the invalid label(s) from the request.
3. Retry the issue creation.
4. Warn:
```
⚠ Label "component:frontend" does not exist on owner/repo. Created issue without it.
   To fix: create the label on GitHub, then add it to the issues manually.
```

### 12e. 410 — Issues disabled on repo

**What happens:** GitHub returns 410 Gone when trying to create an issue on a repo with issues disabled.

**What the user sees:**
```
✗ Issues are disabled on owner/repo. Enable Issues in repo settings, or use a different repo.
```

### 12f. Network timeout during creation

**Handling:** Each API call uses a 15-second timeout (via `AbortController`). On timeout:
- Treat as failure, same as 12c partial creation flow.
- The issue may or may not have been created on GitHub's side (network timeout does not mean the request failed server-side).
- Warn: `⚠ Request timed out. The issue may have been created — check GitHub before re-running.`

---

## 13. Edge Cases: Idempotency & Race Conditions

### 13a. Two terminals run approve-brief simultaneously

**Risk:** Both read the brief as unapproved, both create tickets.

**Mitigation:** Before creating tickets, attempt to create the `.approved` marker file with `O_EXCL` (exclusive create — fails if file exists). If the marker already exists, another process won.

```typescript
const fd = openSync(markerPath, 'wx'); // O_WRONLY | O_CREAT | O_EXCL
writeSync(fd, timestamp);
closeSync(fd);
```

If `EEXIST`: stop with `Brief already being approved by another process.`

### 13b. User modifies brief while approve is running

**Risk:** Brief content changes mid-creation.

**Mitigation:** Read the brief file once at the start of approve and work from the in-memory copy. File changes during execution do not affect the running approval.

### 13c. Issue #50 edited between brief and approve

**Risk:** The parent issue's title or description changed.

**Behaviour:** This is fine — the brief was generated from a snapshot. The created tickets reference the brief, not the live issue. No special handling needed.

---

## 14. Edge Cases: Labels & Components

### 14a. CLANCY_LABEL interaction

If `CLANCY_LABEL` is set (e.g. `clancy`), add it to every created issue in addition to the planning queue label.

**Example labels on a created issue when both are set:**
- `needs-refinement` (planning queue)
- `clancy` (Clancy label)
- `size:M` (size)
- `component:frontend` (component, if CLANCY_COMPONENT set)

### 14b. CLANCY_COMPONENT format for GitHub

GitHub labels are flat strings. The component convention is `component:{value}`.

**Example:** `CLANCY_COMPONENT=frontend` -> label `component:frontend`

When the planner and implementer later filter issues, they include `labels=component:frontend` in the API query to only see issues matching their component.

### 14c. Size labels

Size from decomposition table mapped to labels:
- `S` -> `size:S`
- `M` -> `size:M`
- `L` -> `size:L`
- `XS` -> `size:XS` (if used)

These are informational — no tooling filters on them.

### 14d. Label with special characters

GitHub label names can contain most characters including `:`. The `component:frontend` format works fine. No URL encoding needed in the POST body (it is JSON). When used as a query parameter for filtering, URL-encode: `labels=component%3Afrontend`.

### 14e. User has CLANCY_PLAN_LABEL set to a custom value

If `CLANCY_PLAN_LABEL=to-plan`, created tickets get `to-plan` instead of `needs-refinement`. The planner's fetch query uses the same env var, so the pipeline is consistent.

---

## 15. Edge Cases: Milestones

### 15a. Parent issue #50 has a milestone

**Behaviour:** The milestone on #50 is noted in the brief's research (existing context), but child issues are NOT automatically assigned to the same milestone. Milestone assignment is a release management concern — the user decides which milestone each child belongs to.

**Why not propagate?** A parent issue's milestone may represent the release target for the whole feature, but individual child tickets may ship in different milestones (e.g. foundation in v2.0, polish in v2.1).

### 15b. User wants to assign milestone to children

Not supported in v0.6.0. The user can bulk-assign milestones on GitHub after creation.

Future consideration: `--milestone` flag on `/clancy:approve-brief`.

### 15c. CLANCY_BRIEF_EPIC is set in .env to a milestone

This is a misconfiguration. `CLANCY_BRIEF_EPIC` expects an issue number, not a milestone. If the value does not resolve to a valid issue:
```
✗ Default epic "#milestone-name" is not a valid issue number. CLANCY_BRIEF_EPIC should be an issue number (e.g. #100).
```

---

## 16. Edge Cases: Batch Mode

### 16a. /clancy:brief 3 — batch briefing

**Does this make sense for GitHub?** Yes, but only for the board-sourced mode. Batch mode fetches N issues from the planning queue and briefs each one.

**How it works:**
1. Parse argument `3` as batch count.
2. Fetch 3 issues from the planning queue:
   ```
   GET /repos/{GITHUB_REPO}/issues?state=open&assignee={username}&labels={CLANCY_PLAN_LABEL}&per_page=3
   ```
   Filter out PRs.
3. For each issue, run the full brief workflow (research, generate, save, post comment).
4. Between each brief, no delay is needed (the research is the bottleneck, not API calls).

**Display:**
```
Clancy — Brief (batch: 3)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[#50] Redesign settings page
  Exploring codebase... (2 agents)
  ✅ Brief generated — 4 tickets

[#51] Add webhook support
  Exploring codebase... (3 agents)
  ✅ Brief generated — 6 tickets

[#52] Fix pagination bug
  ⏭ Already briefed (2026-03-10). Skipping.

Briefed 2 of 3 tickets. 1 skipped (already briefed).
```

**Edge case:** Batch count exceeds available issues. If only 1 issue is in the queue but user requested 3:
```
Requested 3, but only 1 issue in the planning queue.
```
Brief the 1 available issue.

### 16b. Batch cap

Max batch size: 10 (matching the design doc's max tickets per brief).

If user enters `/clancy:brief 15`:
```
Maximum batch size is 10. Briefing 10 tickets.
```

### 16c. Batch brief is NOT the same as batch approve

`/clancy:brief 3` briefs 3 separate issues. Each gets its own brief file. Each is approved individually via `/clancy:approve-brief`.

`/clancy:approve-brief` does NOT support batch mode — it approves one brief at a time to ensure the user reviews each one.

---

## 17. Edge Cases: Stale Brief Detection

### 17a. How the hook detects stale briefs

The `clancy-check-update.js` hook (runs on `SessionStart`) scans `.clancy/briefs/`:

1. List all `.md` files in `.clancy/briefs/`.
2. For each, check if a corresponding `.approved` marker exists.
3. If no marker: parse the date from the filename prefix (`YYYY-MM-DD-slug.md`).
4. If the date is > 7 days old: count as stale.

**Hook output (written to cache, displayed by CLAUDE.md):**
```
⚠ 2 unapproved brief(s) older than 7 days. Run /clancy:brief --list to review.
```

### 17b. --list flag

**What the user does:** `/clancy:brief --list`

**What the user sees:**
```
Clancy — Briefs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [1] redesign-settings-page  2026-03-14  Draft     4 tickets  Source: #50
  [2] add-dark-mode           2026-03-12  Draft     3 tickets  Source: inline   ⚠ 2 days old
  [3] auth-rework             2026-03-05  Approved  6 tickets  Source: file     ✅
  [4] fix-pagination          2026-03-01  Draft     2 tickets  Source: #48      ⚠ 13 days (stale)

2 unapproved drafts. 1 stale (>7 days).
```

### 17c. Brief filename does not follow date convention

If a brief file exists without the `YYYY-MM-DD-` prefix (e.g. user created it manually), the stale check uses the file's filesystem mtime instead. This is a fallback — all Clancy-generated briefs use the date prefix.

### 17d. Brief file is not valid markdown / missing sections

The `--list` flag does a best-effort parse. If the decomposition table cannot be found, show `? tickets` instead of a count. Do not error.

---

## 18. Issue Body Format

### Created child issue body

Each created child issue uses this markdown body format:

```markdown
## {Title}

{Description from decomposition table}

---

**Parent:** #{parent_number}
**Brief:** {slug}
**Size:** {S|M|L}

### Dependencies

{If dependencies exist:}
- Depends on #{dep_issue_number}
- Depends on #{dep_issue_number}

{If no dependencies:}
None

---

*Created by [Clancy](https://github.com/Pushedskydiver/clancy) from strategic brief.*
```

### Dependency cross-referencing

Dependencies in the decomposition table use local indices (`#1`, `#2`). These must be resolved to actual issue numbers as tickets are created:

**Order matters.** Tickets are created in table order. When ticket #3 depends on `#1`:
1. Ticket #1 was created as GitHub issue #51.
2. When creating ticket #3, resolve dependency `#1` -> `#51`.
3. Write `Depends on #51` in the body.

**Circular dependencies:** If the decomposition table has circular deps (A depends on B, B depends on A), create both issues but log a warning:
```
⚠ Circular dependency detected between tickets #2 and #3. Review manually.
```

### Parent cross-referencing

The `**Parent:** #50` line in each child issue body creates a GitHub cross-reference. When viewing issue #50, GitHub will show "mentioned in #51, #52, #53, #54" in the timeline. This is the primary mechanism for parent-child linking on GitHub.

### Why not use GitHub Projects or Tasklists?

GitHub Projects (v2) and Issue Tasklists are beta features with limited API support. The cross-reference approach works on all GitHub plans and requires no additional API calls beyond issue creation.

---

## 19. Summary Table

| Scenario | Outcome | Logged |
|----------|---------|--------|
| `/clancy:brief #50` — happy path | Brief generated, saved, posted as comment | `BRIEF \| slug \| N tickets` |
| `/clancy:brief "text"` — inline | Brief generated, saved locally only | `BRIEF \| slug \| N tickets` |
| `/clancy:brief --from file` | Brief generated from file, saved locally | `BRIEF \| slug \| N tickets` |
| `/clancy:brief` — interactive | Prompts for idea, then inline flow | `BRIEF \| slug \| N tickets` |
| `/clancy:brief #50` — already briefed, no feedback | Skip | Nothing |
| `/clancy:brief #50` — already briefed, has feedback | Revise brief | `BRIEF \| slug \| N tickets (revision)` |
| `/clancy:brief --fresh #50` | Fresh brief, ignore existing | `BRIEF \| slug \| N tickets` |
| `/clancy:brief #50` — issue is PR | Error, stop | Nothing |
| `/clancy:brief #50` — issue closed | Warn, ask to proceed | `BRIEF \| slug \| N tickets` if yes |
| `/clancy:brief #50` — 404 | Error, stop | Nothing |
| `/clancy:brief #50` — 401/403 | Error, stop | Nothing |
| `/clancy:brief #50` — no body | Brief from title only, warn | `BRIEF \| slug \| N tickets` |
| `/clancy:brief #50` — irrelevant | Skip with reason | `BRIEF \| slug \| SKIPPED` |
| `/clancy:brief 3` — batch | Brief up to 3 issues | One log per briefed issue |
| `/clancy:brief --list` | Display brief inventory | Nothing |
| `/clancy:approve-brief` — happy path | Create issues, link parent, mark approved | `APPROVE_BRIEF \| slug \| N tickets` |
| `/clancy:approve-brief` — no parent | Create standalone issues | `APPROVE_BRIEF \| slug \| N tickets` |
| `/clancy:approve-brief --epic #100` | Create issues under #100 | `APPROVE_BRIEF \| slug \| N tickets` |
| `/clancy:approve-brief` — already approved | Error, stop (idempotent) | Nothing |
| `/clancy:approve-brief` — partial failure | Partial creation, save progress, do not mark approved | Nothing (incomplete) |
| `/clancy:approve-brief` — resume after partial | Skip created, create remaining | `APPROVE_BRIEF \| slug \| N tickets` |
| `/clancy:approve-brief` — 422 bad label | Retry without label, warn | `APPROVE_BRIEF \| slug \| N tickets` |
| `/clancy:approve-brief` — parent closed | Warn, ask to proceed | `APPROVE_BRIEF \| slug \| N tickets` if yes |
| `/clancy:approve-brief` — race condition | O_EXCL marker prevents duplicates | Nothing for loser |
