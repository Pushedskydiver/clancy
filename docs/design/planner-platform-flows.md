# Planner Role — Platform-Specific Flows (GitHub, Jira, Linear)

Complete API reference for every planner operation across all three platforms. This is an implementation reference — not user docs.

---

## Table of Contents

1. [GitHub Issues — Complete Flow](#1-github-issues)
2. [Jira Cloud — Complete Flow](#2-jira-cloud)
3. [Linear — Complete Flow](#3-linear)
4. [Plan Comment Format Per Platform](#4-plan-comment-format-per-platform)
5. [Skip Comment Format Per Platform](#5-skip-comment-format-per-platform)
6. [Approval Note Format Per Platform](#6-approval-note-format-per-platform)
7. [Cross-Platform Edge Cases](#7-cross-platform-edge-cases)

---

## 1. GitHub Issues

### 1.1 Constraints

- No native status columns — labels serve as queue identifiers
- Issues and PRs share the same number space (filter PRs out)
- Comments are Markdown (no conversion needed)
- `@me` does not work with fine-grained PATs — must resolve username via `GET /user`
- Label operations require push access; label creation requires admin access
- No native transitions — use label add/remove as proxy

### 1.2 API Reference

#### Resolve Username

```
GET https://api.github.com/user
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28

Response: { "login": "username" }

Cache per process. Used in assignee filter.
```

#### Fetch Planning Queue

```
GET https://api.github.com/repos/$GITHUB_REPO/issues
  ?state=open
  &assignee=$GITHUB_USERNAME
  &labels=$CLANCY_PLAN_LABEL
  &per_page=$N
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28

CLANCY_PLAN_LABEL default: "needs-refinement"

Response: [
  {
    "number": 42,
    "title": "Add dark mode",
    "body": "...",           // markdown or null
    "state": "open",
    "labels": [{"name": "needs-refinement"}],
    "pull_request": null,    // null = issue, non-null = PR
    "created_at": "...",
    "updated_at": "..."
  }
]

Post-processing:
  1. Filter out entries where pull_request != null
  2. For each remaining issue, fetch comments separately
```

#### Fetch Specific Issue

```
GET https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28

Response: Same shape as above (single object, not array)

Checks:
  - pull_request != null -> "#{N} is a PR, not an issue." (stop)
  - state == "closed" -> Warn: "Issue is closed. Plan anyway? [y/N]"
  - body == null -> Continue (title-only ticket)
```

#### Fetch Comments

```
GET https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/comments
  ?per_page=100
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28

Response: [
  {
    "id": 123456,
    "body": "## Clancy Implementation Plan\n...",
    "user": {"login": "clancy-bot"},
    "created_at": "2026-03-14T10:00:00Z"
  }
]

Search for: body containing "## Clancy Implementation Plan"
Most recent match = the plan comment.

Feedback detection:
  Collect all comments where:
    created_at > plan_comment.created_at
    AND user.login != $GITHUB_USERNAME (exclude bot's own)
```

#### Post Plan Comment

```
POST https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/comments
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

Body: {"body": "<markdown plan>"}

Response (201): {"id": 789012, "body": "..."}

Errors:
  401 -> auth failure
  403 -> no write access (check token scopes)
  404 -> issue was closed/deleted during planning
  422 -> body too large (unlikely for plan comments)
  5xx -> server error
```

#### Edit Plan Comment (approval note)

```
PATCH https://api.github.com/repos/$GITHUB_REPO/issues/comments/$COMMENT_ID
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

Body: {"body": "✅ Plan approved and promoted to description on {date}.\n\n{existing body}"}

Response (200): updated comment object

Best-effort: warn on failure, continue.
```

#### Post Skip Comment

```
POST https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/comments
Authorization: Bearer $GITHUB_TOKEN
Content-Type: application/json

Body: {"body": "Clancy skipped this ticket: {reason}\n\n..."}

Same endpoint as plan comment. Best-effort: warn on failure, continue.

Gated by CLANCY_SKIP_COMMENTS (default: true).
```

#### Update Issue Description (approve)

```
PATCH https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

Body: {"body": "{existing body}\n\n---\n\n{plan content}"}

Response (200): updated issue object

Errors:
  401 -> auth expired
  403 -> no write access
  404 -> issue deleted
  422 -> body too large
```

#### Remove Plan Label (post-approval)

```
DELETE https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/labels/$LABEL_NAME
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json

LABEL_NAME = URL-encoded CLANCY_PLAN_LABEL (default: "needs-refinement")

Response (200): remaining labels array
Response (404): label not on issue -> ignore (OK)

Best-effort: warn on other errors, continue.
```

#### Add Implementation Label (post-approval)

```
POST https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/labels
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json
Content-Type: application/json

Body: {"labels": ["$CLANCY_LABEL"]}

CLANCY_LABEL default: "clancy"

Response (200): labels array

If label doesn't exist on repo:
  POST https://api.github.com/repos/$GITHUB_REPO/labels
  Body: {"name": "$CLANCY_LABEL", "color": "0075ca"}

  If 403 (no admin access): warn, continue without label
  If 422 (invalid name): warn, continue without label
```

### 1.3 Edge Cases

| Scenario | Behaviour |
|---|---|
| Issue has no body (null) | Plan from title only. Note in plan: "Ticket has no description." |
| Issue is a PR | Stop: "#{N} is a PR, not an issue." |
| Issue is closed | Warn: "Issue is closed. Plan anyway? [y/N]" |
| Plan label doesn't exist | No issues returned. Guidance message mentions creating the label. |
| Implementation label doesn't exist | Attempt to create it. If no admin access, warn. |
| Comment > 65KB | Extremely unlikely for plans. If 422: truncate Risks section, retry. |
| Bare integer ambiguity | Board = GitHub + input = "3": ask "Issue #3 or batch 3?" |
| Multiple plan comments | Use most recent (by created_at) |
| Plan comment deleted, re-run approve | "No Clancy plan found." (stop) |
| User edits plan comment manually | /clancy:approve-plan uses current state (edited version) |
| Rate limit (403 + X-RateLimit-Remaining: 0) | Wait until X-RateLimit-Reset, retry once |

---

## 2. Jira Cloud

### 2.1 Constraints

- Uses REST API v3 (not v2)
- `POST /rest/api/3/search/jql` is the new endpoint (old `GET /search` removed Aug 2025)
- Comments and descriptions use ADF (Atlassian Document Format), not Markdown
- Status transitions require knowing the transition ID (project-specific)
- `CLANCY_STATUS_PLANNED` is optional — if not set, no auto-transition on approval
- `currentUser()` in JQL resolves from Basic auth credentials
- Epic link field varies: next-gen projects use `parent`, classic use `customfield_10014`

### 2.2 API Reference

#### Fetch Planning Queue

```
POST $JIRA_BASE_URL/rest/api/3/search/jql
Authorization: Basic base64($JIRA_USER:$JIRA_API_TOKEN)
Content-Type: application/json
Accept: application/json

Body: {
  "jql": "project=$JIRA_PROJECT_KEY AND assignee=currentUser() AND status=\"$CLANCY_PLAN_STATUS\" [AND sprint in openSprints()] [AND labels = \"$CLANCY_LABEL\"] ORDER BY priority ASC",
  "maxResults": $N,
  "fields": [
    "summary",
    "description",
    "issuelinks",
    "parent",
    "customfield_10014",
    "comment"
  ]
}

CLANCY_PLAN_STATUS default: "Backlog"
Sprint clause: only if CLANCY_JQL_SPRINT is set
Label clause: only if CLANCY_LABEL is set

Response: {
  "issues": [
    {
      "key": "PROJ-123",
      "fields": {
        "summary": "Add dark mode",
        "description": { ADF },
        "issuelinks": [...],
        "parent": {"key": "PROJ-100", "fields": {"summary": "Epic"}},
        "customfield_10014": "PROJ-100",
        "comment": {
          "comments": [
            {"id": "10001", "body": { ADF }, "created": "..."}
          ]
        }
      }
    }
  ]
}

Key: comments are included in the fetch (no separate call needed).
```

#### Fetch Specific Ticket

```
GET $JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY?fields=summary,description,issuelinks,parent,customfield_10014,comment,status,issuetype
Authorization: Basic base64($JIRA_USER:$JIRA_API_TOKEN)
Accept: application/json

Additional checks:
  - fields.issuetype.name == "Epic" -> Note: "This is an epic."
  - fields.status.statusCategory.key == "done" -> Warn (ask [y/N])
  - fields.status.statusCategory.key == "indeterminate" -> Note: "In Progress"

Response: same as queue fetch but single issue
```

#### Fetch Comments (for approve)

```
GET $JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/comment
Authorization: Basic base64($JIRA_USER:$JIRA_API_TOKEN)
Accept: application/json

Response: {
  "comments": [
    {
      "id": "10001",
      "body": { ADF },
      "created": "2026-03-14T10:00:00.000+0000",
      "author": {"accountId": "..."}
    }
  ]
}

Search for: ADF body containing heading node with text
"Clancy Implementation Plan" (level 2).

Walk ADF: doc.content -> find node where
  type == "heading" AND attrs.level == 2
  AND content[0].text contains "Clancy Implementation Plan"

Feedback detection:
  Collect all comments where:
    created > plan_comment.created
    AND author.accountId != plan_comment.author.accountId
```

#### Post Plan Comment

```
POST $JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/comment
Authorization: Basic base64($JIRA_USER:$JIRA_API_TOKEN)
Content-Type: application/json
Accept: application/json

Body: {
  "body": {
    "version": 1,
    "type": "doc",
    "content": [
      <ADF nodes for the plan>
    ]
  }
}

ADF Mappings:
  ## Heading        -> {"type": "heading", "attrs": {"level": 2},
                        "content": [{"type": "text", "text": "..."}]}

  ### Heading       -> {"type": "heading", "attrs": {"level": 3},
                        "content": [{"type": "text", "text": "..."}]}

  **bold**          -> {"type": "text", "text": "...",
                        "marks": [{"type": "strong"}]}

  `code`            -> {"type": "text", "text": "...",
                        "marks": [{"type": "code"}]}

  - bullet          -> {"type": "bulletList", "content": [
                          {"type": "listItem", "content": [
                            {"type": "paragraph", "content": [
                              {"type": "text", "text": "..."}
                            ]}
                          ]}
                        ]}

  - [ ] checkbox    -> {"type": "taskList", "content": [
                          {"type": "taskItem",
                           "attrs": {"state": "TODO"},
                           "content": [
                            {"type": "text", "text": "..."}
                          ]}
                        ]}

  | table |         -> {"type": "table", "content": [
                          {"type": "tableRow", "content": [
                            {"type": "tableCell", "content": [
                              {"type": "paragraph", "content": [
                                {"type": "text", "text": "..."}
                              ]}
                            ]}
                          ]}
                        ]}

  ---               -> {"type": "rule"}

  Fallback: wrap complex sections in:
                    -> {"type": "codeBlock", "content": [
                         {"type": "text", "text": "..."}
                       ]}

Response (201): {"id": "10002", ...}

Errors:
  401 -> auth failure
  403 -> no comment permission
  404 -> ticket deleted
  400 -> invalid ADF (retry with codeBlock fallback)
  5xx -> server error
```

#### Edit Plan Comment (approval note)

```
PUT $JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/comment/$COMMENT_ID
Authorization: Basic base64($JIRA_USER:$JIRA_API_TOKEN)
Content-Type: application/json
Accept: application/json

Body: {
  "body": {
    "version": 1,
    "type": "doc",
    "content": [
      {"type": "paragraph", "content": [
        {"type": "text", "text": "✅ Plan approved and promoted to description on {date}.",
         "marks": [{"type": "strong"}]}
      ]},
      <...existing ADF content nodes...>
    ]
  }
}

Best-effort: warn on failure, continue.
```

#### Post Skip Comment

```
POST $JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/comment
Authorization: Basic base64($JIRA_USER:$JIRA_API_TOKEN)
Content-Type: application/json

Body: {
  "body": {
    "version": 1,
    "type": "doc",
    "content": [
      {"type": "paragraph", "content": [
        {"type": "text", "text": "Clancy skipped this ticket: {reason}",
         "marks": [{"type": "strong"}]}
      ]},
      {"type": "paragraph", "content": [
        {"type": "text", "text": "This ticket appears to require work outside the codebase..."}
      ]}
    ]
  }
}

Gated by CLANCY_SKIP_COMMENTS (default: true). Best-effort.
```

#### Fetch Current Description (for approve)

```
GET $JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY?fields=description
Authorization: Basic base64($JIRA_USER:$JIRA_API_TOKEN)
Accept: application/json

Response: {
  "fields": {
    "description": { ADF }  // or null
  }
}

If description is null: plan becomes the entire description (no separator).
```

#### Update Description (approve)

```
PUT $JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY
Authorization: Basic base64($JIRA_USER:$JIRA_API_TOKEN)
Content-Type: application/json
Accept: application/json

Body: {
  "fields": {
    "description": {
      "version": 1,
      "type": "doc",
      "content": [
        <...existing ADF content nodes...>,
        {"type": "rule"},
        <...plan ADF content nodes...>
      ]
    }
  }
}

Merge strategy:
  1. Take existing description.content array
  2. Append a "rule" node (horizontal rule)
  3. Append plan ADF nodes

If existing description is null:
  Use plan ADF nodes only (no rule prefix)

If ADF construction fails for plan:
  Wrap entire plan markdown in codeBlock node

Response (204): no content (success)

Errors:
  400 -> "Invalid ADF" -> retry with codeBlock fallback
  401 -> auth expired
  403 -> no edit permission
  404 -> ticket deleted
```

#### Fetch Transitions (post-approval)

```
GET $JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/transitions
Authorization: Basic base64($JIRA_USER:$JIRA_API_TOKEN)
Accept: application/json

Response: {
  "transitions": [
    {"id": "21", "name": "To Do", "to": {"name": "To Do"}},
    {"id": "31", "name": "In Progress", "to": {"name": "In Progress"}}
  ]
}

Find transition where:
  .to.name == CLANCY_STATUS_PLANNED (case-insensitive match)
  OR .name == CLANCY_STATUS_PLANNED

If not found: warn "Status '{name}' not found in available transitions."
```

#### Execute Transition (post-approval)

```
POST $JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/transitions
Authorization: Basic base64($JIRA_USER:$JIRA_API_TOKEN)
Content-Type: application/json

Body: {"transition": {"id": "$TRANSITION_ID"}}

Response (204): success

Only executed if CLANCY_STATUS_PLANNED is set.
If not set: skip transition, tell user to move manually.

Errors:
  400 -> "Transition not available" (workflow constraint)
  Other -> warn, continue (best-effort)
```

### 2.3 Edge Cases

| Scenario | Behaviour |
|---|---|
| Description is null (no description) | Plan becomes the full description (no rule separator) |
| Description ADF is malformed | Log warning, attempt codeBlock fallback |
| Ticket is an Epic | Note: "Planning an epic." Proceed normally. |
| Ticket status is Done | Warn: "Ticket is done. Plan anyway? [y/N]" |
| CLANCY_PLAN_STATUS value doesn't match any Jira status | No results returned. Guidance: "Check CLANCY_PLAN_STATUS matches a status in your project." |
| CLANCY_STATUS_PLANNED not set | No transition on approval. Tell user to move manually. |
| CLANCY_STATUS_PLANNED matches no transition | Warn: "Status not found." Skip transition. |
| ADF comment body > 32KB | Extremely unlikely. If 400: wrap plan in single codeBlock, retry. |
| Project uses next-gen (parent field) | Works normally — parent info read from fields.parent |
| Project uses classic (customfield_10014) | Works normally — parent info read from customfield_10014 |
| Both parent and customfield_10014 present | Read from parent first, fallback to customfield_10014 |
| Comment author check for feedback | Exclude comments by same accountId as plan comment author |
| Multiple plan comments | Use most recent (by created timestamp) |

---

## 3. Linear

### 3.1 Constraints

- Personal API keys do NOT use "Bearer" prefix (OAuth tokens do)
- All queries are GraphQL via `POST https://api.linear.app/graphql`
- State type is an enum: `backlog`, `unstarted`, `started`, `completed`, `cancelled`, `triage`
- `issueSearch` is fuzzy text search — always verify `identifier` field after fetch
- No label filter in planning queue (unlike Jira/GitHub)
- Comments are fetched inline with GraphQL queries (no separate call)
- Issue identifier format: `[A-Z]{1,10}-\d+` (e.g. ENG-42)

### 3.2 API Reference

#### Fetch Planning Queue

```
POST https://api.linear.app/graphql
Authorization: $LINEAR_API_KEY
Content-Type: application/json

Body: {
  "query": "query { viewer { assignedIssues(filter: { state: { type: { eq: \"$CLANCY_PLAN_STATE_TYPE\" } } team: { id: { eq: \"$LINEAR_TEAM_ID\" } } } first: $N orderBy: priority) { nodes { id identifier title description parent { identifier title } comments { nodes { id body createdAt user { id } } } } } } }"
}

CLANCY_PLAN_STATE_TYPE default: "backlog"

Response: {
  "data": {
    "viewer": {
      "assignedIssues": {
        "nodes": [
          {
            "id": "uuid-1",
            "identifier": "ENG-42",
            "title": "Add dark mode",
            "description": "...",
            "parent": {"identifier": "ENG-10", "title": "UI Epic"},
            "comments": {
              "nodes": [
                {"id": "comment-uuid", "body": "## Clancy...", "createdAt": "...", "user": {"id": "..."}}
              ]
            }
          }
        ]
      }
    }
  }
}

Comments are inline — no separate fetch needed.
No label filter available.
```

#### Fetch Specific Issue

```
POST https://api.linear.app/graphql
Authorization: $LINEAR_API_KEY
Content-Type: application/json

Body: {
  "query": "query { issues(filter: { identifier: { eq: \"$IDENTIFIER\" } }) { nodes { id identifier title description state { type name } parent { identifier title } comments { nodes { id body createdAt user { id } } } } } }"
}

Response: {
  "data": {
    "issues": {
      "nodes": [
        {
          "id": "uuid",
          "identifier": "ENG-42",
          "title": "...",
          "state": {"type": "backlog", "name": "Backlog"},
          ...
        }
      ]
    }
  }
}

Checks:
  - nodes empty -> "Issue {KEY} not found on Linear." (stop)
  - state.type == "completed" -> Warn: "Issue is completed. Plan anyway? [y/N]"
  - state.type == "canceled" -> Warn: "Issue is cancelled. Plan anyway? [y/N]"
  - parent != null -> Note only (informational)
```

#### Fetch Issue by Search (for approve, backward compat)

```
POST https://api.linear.app/graphql
Authorization: $LINEAR_API_KEY
Content-Type: application/json

Body: {
  "query": "query { issueSearch(query: \"$IDENTIFIER\", first: 5) { nodes { id identifier title description comments { nodes { id body createdAt user { id } } } } } }"
}

IMPORTANT: issueSearch is fuzzy text search.
After receiving results, MUST verify:
  node.identifier.toLowerCase() === provided_key.toLowerCase()

If no exact match in results:
  "Issue {KEY} not found. Check the identifier and try again." (stop)

Preferred: Use the filter-based query (issues with identifier eq filter)
when fetching by known key. Use issueSearch only as fallback.
```

#### Post Plan Comment

```
POST https://api.linear.app/graphql
Authorization: $LINEAR_API_KEY
Content-Type: application/json

Body: {
  "query": "mutation { commentCreate(input: { issueId: \"$ISSUE_UUID\", body: \"$ESCAPED_MARKDOWN\" }) { success comment { id } } }"
}

Linear accepts Markdown directly — no conversion needed.
Escape double quotes and newlines in the body string.

Response: {
  "data": {
    "commentCreate": {
      "success": true,
      "comment": {"id": "comment-uuid"}
    }
  }
}

Errors:
  success: false -> "Comment creation failed"
  errors array -> parse and display
  401 -> "Check LINEAR_API_KEY. No Bearer prefix for personal keys!"
  Network error -> "Cannot reach Linear API"
```

#### Edit Plan Comment (approval note)

```
POST https://api.linear.app/graphql
Authorization: $LINEAR_API_KEY
Content-Type: application/json

Body: {
  "query": "mutation { commentUpdate(id: \"$COMMENT_UUID\", input: { body: \"✅ Plan approved and promoted to description on {date}.\\n\\n$EXISTING_BODY\" }) { success } }"
}

Best-effort: warn on failure, continue.
```

#### Post Skip Comment

```
POST https://api.linear.app/graphql
Authorization: $LINEAR_API_KEY
Content-Type: application/json

Body: {
  "query": "mutation { commentCreate(input: { issueId: \"$ISSUE_UUID\", body: \"Clancy skipped this ticket: {reason}\\n\\n...\" }) { success } }"
}

Gated by CLANCY_SKIP_COMMENTS (default: true). Best-effort.
```

#### Fetch Current Description (for approve)

```
POST https://api.linear.app/graphql
Authorization: $LINEAR_API_KEY
Content-Type: application/json

Body: {
  "query": "query { issue(id: \"$ISSUE_UUID\") { description } }"
}

Response: {
  "data": {
    "issue": {
      "description": "existing markdown"  // or null
    }
  }
}
```

#### Update Description (approve)

```
POST https://api.linear.app/graphql
Authorization: $LINEAR_API_KEY
Content-Type: application/json

Body: {
  "query": "mutation { issueUpdate(id: \"$ISSUE_UUID\", input: { description: \"$ESCAPED_MERGED_DESCRIPTION\" }) { success } }"
}

Merge: "{existing}\n\n---\n\n{plan}"
If existing is null: use plan directly.

Escape double quotes and newlines.

Response: {"data": {"issueUpdate": {"success": true}}}

Errors:
  success: false -> "Description update failed"
  errors -> parse and display
```

#### Resolve "unstarted" State UUID (post-approval)

```
POST https://api.linear.app/graphql
Authorization: $LINEAR_API_KEY
Content-Type: application/json

Body: {
  "query": "query { workflowStates(filter: { team: { id: { eq: \"$LINEAR_TEAM_ID\" } } type: { eq: \"unstarted\" } }) { nodes { id name } } }"
}

Response: {
  "data": {
    "workflowStates": {
      "nodes": [
        {"id": "state-uuid", "name": "Todo"}
      ]
    }
  }
}

Use nodes[0].id as the target stateId.
If nodes empty: warn "No 'unstarted' state found for team." Skip transition.
```

#### Transition to Unstarted (post-approval)

```
POST https://api.linear.app/graphql
Authorization: $LINEAR_API_KEY
Content-Type: application/json

Body: {
  "query": "mutation { issueUpdate(id: \"$ISSUE_UUID\", input: { stateId: \"$STATE_UUID\" }) { success } }"
}

Always executed on approval (not configurable like Jira).
Moves ticket from "backlog" state type to "unstarted" state type.

On failure: warn, continue (best-effort).
```

### 3.3 Edge Cases

| Scenario | Behaviour |
|---|---|
| CLANCY_PLAN_STATE_TYPE is invalid enum value | API returns empty nodes. Guidance: "Check CLANCY_PLAN_STATE_TYPE is a valid Linear state type (backlog, unstarted, started, completed, cancelled, triage)." |
| issueSearch returns no exact match | "Issue {KEY} not found." (stop) |
| issueSearch returns multiple exact matches | Use first match (should be unique by identifier) |
| No "unstarted" state type in team workflow | Warn, skip transition. "No 'unstarted' state found." |
| Multiple "unstarted" states (custom workflow) | Use first match (nodes[0]) |
| Description is null | Plan becomes entire description (no separator) |
| Comment body exceeds limit | No documented limit. Unlikely to hit. |
| Feedback detection | Collect all comments with createdAt > plan comment createdAt. All considered feedback (no author filter — Linear personal keys don't expose viewer ID easily in comment context). |
| Parent exists | Informational note only. Does not affect planning. |
| Cross-team issue | Possible but unlikely (filter by team ID). If it appears, plan normally. |
| Personal API key with "Bearer" prefix | Auth failure (401). Guidance: "LINEAR_API_KEY should NOT have Bearer prefix for personal API keys." |
| OAuth token without "Bearer" prefix | Auth failure. But this is the less common case. |

---

## 4. Plan Comment Format Per Platform

### GitHub (Markdown)

```markdown
## Clancy Implementation Plan

**Ticket:** [#42] Add dark mode
**Planned:** 2026-03-15

### Summary
...

### Affected Files
| File | Change |
|------|--------|
| `src/theme.ts` | Add dark color tokens |

### Implementation Approach
...

### Test Strategy
- [ ] Unit tests for theme toggle
- [ ] Visual regression test

### Acceptance Criteria
- [ ] Dark mode toggle in settings
- [ ] System preference detection

### Dependencies
None

### Figma Link
None

### Risks / Considerations
- Existing CSS custom properties may conflict

### Size Estimate
**M** — Moderate: multiple files, theme system changes

---
*Generated by [Clancy](https://github.com/Pushedskydiver/clancy).
To request changes: comment on this ticket, then re-run `/clancy:plan #42` to revise.
To approve: run `/clancy:approve-plan #42` to promote this plan to the ticket description.*
```

### Jira (ADF)

The same plan content, but every element is converted to ADF nodes:

```json
{
  "body": {
    "version": 1,
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "Clancy Implementation Plan"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Ticket: ", "marks": [{"type": "strong"}]},
          {"type": "text", "text": "[PROJ-123] Add dark mode"}
        ]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Planned: ", "marks": [{"type": "strong"}]},
          {"type": "text", "text": "2026-03-15"}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "Summary"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "..."}]
      }
    ]
  }
}
```

Table nodes (Affected Files):

```json
{
  "type": "table",
  "content": [
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableHeader",
          "content": [{"type": "paragraph", "content": [{"type": "text", "text": "File"}]}]
        },
        {
          "type": "tableHeader",
          "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Change"}]}]
        }
      ]
    },
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableCell",
          "content": [{"type": "paragraph", "content": [{"type": "text", "text": "src/theme.ts", "marks": [{"type": "code"}]}]}]
        },
        {
          "type": "tableCell",
          "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Add dark color tokens"}]}]
        }
      ]
    }
  ]
}
```

Checkbox items (Acceptance Criteria, Test Strategy):

```json
{
  "type": "taskList",
  "content": [
    {
      "type": "taskItem",
      "attrs": {"state": "TODO"},
      "content": [{"type": "text", "text": "Dark mode toggle in settings"}]
    }
  ]
}
```

Fallback: if any section's ADF construction fails, wrap that section in a codeBlock:

```json
{
  "type": "codeBlock",
  "content": [{"type": "text", "text": "| File | Change |\n|------|--------|\n| ..."}]
}
```

### Linear (Markdown)

Identical to GitHub format. Linear accepts Markdown natively.

---

## 5. Skip Comment Format Per Platform

### GitHub / Linear (Markdown)

```markdown
Clancy skipped this ticket: {reason}

