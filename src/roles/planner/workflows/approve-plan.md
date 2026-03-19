# Clancy Approve Plan Workflow

## Overview

Promote an approved Clancy plan from a ticket comment to the ticket description. The plan is appended below the existing description, never replacing it. After promotion, the ticket is transitioned to the implementation queue.

---

## Step 1 — Preflight checks

1. Check `.clancy/` exists and `.clancy/.env` is present. If not:
   ```
   .clancy/ not found. Run /clancy:init to set up Clancy first.
   ```
   Stop.

2. Source `.clancy/.env` and check board credentials are present.

---

## Step 2 — Parse argument / Resolve ticket

### If no argument provided:

1. Scan `.clancy/progress.txt` for entries matching `| PLAN |` or `| REVISED |` that have no subsequent `| APPROVE_PLAN |` for the same key.
2. Sort by timestamp ascending (oldest first).
3. If 0 found:
   ```
   No planned tickets awaiting approval. Run /clancy:plan first.
   ```
   Stop.
4. If 1+ found, auto-select the oldest. Show:
   ```
   Auto-selected [{KEY}] {Title} (planned {date}). Promote this plan? [Y/n]
   ```
   To resolve the title, fetch the ticket from the board:
   - **GitHub:** `GET /repos/$GITHUB_REPO/issues/$ISSUE_NUMBER` → use `.title`
   - **Jira:** `GET $JIRA_BASE_URL/rest/api/3/issue/$KEY?fields=summary` → use `.fields.summary`
   - **Linear:** `issues(filter: { identifier: { eq: "$KEY" } }) { nodes { title } }` → use `nodes[0].title`
   If fetching fails, show the key without a title: `Auto-selected [{KEY}] (planned {date}). Promote? [Y/n]`
5. If user declines:
   ```
   Cancelled.
   ```
   Stop.
6. Note that the user has already confirmed — set a flag to skip the Step 4 confirmation.

### If argument provided:

Validate the key format per board (case-insensitive):
- **GitHub:** `#\d+` or bare number
- **Jira:** `[A-Za-z][A-Za-z0-9]+-\d+` (e.g. `PROJ-123` or `proj-123`)
- **Linear:** `[A-Za-z]{1,10}-\d+` (e.g. `ENG-42` or `eng-42`)

If invalid format:
```
Invalid ticket key: {input}. Expected format: {board-specific example}.
```
Stop.

Proceed with that key.

---

## Step 3 — Fetch the plan comment

Detect board from `.clancy/.env` and fetch comments for the specified ticket.

### Jira

```bash
RESPONSE=$(curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/comment")
```

Search for the most recent comment containing an ADF heading node with text `Clancy Implementation Plan`. **Capture the comment `id`** for later editing in Step 5b.

### GitHub

First, determine the issue number from the ticket key (strip the `#` prefix if present):

```bash
RESPONSE=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/comments?per_page=100")
```

Search for the most recent comment body containing `## Clancy Implementation Plan`. **Capture the comment `id`** for later editing in Step 5b.

### Linear

Use the filter-based query (preferred over `issueSearch`):

```graphql
query {
  issues(filter: { identifier: { eq: "$KEY" } }) {
    nodes {
      id identifier title description
      comments {
        nodes { id body createdAt user { id } }
      }
    }
  }
}
```

If the filter-based query returns no results, fall back to `issueSearch`:

```graphql
query {
  issueSearch(query: "$IDENTIFIER", first: 5) {
    nodes {
      id identifier title description
      comments { nodes { id body createdAt user { id } } }
    }
  }
}
```

**Important:** `issueSearch` is a fuzzy text search. After fetching results, verify the returned issue's `identifier` field exactly matches the provided key (case-insensitive). If no exact match is found in the results, report: `Issue {KEY} not found. Check the identifier and try again.`

Search the comments for the most recent one containing `## Clancy Implementation Plan`. **Capture the comment `id`** and the existing comment `body` for later editing in Step 5b. Also capture the issue's internal `id` (UUID) for transitions in Step 6.

If no plan comment is found:
```
No Clancy plan found for {KEY}. Run /clancy:plan first.
```
Stop.

---

## Step 3b — Check for existing plan in description

Before confirming, check if the ticket description already contains `## Clancy Implementation Plan`.

