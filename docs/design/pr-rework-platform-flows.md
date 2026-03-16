# PR-Based Flow & QA Rework Loop -- Platform-Specific Flows

Detailed API calls, response shapes, error codes, edge cases, and post-rework actions for each platform: GitHub, GitLab, Bitbucket Cloud, and Bitbucket Server.

---

## Table of Contents

1. [GitHub](#github)
2. [GitLab](#gitlab)
3. [Bitbucket Cloud](#bitbucket-cloud)
4. [Bitbucket Server](#bitbucket-server)
5. [Cross-Platform Edge Cases](#cross-platform-edge-cases)

---

## GitHub

### Authentication

```
Header: Authorization: Bearer {GITHUB_TOKEN}
Scope:  repo (full control of private repositories)
        public_repo (sufficient for public repos)

Token sources:
  GitHub board: GITHUB_TOKEN (always present, required for issues)
  Jira/Linear board: GITHUB_TOKEN (optional, for PR creation)

resolveGitToken() returns: { token: GITHUB_TOKEN }
```

### PR Creation

```
Endpoint:  POST {apiBase}/repos/{owner}/{repo}/pulls
Headers:   Authorization: Bearer {token}
           Content-Type: application/json
           Accept: application/vnd.github+json
           User-Agent: clancy

Body:
{
  "title": "feat(PROJ-123): Add login page",
  "head": "feature/proj-123",
  "base": "main",
  "body": "Closes #42\n\n## Description\n\n..."
}

Success response (HTTP 201):
{
  "html_url": "https://github.com/owner/repo/pull/99",
  "number": 99,
  ...
}
Extracted: { url: html_url, number: number }

Already-exists (HTTP 422):
{
  "message": "Validation Failed",
  "errors": [{"message": "A pull request already exists for owner:feature/proj-123."}]
}
Detection: status === 422 && body includes "already exists"

Auth failure (HTTP 401):
{
  "message": "Bad credentials"
}

Not found (HTTP 404):
{
  "message": "Not Found"
}
Cause: repo doesn't exist, or token lacks access.

Rate limit (HTTP 403):
{
  "message": "API rate limit exceeded"
}
Headers: X-RateLimit-Remaining: 0

Network timeout (30s):
AbortController triggers AbortError.
postPullRequest catches and returns error string.
```

### Review State Checking

```
Step 1: Find open PR for branch
──────────────────────────────────────────
Endpoint:  GET {apiBase}/repos/{repo}/pulls
           ?head={owner}:{branch}&state=open
Headers:   Authorization: Bearer {token}
           Accept: application/vnd.github+json

Response schema (githubPrListSchema):
[
  {
    "number": 99,
    "html_url": "https://github.com/owner/repo/pull/99",
    "head": { "ref": "feature/proj-123" },
    "base": { "ref": "main" }
  }
]

No open PR: empty array -> return undefined
Multiple PRs: uses first (prs[0])
API error: return undefined


Step 2: Fetch inline comments (PR review comments)
──────────────────────────────────────────
Endpoint:  GET {apiBase}/repos/{repo}/pulls/{number}/comments
           ?per_page=100&since={iso}
Headers:   Same as above

Response schema (githubPrCommentsSchema):
[
  {
    "body": "This needs error handling",
    "path": "src/api.ts",
    "line": 42,
    "user": { "login": "reviewer" }
  }
]

since parameter: server-side filter. Only comments created
  after the ISO 8601 timestamp are returned. Both inline
  and conversation endpoints support this.

Note: per_page=100. No pagination. PRs with >100 inline
  comments will have older comments silently dropped.


Step 3: Fetch conversation comments (issue comments)
──────────────────────────────────────────
Endpoint:  GET {apiBase}/repos/{repo}/issues/{number}/comments
           ?per_page=100&since={iso}
Headers:   Same as above

Response schema (githubCommentsResponseSchema):
[
  {
    "body": "Rework: fix the validation logic",
    "user": { "login": "reviewer" }
  }
]

Steps 2 and 3 are fetched IN PARALLEL via Promise.all().


Step 4: Determine rework
──────────────────────────────────────────
hasInlineComments = inlineComments.length > 0
hasReworkConvo = convoComments.some(c => isReworkComment(c.body))
changesRequested = hasInlineComments || hasReworkConvo

Return: { changesRequested, prNumber, prUrl }
```

### Fetching Feedback Comments

```
Same endpoints as review state checking.
Fetched in parallel.

Inline comments:
  For each comment with body:
    prefix = comment.path ? `[${path}] ` : ''
    result = `${prefix}${body}`
  ALL inline comments included (no Rework: prefix needed).

Conversation comments:
  For each comment:
    if isReworkComment(body):
      result = extractReworkContent(body)
      (strips "Rework:" prefix)
    else:
      EXCLUDED (treated as discussion)

Author filtering (PLANNED):
  Filter out comments where comment.user.login === authenticated user.
  Authenticated user resolved via GET /user -> login field.
  Already cached per process (resolveUsername).
```

### Edge Cases

```
1. GitHub has NO resolution concept for PR comments.
   Once an inline comment is posted, it triggers rework
   until the since timestamp moves past it.
   Mitigation: since filtering (already implemented).
   PLANNED: Also check review state — if the reviewer
   has submitted an "Approved" review, skip rework
   even if old inline comments exist.

2. GitHub fine-grained PATs:
   Must have "Pull requests: Read and write" permission.
   Fine-grained PATs DO support PR creation and comment
   fetching.

3. GitHub Enterprise (GHE):
   API base: https://{hostname}/api/v3
   All endpoints work the same way.
   Detected when hostname !== 'github.com' but
   contains 'github'.

4. Draft PRs:
   No special handling. Draft PRs show as state=open
   and are treated the same as regular PRs.

5. Forked repositories:
   head filter uses {owner}:{branch}. If the PR is
   from a fork, the owner would be different. This
   scenario is not currently handled — Clancy assumes
   PRs are within the same repo.

6. Branch name encoding:
   Branch names with special characters (e.g. /)
   are URL-encoded via encodeURIComponent in the
   manual PR URL builder but passed raw in API
   query parameters (GitHub API handles this).

7. PR comment pagination:
   per_page=100 is the max. GitHub allows up to
   100 per page. PRs with >100 comments would need
   Link header pagination (not implemented).
   Risk: low — PRs with >100 inline comments are rare.
```

### Post-Rework Actions (PLANNED)

```
1. Leave PR comment
──────────────────────────────────────────
Endpoint:  POST {apiBase}/repos/{repo}/issues/{number}/comments
Headers:   Authorization: Bearer {token}
Body:      { "body": "Rework pushed addressing N feedback items.\n\n..." }

Note: uses /issues/{n}/comments (not /pulls/{n}/comments)
because conversation comments are on the issue tracker.


2. Re-request review
──────────────────────────────────────────
Endpoint:  POST {apiBase}/repos/{repo}/pulls/{number}/requested_reviewers
Headers:   Authorization: Bearer {token}
Body:      { "reviewers": ["{username}"] }

Reviewer username extracted from inline/conversation comments
via comment.user.login. Use the FIRST reviewer found
(or all unique reviewers).

Response (HTTP 201): PR object with updated requested_reviewers.
HTTP 422: reviewer not a collaborator (ignore, best-effort).


3. Resolve inline comments
──────────────────────────────────────────
NOT POSSIBLE via GitHub API.
GitHub PR review comments cannot be resolved/dismissed
programmatically. The only mitigation is since filtering.
```

---

## GitLab

### Authentication

```
Header: PRIVATE-TOKEN: {GITLAB_TOKEN}
Scope:  api (full API access)

Token source: GITLAB_TOKEN (optional for all boards)

resolveGitToken() returns: { token: GITLAB_TOKEN }
```

### PR (MR) Creation

```
Endpoint:  POST {apiBase}/projects/{encodedPath}/merge_requests
Headers:   PRIVATE-TOKEN: {token}
           Content-Type: application/json

encodedPath = encodeURIComponent(projectPath)
  e.g. "group/subgroup/project" -> "group%2Fsubgroup%2Fproject"

Body:
{
  "source_branch": "feature/proj-123",
  "target_branch": "main",
  "title": "feat(PROJ-123): Add login page",
  "description": "**Jira:** [PROJ-123](...)\n\n...",
  "remove_source_branch": true
}

Note: remove_source_branch: true auto-deletes source branch
  after merge. This is GitLab-specific behavior.

Success response (HTTP 201):
{
  "web_url": "https://gitlab.com/group/project/-/merge_requests/5",
  "iid": 5,
  ...
}
Extracted: { url: web_url, number: iid }

Already-exists (HTTP 409):
{
  "message": ["Another open merge request already exists for this source branch"]
}
Detection: status === 409 && body includes "already exists"

Auth failure (HTTP 401):
{
  "message": "401 Unauthorized"
}

Not found (HTTP 404):
{
  "message": "404 Project Not Found"
}
```

### Review State Checking

```
Step 1: Find open MR for branch
──────────────────────────────────────────
Endpoint:  GET {apiBase}/projects/{encodedPath}/merge_requests
           ?source_branch={branch}&state=opened
Headers:   PRIVATE-TOKEN: {token}

Response schema (gitlabMrListSchema):
[
  {
    "iid": 5,
    "web_url": "https://gitlab.com/group/project/-/merge_requests/5",
    "source_branch": "feature/proj-123",
    "target_branch": "main"
  }
]

No open MR: empty array -> return undefined
Multiple MRs: uses first (data[0])


Step 2: Fetch discussions
──────────────────────────────────────────
Endpoint:  GET {apiBase}/projects/{encodedPath}/merge_requests/{iid}/discussions
           ?per_page=100
Headers:   PRIVATE-TOKEN: {token}

Response schema (gitlabDiscussionsSchema):
[
  {
    "id": "discussion-abc",
    "notes": [
      {
        "id": 123,
        "body": "This needs error handling",
        "type": "DiffNote",
        "system": false,
        "resolvable": true,
        "resolved": false,
        "created_at": "2026-03-16T14:30:00.000Z",
        "position": {
          "new_path": "src/api.ts",
          "new_line": 42
        }
      },
      {
        "id": 124,
        "body": "Rework: fix the validation",
        "type": null,
        "system": false,
        "resolvable": false,
        "resolved": null,
        "created_at": "2026-03-16T14:35:00.000Z",
        "position": null
      }
    ]
  }
]


Step 3: Filter and determine rework
──────────────────────────────────────────
For each discussion:
  For each note:
    Skip if note.system === true (system-generated)
    Skip if since && note.created_at <= since
      (string comparison — ISO 8601 is lexicographically sortable)
      Note: exact match on since is EXCLUDED (<=)

    If note.type === 'DiffNote':
      Check: resolvable !== false && resolved !== true
      If both true: rework trigger
      If resolved === true: SKIP (reviewer dismissed feedback)

    Else (general note):
      Check: isReworkComment(note.body)
      If true: rework trigger

Return: { changesRequested, prNumber: iid, prUrl: web_url }
```

### Fetching Feedback Comments

```
Same endpoint as review state checking.

DiffNote (inline):
  If resolvable !== false && resolved !== true:
    prefix = note.position?.new_path ? `[${new_path}] ` : ''
    result = `${prefix}${body}`

General note:
  If isReworkComment(body):
    result = extractReworkContent(body)
  Else:
    EXCLUDED

System notes: EXCLUDED (note.system === true)
  Examples: "mentioned in commit", "assigned to @user",
  "changed milestone"

Author filtering (PLANNED):
  Filter notes where note.author.username === authenticated user.
  Authenticated user: GET /user -> username field.
```

### Edge Cases

```
1. Resolved DiffNotes are IGNORED.
   GitLab's resolution system is fully supported.
   A reviewer can resolve inline feedback without
   triggering re-work. This is the most mature
   platform for the rework loop.

2. Discussions vs individual notes:
   GitLab groups notes into discussions. A discussion
   may have multiple notes (replies). ALL notes in a
   discussion are checked individually. A reply to a
   DiffNote is itself a separate note (may be type null).

3. URL encoding:
   Project paths with slashes (e.g. "group/subgroup/project")
   must be URL-encoded: "group%2Fsubgroup%2Fproject".
   encodeURIComponent handles this.

4. Self-hosted GitLab:
   Detected when hostname contains 'gitlab' but is not
   gitlab.com. API base: https://{hostname}/api/v4.
   CLANCY_GIT_API_URL overrides if custom domain doesn't
   contain 'gitlab'.

5. MR approval rules:
   GitLab has approval rules (e.g. "2 approvals required").
   Not currently checked. Clancy only checks for comments,
   not approval state. A MR could have outstanding approval
   requirements without triggering rework.

6. Draft MRs:
   No special handling. Draft MRs show as state=opened.
   Treated the same as regular MRs.

7. Pagination:
   per_page=100. No Link header pagination.
   MRs with >100 discussion threads: older discussions
   silently dropped.
```

### Post-Rework Actions (PLANNED)

```
1. Leave MR comment
──────────────────────────────────────────
Endpoint:  POST {apiBase}/projects/{encoded}/merge_requests/{iid}/notes
Headers:   PRIVATE-TOKEN: {token}
Body:      { "body": "Rework pushed addressing N feedback items.\n\n..." }


2. Re-request review
──────────────────────────────────────────
NOT NEEDED. GitLab automatically notifies reviewers when
new commits are pushed to the MR source branch.


3. Resolve addressed DiffNote threads
──────────────────────────────────────────
Endpoint:  PUT {apiBase}/projects/{encoded}/merge_requests/{iid}/discussions/{discussion_id}/resolve
Headers:   PRIVATE-TOKEN: {token}
Body:      { "resolved": true }

For each discussion that contained a DiffNote which triggered
rework: resolve the entire discussion after pushing fixes.

Process:
  a. During comment fetching, track discussion IDs of
     DiffNote-triggered rework items.
  b. After successful push, iterate and resolve each.
  c. Best-effort — failure to resolve doesn't fail the flow.

Note: resolving a discussion marks ALL notes in it as resolved.
This is correct behavior — the rework addressed the feedback.
```

---

## Bitbucket Cloud

### Authentication

```
Header: Authorization: Basic {base64(BITBUCKET_USER:BITBUCKET_TOKEN)}
Scope:  pullrequest:write (create PRs)
        pullrequest (read PRs and comments)

Token sources: BITBUCKET_USER + BITBUCKET_TOKEN (both required)

resolveGitToken() returns: { token: BITBUCKET_TOKEN, username: BITBUCKET_USER }
basicAuth(username, token) = 'Basic ' + btoa(username + ':' + token)
```

### PR Creation

```
Endpoint:  POST https://api.bitbucket.org/2.0/repositories/{workspace}/{repoSlug}/pullrequests
Headers:   Authorization: Basic {base64}
           Content-Type: application/json

Body:
{
  "title": "feat(PROJ-123): Add login page",
  "description": "**Jira:** [PROJ-123](...)\n\n...",
  "source": {
    "branch": {
      "name": "feature/proj-123"
    }
  },
  "destination": {
    "branch": {
      "name": "main"
    }
  },
  "close_source_branch": true
}

Note: close_source_branch: true auto-deletes source branch
  after merge.

Success response (HTTP 201):
{
  "id": 15,
  "links": {
    "html": {
      "href": "https://bitbucket.org/workspace/repo/pull-requests/15"
    }
  },
  ...
}
Extracted: { url: links.html.href, number: id }

Already-exists (HTTP 409):
{
  "error": {
    "message": "A pull request already exists for ..."
  }
}
Detection: status === 409 && body includes "already exists"

Auth failure (HTTP 401/403):
{
  "error": {
    "message": "Access denied"
  }
}
```

### Review State Checking

```
Step 1: Find open PR for branch
──────────────────────────────────────────
Endpoint:  GET https://api.bitbucket.org/2.0/repositories/{workspace}/{repoSlug}/pullrequests
           ?q=source.branch.name="{branch}"&state=OPEN
Headers:   Authorization: Basic {base64}

Response schema (bitbucketPrListSchema):
{
  "values": [
    {
      "id": 15,
      "links": {
        "html": { "href": "https://bitbucket.org/.../15" }
      },
      "source": { "branch": { "name": "feature/proj-123" } },
      "destination": { "branch": { "name": "main" } }
    }
  ]
}

No open PR: values.length === 0 -> return undefined


Step 2: Fetch comments
──────────────────────────────────────────
Endpoint:  GET https://api.bitbucket.org/2.0/repositories/{workspace}/{repoSlug}/pullrequests/{id}/comments
           ?pagelen=100
Headers:   Authorization: Basic {base64}

Response schema (bitbucketCommentsSchema):
{
  "values": [
    {
      "content": { "raw": "This needs error handling" },
      "inline": {
        "path": "src/api.ts",
        "from": null,
        "to": 42
      },
      "created_on": "2026-03-16T14:30:00.000000+00:00",
      "user": { "display_name": "Reviewer" }
    },
    {
      "content": { "raw": "Rework: fix the validation" },
      "inline": null,
      "created_on": "2026-03-16T14:35:00.000000+00:00",
      "user": { "display_name": "Reviewer" }
    }
  ]
}


Step 3: Filter and determine rework
──────────────────────────────────────────
Client-side since filtering:
  relevant = since
    ? comments.values.filter(c => c.created_on > since)
    : comments.values

  String comparison: ISO 8601 with timezone is
  lexicographically sortable. Exact match excluded (>).

Rework triggers:
  hasInline = relevant.some(c => c.inline != null)
  hasReworkConvo = relevant.some(c =>
    c.inline == null && isReworkComment(c.content.raw))
  changesRequested = hasInline || hasReworkConvo

Return: { changesRequested, prNumber: pr.id, prUrl: htmlUrl }
```

### Fetching Feedback Comments

```
Same endpoint as review state checking.

Inline comments (c.inline != null):
  prefix = c.inline.path ? `[${path}] ` : ''
  result = `${prefix}${c.content.raw}`

Conversation comments (c.inline == null):
  If isReworkComment(c.content.raw):
    result = extractReworkContent(c.content.raw)
  Else:
    EXCLUDED

Author filtering (PLANNED):
  Filter comments where c.user.uuid === authenticated user UUID
  or c.user.display_name matches.
  Authenticated user: GET /user -> uuid field.
```

### Edge Cases

```
1. No comment resolution API.
   Bitbucket Cloud does not support resolving/dismissing
   individual PR comments. Since filtering is the only
   mechanism to avoid re-triggering on old comments.

2. Bitbucket Cloud uses `created_on` with timezone offset:
   "2026-03-16T14:30:00.000000+00:00"
   String comparison with ISO 8601 (UTC from since) works
   because +00:00 sorts after Z but represents the same time.
   Risk: comments in non-UTC timezone representations could
   sort incorrectly. Bitbucket Cloud always returns UTC (+00:00).

3. App passwords vs OAuth:
   BITBUCKET_TOKEN can be an app password (recommended) or
   OAuth access token. Both work with Basic Auth when
   combined with BITBUCKET_USER.

4. Workspace vs team:
   Bitbucket Cloud uses "workspace" (new) not "team" (deprecated).
   parsed from remote URL: first path segment after hostname.

5. Pagination:
   pagelen=100 (max). No ?next URL pagination.
   PRs with >100 comments: older comments dropped.

6. PR comment content format:
   Bitbucket returns c.content.raw (markdown) and
   c.content.html (rendered). Clancy uses raw.

7. close_source_branch: true:
   Sets the PR to auto-delete the source branch after merge.
   This is set during creation and cannot be changed via
   the comments/review API.
```

### Post-Rework Actions (PLANNED)

```
1. Leave PR comment
──────────────────────────────────────────
Endpoint:  POST https://api.bitbucket.org/2.0/repositories/{workspace}/{repoSlug}/pullrequests/{id}/comments
Headers:   Authorization: Basic {base64}
Body:      { "content": { "raw": "Rework pushed addressing N feedback items.\n\n..." } }


2. Re-request review
──────────────────────────────────────────
NOT POSSIBLE via API. Bitbucket Cloud does not have a
programmatic "request review" or "re-request review" API.
Reviewers are notified of new commits via their notification
settings.


3. Resolve comments
──────────────────────────────────────────
NOT POSSIBLE via API. Bitbucket Cloud PR comments cannot
be resolved/dismissed programmatically. Only the comment-only
notification approach is available.
```

---

## Bitbucket Server

### Authentication

```
Header: Authorization: Bearer {BITBUCKET_TOKEN}
Scope:  PROJECT_READ, REPO_READ, PR_WRITE

Token source: BITBUCKET_TOKEN (personal access token)

resolveGitToken() returns: { token: BITBUCKET_TOKEN }

Note: Bitbucket Server does NOT use BITBUCKET_USER.
Bearer token auth is self-identifying.
```

### PR Creation

```
Endpoint:  POST {apiBase}/projects/{projectKey}/repos/{repoSlug}/pull-requests
Headers:   Authorization: Bearer {token}
           Content-Type: application/json

Body:
{
  "title": "feat(PROJ-123): Add login page",
  "description": "**Jira:** [PROJ-123](...)\n\n...",
  "fromRef": {
    "id": "refs/heads/feature/proj-123",
    "repository": {
      "slug": "my-repo",
      "project": { "key": "PROJ" }
    }
  },
  "toRef": {
    "id": "refs/heads/main",
    "repository": {
      "slug": "my-repo",
      "project": { "key": "PROJ" }
    }
  }
}

Note: refs/heads/ prefix is REQUIRED for fromRef and toRef.
The repository and project objects are repeated in each ref.

Success response (HTTP 201):
{
  "id": 3,
  "links": {
    "self": [
      { "href": "https://bitbucket.acme.com/projects/PROJ/repos/my-repo/pull-requests/3" }
    ]
  },
  ...
}
Extracted: { url: links.self[0].href, number: id }

Already-exists (HTTP 409):
{
  "errors": [
    { "message": "Only one pull request may be open for a given source and target branch" }
  ]
}
Detection: status === 409 && body includes "already exists"

Note: Bitbucket Server's error message says "Only one pull request..."
not "already exists" verbatim. The detection may need adjustment.
Current code checks for "already exists" which may NOT match
Bitbucket Server's actual error message. This is a potential bug.

Auth failure (HTTP 401):
{
  "errors": [{ "message": "Authentication failed" }]
}
```

### Review State Checking

```
Step 1: Find open PR for branch
──────────────────────────────────────────
Endpoint:  GET {apiBase}/projects/{projectKey}/repos/{repoSlug}/pull-requests
           ?state=OPEN&at=refs/heads/{branch}
Headers:   Authorization: Bearer {token}

Response schema (bitbucketServerPrListSchema):
{
  "values": [
    {
      "id": 3,
      "links": {
        "self": [
          { "href": "https://bitbucket.acme.com/.../3" }
        ]
      },
      "fromRef": { "id": "refs/heads/feature/proj-123" },
      "toRef": { "id": "refs/heads/main" }
    }
  ]
}

No open PR: values.length === 0 -> return undefined


Step 2: Fetch activities
──────────────────────────────────────────
Endpoint:  GET {apiBase}/projects/{projectKey}/repos/{repoSlug}/pull-requests/{id}/activities
           ?limit=100
Headers:   Authorization: Bearer {token}

Response schema (bitbucketServerActivitiesSchema):
{
  "values": [
    {
      "action": "COMMENTED",
      "comment": {
        "text": "This needs error handling",
        "anchor": {
          "path": "src/api.ts",
          "line": 42,
          "lineType": "ADDED"
        },
        "createdDate": 1710600600000,
        "author": { "name": "reviewer" }
      }
    },
    {
      "action": "COMMENTED",
      "comment": {
        "text": "Rework: fix the validation",
        "anchor": null,
        "createdDate": 1710600900000,
        "author": { "name": "reviewer" }
      }
    },
    {
      "action": "APPROVED",
      "comment": null
    }
  ]
}

Note: activities include non-comment actions (APPROVED,
REVIEWED, RESCOPED, etc.). Only action === 'COMMENTED'
with a comment object is relevant.


Step 3: Filter and determine rework
──────────────────────────────────────────
sinceMs = since ? Date.parse(since) : undefined

Filter: action === 'COMMENTED' && comment exists
        && (sinceMs == null || comment.createdDate > sinceMs)

Epoch millisecond comparison. More precise than string
comparison used by other platforms.

Rework triggers:
  hasInline = commentActivities.some(a => a.comment.anchor != null)
  hasReworkConvo = commentActivities.some(a =>
    a.comment.anchor == null && isReworkComment(a.comment.text))
  changesRequested = hasInline || hasReworkConvo

Return: { changesRequested, prNumber: pr.id, prUrl: htmlUrl }
```

### Fetching Feedback Comments

```
Same endpoint as review state checking.

Filter: action === 'COMMENTED' && comment exists
        && (sinceMs == null || comment.createdDate > sinceMs)

Inline comments (comment.anchor != null):
  prefix = comment.anchor.path ? `[${path}] ` : ''
  result = `${prefix}${comment.text}`

Conversation comments (comment.anchor == null):
  If isReworkComment(comment.text):
    result = extractReworkContent(comment.text)
  Else:
    EXCLUDED

Author filtering (PLANNED):
  Filter activities where comment.author.slug === authenticated user slug.
  Authenticated user: GET /users (server API varies by version).
```

### Edge Cases

```
1. No comment resolution API.
   Bitbucket Server does not support resolving/dismissing
   PR comments via API. Since filtering (epoch ms) is
   the only mechanism.

2. createdDate is epoch milliseconds (not ISO 8601).
   Date.parse(since) converts the ISO 8601 since string
   to epoch ms for comparison. This is precise.

3. activities endpoint returns ALL activity types:
   COMMENTED, APPROVED, REVIEWED, RESCOPED, MERGED, etc.
   Only COMMENTED activities with a comment object are used.

4. Manual PR URL (PLANNED):
   Current: returns undefined.
   Planned fallback:
     https://{hostname}/projects/{projectKey}/repos/{repoSlug}/
       pull-requests?create&sourceBranch=refs/heads/{branch}
       &targetBranch=refs/heads/{target}

5. "already exists" detection:
   Bitbucket Server's actual error message is:
   "Only one pull request may be open for a given source and target branch"
   This does NOT contain "already exists".
   POTENTIAL BUG: the detection check
     status === 409 && text.includes('already exists')
   may not match Bitbucket Server's error.
   Fix needed: also check for "Only one pull request".

6. Project key vs workspace:
   Bitbucket Server uses project keys (uppercase, e.g. "PROJ").
   Detected from remote URL: scm/{projectKey}/{repo} format.

7. Bitbucket Server vs Data Center:
   Same API. Data Center is the clustered version.
   No API differences for PR operations.

8. Pagination:
   limit=100 (Bitbucket Server uses limit, not pagelen).
   No isLastPage/nextPageStart pagination.
   Activities with >100 entries: older activities dropped.

9. Self-hosted detection:
   Detected when hostname contains 'bitbucket' and URL
   path starts with scm/. Otherwise treated as Cloud.
   CLANCY_GIT_PLATFORM=bitbucket-server overrides.
```

### Post-Rework Actions (PLANNED)

```
1. Leave PR comment
──────────────────────────────────────────
Endpoint:  POST {apiBase}/projects/{projectKey}/repos/{repoSlug}/pull-requests/{id}/comments
Headers:   Authorization: Bearer {token}
Body:      { "text": "Rework pushed addressing N feedback items.\n\n..." }

Note: Bitbucket Server uses "text" field, not "content.raw".


2. Re-request review
──────────────────────────────────────────
NOT DIRECTLY POSSIBLE. Bitbucket Server has reviewer
management via PUT /pull-requests/{id} with reviewers
array, but "re-requesting" a review is not a discrete
API action. Adding a reviewer who already approved
resets their approval status (Bitbucket Server >= 7.0).


3. Resolve comments
──────────────────────────────────────────
NOT POSSIBLE via API. Bitbucket Server does support
task resolution (tasks attached to comments), but
individual comment resolution is not available via
the REST API.
```

---

## Cross-Platform Edge Cases

### Comment Body Format

```
Platform              Body field           Multiline handling
────────────────────────────────────────────────────────────────────
GitHub                comment.body         Full markdown. Newlines
                                           preserved. extractReworkContent
                                           preserves multiline after prefix.

GitLab                note.body            Full markdown. Same handling.

Bitbucket Cloud       comment.content.raw  Markdown. Same handling.
                      (also has .html)

Bitbucket Server      comment.text         Plain text (may contain markdown).
                                           Same handling via isReworkComment/
                                           extractReworkContent.
```

### Rework: Prefix Parsing

```
All platforms use the same isReworkComment() and extractReworkContent():

Input                           isReworkComment?    extractReworkContent
──────────────────────────────────────────────────────────────────────────
"Rework: fix validation"       true                "fix validation"
"rework: fix validation"       true                "fix validation"
"REWORK: fix validation"       true                "fix validation"
"Rework:fix validation"        true                "fix validation"
"  Rework: fix validation  "   true                "fix validation"
"Rework: line 1\nline 2"       true                "line 1\nline 2"
"Please rework this"           false               N/A (not called)
"RE-WORK: fix it"              false               N/A
""                             false               N/A
"rework"                       false               N/A (no colon)
```

### Timezone Handling Across Platforms

```
Platform              Timestamp format               Since comparison
────────────────────────────────────────────────────────────────────
GitHub                ISO 8601 (server-side)          Server handles it
GitLab                ISO 8601 with Z suffix          String comparison
                      "2026-03-16T14:30:00.000Z"      (<=)
Bitbucket Cloud       ISO 8601 with +00:00            String comparison
                      "2026-03-16T14:30:00.000000+00:00"  (>)
Bitbucket Server      Epoch milliseconds              Numeric comparison
                      1710600600000                    (>)

Progress timestamp (after UTC fix):
  Stored as "YYYY-MM-DD HH:MM" in UTC.
  Converted: new Date("YYYY-MM-DDTHH:MM").toISOString()
    -> "YYYY-MM-DDTHH:MM:00.000Z"
  This works for all platforms:
    GitHub: passed as query param (server handles)
    GitLab: string comparison (Z suffix sortable)
    Bitbucket Cloud: string comparison (+00:00 vs Z — Z < +00:00
      alphabetically but both represent UTC; string comparison
      still works because Bitbucket always returns +00:00)
    Bitbucket Server: Date.parse() handles both Z and +00:00
```

### Platform-Specific since Filtering Direction

```
IMPORTANT: The comparison direction is INTENTIONALLY DIFFERENT
across platforms to achieve the same goal: "only new comments."

GitHub:    Server-side. Returns only comments created AFTER since.
           Exact-match behavior: created_at === since is EXCLUDED
           (GitHub uses > internally).

GitLab:    note.created_at <= since -> SKIP
           Means: include notes where created_at > since.
           Exact match: EXCLUDED (<=).

Bitbucket: c.created_on > since -> INCLUDE
Cloud      Means: only include comments strictly after since.
           Exact match: EXCLUDED (> is strict).

Bitbucket: comment.createdDate > sinceMs -> INCLUDE
Server     Means: only include comments strictly after since.
           Exact match: EXCLUDED (> is strict).

All platforms: exact-match comments are excluded.
This is correct — a comment created at the same instant
as the progress entry is from the PREVIOUS cycle.
```

### Bot/CI Comment Handling

```
Current state:
  No author filtering on any platform.
  Bot comments (CI status, coverage reports, deployment bots)
  could trigger false rework IF they:
    a. Are inline comments (all platforms)
    b. Start with "Rework:" (case-insensitive)

  Risk: LOW for conversation bots (unlikely to use "Rework:" prefix).
  Risk: MODERATE for inline bots (e.g. linting bots that leave
    inline comments on specific lines).

Planned fix:
  Filter out comments by the authenticated user (token owner).
  This prevents Clancy's own post-rework comments from triggering
  a new rework cycle.

  For third-party bots: not filtered. The CLANCY_IGNORE_BOTS config
  is NOT planned. Users should configure bots to not leave inline
  comments on PRs, or ignore the false rework trigger (it will be
  capped by CLANCY_MAX_REWORK).
```