This ticket appears to require work outside the codebase (e.g. {specific signal}).
If this is incorrect, add more context to the ticket description and re-run `/clancy:plan`.
```

### Jira (ADF)

```json
{
  "body": {
    "version": 1,
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Clancy skipped this ticket: {reason}", "marks": [{"type": "strong"}]}
        ]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "This ticket appears to require work outside the codebase (e.g. {specific signal}). If this is incorrect, add more context to the ticket description and re-run "},
          {"type": "text", "text": "/clancy:plan", "marks": [{"type": "code"}]},
          {"type": "text", "text": "."}
        ]
      }
    ]
  }
}
```

---

## 6. Approval Note Format Per Platform

### GitHub / Linear (Markdown)

Prepended to existing comment body:

```markdown
✅ Plan approved and promoted to description on 2026-03-15.

{existing plan comment body unchanged}
```

### Jira (ADF)

Prepend a paragraph node before existing ADF content:

```json
{
  "type": "paragraph",
  "content": [
    {
      "type": "text",
      "text": "✅ Plan approved and promoted to description on 2026-03-15.",
      "marks": [{"type": "strong"}]
    }
  ]
}
```

Inserted as the first element of the comment's `doc.content` array, followed by the existing content.

---

## 7. Cross-Platform Edge Cases

### Race Conditions

| Scenario | Behaviour |
|---|---|
| Two /clancy:plan sessions target the same ticket | Both post plan comments. /clancy:approve-plan uses the most recent. No data loss. |
| /clancy:plan and manual comment posted simultaneously | Feedback detection uses timestamps. The manual comment will be picked up on next re-plan. |
| /clancy:approve-plan run twice for same ticket | Step 3b detects existing plan in description. Warns about duplicate. User can cancel. |
| Ticket deleted during planning | Comment post fails with 404. Plan printed to stdout. |
| Ticket transitioned by someone else during approve | Description update may still succeed (status and description are independent). Transition may fail if workflow prevents it. Best-effort. |

### Encoding and Escaping

| Platform | Concern | Handling |
|---|---|---|
| GitHub | JSON string escaping in body | Escape `"`, `\n`, `\t` in JSON payload |
| Jira | ADF JSON structure | Must be valid ADF — invalid nodes cause 400. Fallback to codeBlock. |
| Linear | GraphQL string escaping | Escape `"`, `\n`, `\\` in mutation input. Double-escape for nested GraphQL strings. |
| All | Unicode in ticket titles | Pass through — all platforms support UTF-8 |
| All | Very long ticket descriptions | Append may create large payloads. GitHub: ~65KB limit. Jira: ~32KB ADF. Linear: no documented limit. |

### Idempotency

| Operation | Idempotent? | Notes |
|---|---|---|
| Fetch queue | Yes | Read-only |
| Post plan comment | No | Creates duplicate comment on re-run. But auto-detect prevents this. |
| Edit plan comment | Yes | Same content written each time |
| Update description | No | Would append plan again. Step 3b warns about duplicate. |
| Remove label (GitHub) | Yes | 404 on missing label is ignored |
| Add label (GitHub) | Yes | Adding existing label is a no-op |
| Transition (Jira) | No | May fail if already transitioned. Best-effort. |
| State change (Linear) | Yes | Setting same state is a no-op |
| Post skip comment | No | Creates duplicate on re-run. But skip + log prevents re-run on same ticket. |