If it does:
```
This ticket's description already contains a Clancy plan.
Continuing will add a duplicate.

[1] Continue anyway
[2] Cancel
```

If the user picks [2], stop: `Cancelled. No changes made.`

---

## Step 4 — Confirm

**If the user already confirmed via auto-select in Step 2, SKIP this step entirely** (avoid double-confirmation).

**AFK mode:** If running in AFK mode (`--afk` flag or `CLANCY_MODE=afk`), skip the confirmation prompt and auto-confirm. Display the summary for logging purposes but proceed without waiting for input.

Display a summary and ask for confirmation:

```
Clancy — Approve Plan

[{KEY}] {Title}
Size: {S/M/L} | {N} affected files
Planned: {date from plan}

Promote this plan to the ticket description? [Y/n]
```

If the user declines (interactive only), stop:
```
Cancelled. No changes made.
```

---

## Step 5 — Update ticket description

Append the plan below the existing description with a separator. Never overwrite the original description.

The updated description follows this format:
```
{existing description}

---

{full plan content}
```

### Jira — PUT issue

Fetch the current description first:
```bash
CURRENT=$(curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY?fields=description")
```

Merge the existing ADF description with a `rule` node (horizontal rule) and the plan content as new ADF nodes. Then update:

```bash
curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -X PUT \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY" \
  -d '{"fields": {"description": <merged ADF>}}'
```

If ADF construction fails for the plan content, wrap the plan in a `codeBlock` node as fallback.

### GitHub — PATCH issue

Fetch the current body:
```bash
CURRENT=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER")
```

Append the plan:
```bash
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -X PATCH \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER" \
  -d '{"body": "<existing body>\n\n---\n\n<plan>"}'
```

### Linear — issueUpdate mutation

Fetch the current description:
```graphql
query { issue(id: "$ISSUE_ID") { description } }
```

Update with appended plan:
```graphql
mutation {
  issueUpdate(
    id: "$ISSUE_ID"
    input: { description: "<existing>\n\n---\n\n<plan>" }
  ) { success }
}
```

---

## Step 5b — Edit plan comment (approval note)

After updating the description, edit the original plan comment to prepend an approval note. This is **best-effort** — warn on failure, continue.

### GitHub

```bash
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  -X PATCH \
  "https://api.github.com/repos/$GITHUB_REPO/issues/comments/$COMMENT_ID" \
  -d '{"body": "> **Plan approved and promoted to description** -- {YYYY-MM-DD}\n\n{existing_comment_body}"}'
```

### Jira

```bash
curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -X PUT \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/comment/$COMMENT_ID" \
  -d '{
    "body": {
      "version": 1,
      "type": "doc",
      "content": [
        {"type": "paragraph", "content": [
          {"type": "text", "text": "Plan approved and promoted to description -- {YYYY-MM-DD}.",
           "marks": [{"type": "strong"}]}
        ]},
        <...existing ADF content nodes...>
      ]
    }
  }'
```

### Linear

```graphql
mutation {
  commentUpdate(
    id: "$COMMENT_ID"
    input: {
      body: "> **Plan approved and promoted to description** -- {YYYY-MM-DD}\n\n{existing_comment_body}"
    }
  ) { success }
}
```

On failure for any platform:
```
Could not update plan comment. The plan is still promoted to the description.
```

---

## Step 6 — Post-approval transition

Transition the ticket from the planning queue to the implementation queue. This is **best-effort** — warn on failure, continue.

### GitHub (always, not configurable)

1. **Remove planning label:**
   ```bash
   curl -s \
     -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     -H "X-GitHub-Api-Version: 2022-11-28" \
     -X DELETE \
     "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/labels/$CLANCY_PLAN_LABEL"
   ```
   `CLANCY_PLAN_LABEL` defaults to `needs-refinement`. URL-encode the label name. Ignore 404 (label not on issue). If `CLANCY_PLAN_LABEL` is not set, use the default `needs-refinement`.

