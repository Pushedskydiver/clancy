# Clancy Approve Workflow

## Overview

Promote an approved Clancy plan from a ticket comment to the ticket description. The plan is appended below the existing description, never replacing it.

---

## Step 1 — Preflight checks

1. Check `.clancy/` exists and `.clancy/.env` is present. If not:
   ```
   .clancy/ not found. Run /clancy:init to set up Clancy first.
   ```
   Stop.

2. Source `.clancy/.env` and check board credentials are present.

---

## Step 2 — Parse argument

The user must provide a ticket key as an argument (e.g. `/clancy:approve PROJ-123`).

If no key is provided:
```
Usage: /clancy:approve PROJ-123
```
Stop.

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

### GitHub

First, determine the issue number from the ticket key (strip the `#` prefix if present):

```bash
RESPONSE=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/comments")
```

### Linear

```graphql
query {
  issue(id: "<issue-id>") {
    id identifier title description
    comments { nodes { body createdAt } }
  }
}
```

For Linear, the user provides the issue identifier (e.g. `ENG-42`). Look up the issue by identifier to get the internal ID and comments:

```graphql
query {
  issueSearch(query: "$IDENTIFIER", first: 1) {
    nodes {
      id identifier title description
      comments { nodes { body createdAt } }
    }
  }
}
```

Search the comments for the most recent one containing `## Clancy Implementation Plan`.

If no plan comment is found:
```
❌ No Clancy plan found for {KEY}. Run /clancy:plan first.
```
Stop.

---

## Step 4 — Confirm

Display a summary and ask for confirmation:

```
🚨 Clancy — Approve
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[{KEY}] {Title}
Size: {S/M/L} | {N} affected files
Planned: {date from plan}

Promote this plan to the ticket description? [Y/n]
```

If the user declines, stop:
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
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER")
```

Append the plan:
```bash
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
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

## Step 6 — Confirm and log

On success:
```
✅ Plan promoted to description for [{KEY}].

"Book 'em, Lou." — The ticket is ready for /clancy:once.
```

Append to `.clancy/progress.txt`:
```
YYYY-MM-DD HH:MM | {KEY} | APPROVE | —
```

On failure:
```
❌ Failed to update description for [{KEY}]. Check your board permissions.
```

---

## Notes

- This command only appends — it never overwrites the existing ticket description
- If the ticket has multiple plan comments, the most recent one is used
- The plan content is taken verbatim from the comment — no regeneration
- This is safe to run multiple times — each run appends, so running it twice would duplicate the plan. Warn the user if the description already contains `## Clancy Implementation Plan`