2. **Add implementation label** (only if `CLANCY_LABEL` is set — skip if unset):
   ```bash
   curl -s \
     -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     -H "X-GitHub-Api-Version: 2022-11-28" \
     -H "Content-Type: application/json" \
     -X POST \
     "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/labels" \
     -d '{"labels": ["$CLANCY_LABEL"]}'
   ```
   If `CLANCY_LABEL` is not set, skip this step entirely (only the plan label removal is done). `CLANCY_LABEL` has no default — it is fully optional. When set (e.g. `clancy`), use its value. If the label does not exist on the repo, attempt to create it:
   ```bash
   curl -s \
     -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     -H "Content-Type: application/json" \
     -X POST \
     "https://api.github.com/repos/$GITHUB_REPO/labels" \
     -d '{"name": "$CLANCY_LABEL", "color": "0075ca"}'
   ```
   If 403 (no admin access) or 422 (invalid name): warn, continue without label.

### Jira (only if `CLANCY_STATUS_PLANNED` is set)

If `CLANCY_STATUS_PLANNED` is not set: skip transition, no warning needed.

If `CLANCY_STATUS_PLANNED` is set:

1. **Fetch transitions:**
   ```bash
   curl -s \
     -u "$JIRA_USER:$JIRA_API_TOKEN" \
     -H "Accept: application/json" \
     "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/transitions"
   ```

2. **Find matching transition:** Look for a transition where `.name` matches `CLANCY_STATUS_PLANNED` (case-insensitive). This matches the pattern used in the runtime Jira module.

3. **Execute transition:**
   ```bash
   curl -s \
     -u "$JIRA_USER:$JIRA_API_TOKEN" \
     -X POST \
     -H "Content-Type: application/json" \
     "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/transitions" \
     -d '{"transition": {"id": "$TRANSITION_ID"}}'
   ```

On failure:
```
Could not transition ticket. Move it manually to your implementation queue.
```

### Linear (always)

1. **Resolve "unstarted" state:**
   ```graphql
   query {
     workflowStates(filter: {
       team: { id: { eq: "$LINEAR_TEAM_ID" } }
       type: { eq: "unstarted" }
     }) {
       nodes { id name }
     }
   }
   ```
   Use `nodes[0].id` as the target state. If nodes is empty: warn `No 'unstarted' state found for team.` Skip transition.

2. **Transition:**
   ```graphql
   mutation {
     issueUpdate(
       id: "$ISSUE_UUID"
       input: { stateId: "$UNSTARTED_STATE_ID" }
     ) { success }
   }
   ```

On failure:
```
Could not transition ticket. Move it manually to your implementation queue.
```

---

## Step 7 — Confirm and log

On success, display a board-specific message:

**GitHub (with CLANCY_LABEL set):**
```
Plan promoted. Label swapped: {plan_label} → {impl_label}. Ready for /clancy:once.

"Book 'em, Lou." — The ticket is ready for /clancy:once.
```

**GitHub (without CLANCY_LABEL):**
```
Plan promoted. Label removed: {plan_label}. Add your implementation label manually, or run /clancy:once.

"Book 'em, Lou."
```

**Jira (with transition):**
```
Plan promoted. Ticket transitioned to {CLANCY_STATUS_PLANNED}.

"Book 'em, Lou." -- The ticket is ready for /clancy:once.
```

**Jira (no transition configured):**
```
Plan promoted. Move [{KEY}] to your implementation queue for /clancy:once.

"Book 'em, Lou." -- The ticket is ready for /clancy:once.
```

**Linear:**
```
Plan promoted. Moved to unstarted. Ready for /clancy:once.

"Book 'em, Lou." -- The ticket is ready for /clancy:once.
```

Append to `.clancy/progress.txt`:
```
YYYY-MM-DD HH:MM | {KEY} | APPROVE_PLAN | —
```

On failure:
```
Failed to update description for [{KEY}]. Check your board permissions.
```

---

## Notes

- This command only appends -- it never overwrites the existing ticket description
- If the ticket has multiple plan comments, the most recent one is used
- The plan content is taken verbatim from the comment -- no regeneration
- Step 3b checks for existing plans in the description to prevent accidental duplication
- The ticket key is case-insensitive -- accept `PROJ-123`, `proj-123`, or `#123` (GitHub)
- Step 5b edits the plan comment with an approval note -- this is best-effort and does not block the workflow
- Step 6 transitions the ticket to the implementation queue -- this is best-effort and board-specific
- The `## Clancy Implementation Plan` marker in comments is used by both `/clancy:plan` (to detect existing plans) and `/clancy:approve-plan` (to find the plan to promote)
