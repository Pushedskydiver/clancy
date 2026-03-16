# PR-Based Flow & QA Rework Loop -- Current State

Comprehensive documentation of the PR-based delivery flow and QA rework loop as implemented on the `feature/pr-based-flow` branch. Last updated: 2026-03-16.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Decision Logic: Epic vs PR Flow](#decision-logic-epic-vs-pr-flow)
3. [PR Creation Pipeline](#pr-creation-pipeline)
4. [Rework Detection Pipeline](#rework-detection-pipeline)
5. [Rework Execution Flow](#rework-execution-flow)
6. [Module Reference](#module-reference)
7. [Progress Logging](#progress-logging)
8. [Platform Differences](#platform-differences)
9. [Configuration](#configuration)
10. [Test Coverage](#test-coverage)
11. [Bugs, Inconsistencies & Gaps](#bugs-inconsistencies--gaps)

---

## Architecture Overview

The PR-based flow and rework loop are implemented across these modules:

```
src/scripts/once/once.ts                          -- Main orchestrator
src/scripts/shared/pull-request/github/github.ts  -- GitHub PR creation + review checking
src/scripts/shared/pull-request/gitlab/gitlab.ts  -- GitLab MR creation + review checking
src/scripts/shared/pull-request/bitbucket/bitbucket.ts -- Bitbucket Cloud + Server
src/scripts/shared/pull-request/post-pr/post-pr.ts    -- Shared POST utility
src/scripts/shared/pull-request/pr-body/pr-body.ts    -- PR body builder
src/scripts/shared/pull-request/rework-comment/rework-comment.ts -- Comment detection
src/scripts/shared/remote/remote.ts               -- Git host detection
src/scripts/shared/git-ops/git-ops.ts             -- pushBranch, fetchRemoteBranch
src/scripts/shared/progress/progress.ts           -- Progress log (findEntriesWithStatus, countReworkCycles)
src/scripts/shared/prompt/prompt.ts               -- buildReworkPrompt
src/scripts/shared/branch/branch.ts               -- computeTicketBranch
src/types/remote.ts                               -- PrReviewState, PrCreationResult, ProgressStatus, RemoteInfo
src/schemas/github.ts                             -- GitHub PR/comment schemas
src/schemas/gitlab-mr.ts                          -- GitLab MR/discussion schemas
src/schemas/bitbucket-pr.ts                       -- Bitbucket Cloud + Server schemas
src/schemas/env.ts                                -- Env vars (CLANCY_STATUS_REVIEW, CLANCY_MAX_REWORK, git host tokens)
```

---

## Decision Logic: Epic vs PR Flow

In `once.ts` `run()`, after Claude finishes implementation (step 13):

```
if (isRework):
    deliverViaPullRequest()   -- always PR flow for rework
    appendProgress(... 'REWORK')  -- overrides the PR_CREATED/PUSHED logged by deliverViaPullRequest
else if (hasParent):
    deliverViaEpicMerge()     -- squash merge locally, delete branch, DONE
else:
    deliverViaPullRequest()   -- push + create PR, PR_CREATED/PUSHED
```

The `hasParent` check: `ticket.parentInfo !== 'none'`. Parent sources:
- Jira: `epicKey`
- GitHub: `milestone`
- Linear: `parentIdentifier`

---

## PR Creation Pipeline

### Step 1: Push branch

`deliverViaPullRequest()` calls `pushBranch(ticketBranch)` which runs:
```
git push -u origin <branch>
```

If push fails: logs `PUSH_FAILED`, prints manual push command, checks out target branch, returns `false`. The orchestrator returns early -- no PR attempt.

### Step 2: Detect remote

`detectRemote(platformOverride?)` runs `git remote get-url origin`, parses the URL via `parseRemote()`.

**parseRemote** extracts hostname and path from SSH (`git@host:path`) and HTTPS/SSH-URL formats, then maps hostname to platform:
- `github.com` or hostname containing "github" -> `github`
- `gitlab.com` or hostname containing "gitlab" -> `gitlab`
- `bitbucket.org` or hostname containing "bitbucket" -> `bitbucket` (Cloud) or `bitbucket-server` (if path starts with `scm/`)
- `dev.azure` or `visualstudio` -> `azure`
- Otherwise -> `unknown`

**Platform override**: If `CLANCY_GIT_PLATFORM` is set, `overrideRemotePlatform()` re-parses the URL with the forced platform type. This handles self-hosted instances with custom domains.

### Step 3: Build API base URL

`buildApiBaseUrl(remote, apiUrlOverride?)`:
- If `CLANCY_GIT_API_URL` is set, uses it (trailing slash stripped)
- github.com -> `https://api.github.com`
- GitHub Enterprise -> `https://{hostname}/api/v3`
- GitLab -> `https://{hostname}/api/v4`
- Bitbucket Cloud -> `https://api.bitbucket.org/2.0`
- Bitbucket Server -> `https://{hostname}/rest/api/1.0`

### Step 4: Resolve credentials

`resolveGitToken(config, remote)` checks the board config's shared env for platform-specific tokens:
- `github` -> `GITHUB_TOKEN`
- `gitlab` -> `GITLAB_TOKEN`
- `bitbucket` -> `BITBUCKET_USER` + `BITBUCKET_TOKEN` (both required)
- `bitbucket-server` -> `BITBUCKET_TOKEN`

For GitHub boards, `GITHUB_TOKEN` is always present (required for issue fetching). For Jira/Linear boards, the user must configure a separate git host token.

### Step 5: Create PR/MR

`attemptPrCreation()` dispatches to the platform-specific function. All use `postPullRequest()` internally.

**postPullRequest** (shared utility):
- POSTs JSON with 30-second timeout (`AbortController`)
- On success: calls `parseSuccess` callback to extract URL and number
- On HTTP error: checks `isAlreadyExists` callback, returns error with status + truncated body (200 chars)
- On network error: returns error message
- Validates that response has either URL or number

**Platform-specific PR creation**:

| Platform | Endpoint | Auth | Body format | Already-exists detection |
|---|---|---|---|---|
| GitHub | `POST /repos/{repo}/pulls` | `Bearer {token}` | `{ title, head, base, body }` | HTTP 422 + "already exists" |
| GitLab | `POST /projects/{encoded}/merge_requests` | `PRIVATE-TOKEN: {token}` | `{ source_branch, target_branch, title, description, remove_source_branch: true }` | HTTP 409 + "already exists" |
| Bitbucket Cloud | `POST /repositories/{ws}/{slug}/pullrequests` | `Basic {base64}` | `{ title, description, source: { branch: { name } }, destination: { branch: { name } }, close_source_branch: true }` | HTTP 409 + "already exists" |
| Bitbucket Server | `POST /projects/{key}/repos/{slug}/pull-requests` | `Bearer {token}` | `{ title, description, fromRef: { id: "refs/heads/..." }, toRef: { id: "refs/heads/..." } }` | HTTP 409 + "already exists" |

### Step 6: PR body

`buildPrBody(config, ticket)` generates markdown:

1. Board link:
   - GitHub: `Closes #N` (auto-close on merge)
   - Jira: `**Jira:** [KEY](URL/browse/KEY)`
   - Linear: `**Linear:** KEY`
2. Description section (if non-empty)
3. Clancy attribution footer
4. Rework instructions section explaining:
   - Inline code comments are always picked up
   - General feedback needs `Rework:` prefix
   - Example: `` `Rework: The form validation doesn't handle empty passwords` ``

### Step 7: Log result and transition

After PR creation attempt, `deliverViaPullRequest` logs to progress.txt:

| Outcome | Status logged |
|---|---|
| PR created successfully | `PR_CREATED` |
| PR already exists | `PUSHED` |
| PR creation failed | `PUSHED` (manual URL printed) |
| No token for platform | `PUSHED` (manual URL printed) |
| No remote detected | `LOCAL` |
| Unknown/Azure remote | `PUSHED` |

Ticket transition (non-GitHub only):
- Uses `CLANCY_STATUS_REVIEW` if set, otherwise falls back to `CLANCY_STATUS_DONE`
- GitHub Issues are NOT closed (PR body has `Closes #N` for auto-close on merge)

### Fallback ladder (complete)

```
Push succeeds?
  No  -> PUSH_FAILED, print manual push command, return false
  Yes -> Detect remote
    Remote = none -> LOCAL (no remote configured)
    Remote = unknown/azure -> PUSHED (manual note)
    Remote = github/gitlab/bitbucket/bitbucket-server ->
      Has token?
        No  -> PUSHED + manual URL
        Yes -> Attempt PR creation
          Success -> PR_CREATED
          Already exists -> PUSHED (note printed)
          API error -> PUSHED + manual URL (if available)
```

The manual URL builder (`buildManualPrUrl`) creates pre-filled PR URLs for GitHub, GitLab, and Bitbucket Cloud. Returns `undefined` for Bitbucket Server (no standard URL pattern) and other platforms.

---

## Rework Detection Pipeline

### Entry point: `fetchReworkFromPrReview(config)`

Called in `run()` at step 5, BEFORE fetching fresh tickets. Rework always takes priority.

### Step 1: Find candidates in progress.txt

```typescript
const prCreated = findEntriesWithStatus(process.cwd(), 'PR_CREATED');
const reworked = findEntriesWithStatus(process.cwd(), 'REWORK');
const candidates = [...prCreated, ...reworked];
```

`findEntriesWithStatus` scans progress.txt, builds a Map of latest entry per ticket key, then filters to entries with the requested status. This means:
- A ticket with `PR_CREATED` followed by `DONE` is NOT a candidate (latest is `DONE`)
- A ticket with `REWORK` followed by `PR_CREATED` is a candidate under `PR_CREATED` (latest is `PR_CREATED`)
- A ticket with `PR_CREATED` followed by `REWORK` is a candidate under `REWORK`

Both `PR_CREATED` and `REWORK` entries are checked, because after rework the status is set to `REWORK`, and a subsequent check needs to still find it.

### Step 2: Gate checks

Early returns (all silent -- best-effort):
- No candidates -> `undefined`
- Remote is `none`, `unknown`, or `azure` -> `undefined`
- No git host token -> `undefined`
- No API base URL -> `undefined`

### Step 3: Check PR review state (per candidate)

Limited to first 5 candidates (rate limit protection).

For each candidate:
1. Compute the ticket branch: `computeTicketBranch(provider, entry.key)`
2. Convert progress timestamp to ISO 8601 for `since` filtering
3. Call platform-specific `checkPrReviewState`

**Timestamp conversion**: The progress log stores `YYYY-MM-DD HH:MM` in local time. This is parsed with `new Date(timestamp.replace(' ', 'T'))` which interprets it as local time. Converted to ISO 8601 with `.toISOString()`. Falls back to `undefined` (no filtering) if parse fails.

### Step 4: Platform-specific review state checking

Each platform function follows the same pattern:
1. Find the open PR/MR for the branch
2. Fetch comments/discussions
3. Check for rework-triggering content
4. Return `{ changesRequested, prNumber, prUrl }` or `undefined`

**What triggers rework (uniform across platforms):**
- **Inline comments** (on specific code lines) -- ALWAYS trigger rework, no prefix needed
- **Conversation comments** (general) -- only trigger if prefixed with `Rework:` (case-insensitive)

**Platform-specific details:**

#### GitHub (`checkPrReviewState`)
- Finds PR: `GET /repos/{repo}/pulls?head={owner}:{branch}&state=open`
- Fetches inline + conversation in parallel:
  - `GET /repos/{repo}/pulls/{number}/comments?per_page=100` (inline)
  - `GET /repos/{repo}/issues/{number}/comments?per_page=100` (conversation)
- `since` parameter: appended as `&since={iso}` -- GitHub API filters server-side
- Rework check: `inlineComments.length > 0 || convoComments.some(c => isReworkComment(c.body))`

#### GitLab (`checkMrReviewState`)
- Finds MR: `GET /projects/{encoded}/merge_requests?source_branch={branch}&state=opened`
- Fetches discussions: `GET /projects/{encoded}/merge_requests/{iid}/discussions?per_page=100`
- `since` filtering: client-side `note.created_at <= since` check (string comparison -- ISO 8601 is lexicographically sortable)
- Rework check per note:
  - Skip system notes (`note.system === true`)
  - DiffNote with `resolvable !== false && resolved !== true` -> rework
  - General note matching `isReworkComment(note.body)` -> rework
  - **Resolved DiffNotes are ignored** -- only unresolved inline comments trigger rework

#### Bitbucket Cloud (`checkPrReviewState`)
- Finds PR: `GET /repositories/{ws}/{slug}/pullrequests?q=source.branch.name="{branch}"&state=OPEN`
- Fetches comments: `GET /repositories/{ws}/{slug}/pullrequests/{id}/comments?pagelen=100`
- `since` filtering: client-side `c.created_on > since` (string comparison)
- Rework check: inline (`c.inline != null`) or conversation with `isReworkComment(c.content.raw)`

#### Bitbucket Server (`checkServerPrReviewState`)
- Finds PR: `GET /projects/{key}/repos/{slug}/pull-requests?state=OPEN&at=refs/heads/{branch}`
- Fetches activities: `GET /projects/{key}/repos/{slug}/pull-requests/{id}/activities?limit=100`
- `since` filtering: client-side `a.comment.createdDate > sinceMs` (epoch milliseconds comparison via `Date.parse(since)`)
- Rework check: anchor present -> inline, otherwise `isReworkComment(a.comment.text)`

### Step 5: Fetch feedback comments

If `changesRequested` is true, a second call fetches the actual comment content. Same platform dispatch pattern as step 4.

**Comment formatting (uniform):**
- Inline comments: prefixed with `[path]` when file path is available, e.g. `[src/index.ts] This needs error handling`
- Conversation comments: `Rework:` prefix stripped via `extractReworkContent`, e.g. `Rework: fix validation` -> `fix validation`
- Non-Rework conversation comments: excluded entirely

### Step 6: Build rework ticket

Returns `{ ticket, feedback, prNumber }` where ticket is a minimal `FetchedTicket`:
```typescript
{
  key: entry.key,        // from progress.txt
  title: entry.summary,  // from progress.txt
  description: '',       // empty -- no re-fetch from board
  parentInfo: 'none',    // always 'none' for rework
  blockers: 'None',
}
```

---

## Rework Execution Flow

### The complete flow from "Clancy detects rework" to "fixes pushed"

1. **Detection** (step 5 in `run()`):
   - `fetchReworkFromPrReview(config)` returns rework data
   - Sets `isRework = true`, stores `ticket` and `prFeedback`
   - Prints: `↻ PR rework: [KEY] Title`

2. **Max rework guard** (step 5a):
   - Parses `CLANCY_MAX_REWORK` (default 3, must be finite and > 0)
   - Calls `countReworkCycles(cwd, key)` -- counts entries with status `REWORK` in progress.txt
   - If `cycles >= maxRework`: logs `SKIPPED`, returns early

3. **Branch computation** (step 6):
   - `ticketBranch = computeTicketBranch(provider, key)` -- same as original
   - `targetBranch = computeTargetBranch(provider, baseBranch, parent)` -- parent is always `undefined` for rework (parentInfo = 'none'), so target = baseBranch

4. **Dry-run gate** (step 7):
   - Shows "Mode: Rework" in dry-run output

5. **Feasibility check skipped** (step 9):
   - `if (!isRework && !skipFeasibility)` -- rework always skips feasibility

6. **Branch setup** (step 10):
   ```
   ensureBranch(targetBranch, baseBranch)     -- ensure target exists
   fetched = fetchRemoteBranch(ticketBranch)   -- try to get remote branch
   if (fetched):
       checkout(ticketBranch)                  -- use existing branch
   else:
       checkout(targetBranch)                  -- fall back
       checkout(ticketBranch, true)            -- create fresh branch (-B flag)
   ```
   This differs from the normal flow which always creates a fresh branch.

7. **Transition to In Progress** (step 11):
   - Same as normal flow (if `CLANCY_STATUS_IN_PROGRESS` is set)

8. **Build rework prompt** (step 12):
   ```typescript
   buildReworkPrompt({
     key, title, description,
     provider,
     feedbackComments: prFeedback ?? [],
     previousContext: undefined,  // V1: no diff context yet
   })
   ```

9. **Invoke Claude** (step 12):
   - Same `invokeClaudeSession(prompt, model)` as normal flow

10. **Deliver** (step 13):
    - Always calls `deliverViaPullRequest()` (never epic merge for rework)
    - Then OVERRIDES the progress status: `appendProgress(... 'REWORK')`
    - This means progress.txt gets TWO entries for a rework delivery:
      1. `PR_CREATED` or `PUSHED` (from `deliverViaPullRequest`)
      2. `REWORK` (from the override in step 13)

---

## Module Reference

### `isReworkComment(body: string): boolean`

File: `src/scripts/shared/pull-request/rework-comment/rework-comment.ts`

- Trims whitespace, lowercases, checks `startsWith('rework:')`
- Case-insensitive: `Rework:`, `rework:`, `REWORK:`, `ReWoRk:` all match
- `"Please rework this"` does NOT match (must start with `rework:`)
- Empty string returns `false`

### `extractReworkContent(body: string): string`

Same file.

- Trims, strips `rework:` prefix (case-insensitive regex), trims again
- `"Rework:   lots of space"` -> `"lots of space"`
- `"Rework:fix it"` -> `"fix it"` (no space after colon is fine)
- Preserves multiline content after prefix

### `buildReworkPrompt(input: ReworkPromptInput): string`

File: `src/scripts/shared/prompt/prompt.ts`

**Input type:**
```typescript
type ReworkPromptInput = {
  key: string;
  title: string;
  description: string;
  provider: BoardProvider;
  feedbackComments: string[];
  previousContext?: string;  // unused in V1
}
```

**Generated prompt structure:**
```
You are fixing review feedback on [{key}] {title}.

Description:
{description}

## Reviewer Feedback

1. {comment1}
2. {comment2}
...

Address the specific feedback above. Don't re-implement unrelated areas. Focus only on what was flagged.

Steps:
1. Read core docs in .clancy/docs/: STACK.md, ARCHITECTURE.md, CONVENTIONS.md, GIT.md, DEFINITION-OF-DONE.md, CONCERNS.md
   Also read if relevant: INTEGRATIONS.md, TESTING.md, DESIGN-SYSTEM.md, ACCESSIBILITY.md
2. Follow the conventions in GIT.md exactly
3. Fix the issues identified in the reviewer feedback
4. Commit your work following the conventions in GIT.md
5. When done, confirm you are finished.
```

If `feedbackComments` is empty: `"No reviewer comments found. Review the existing implementation and fix any issues."`

If `previousContext` is provided (not in V1): appended as a fenced code block under `## Previous Implementation`.

**Differences from normal prompt:**
- No executability check (rework is always implementable)
- No parent/epic/blocker info
- Includes numbered reviewer feedback
- Instruction: "Don't re-implement unrelated areas. Focus only on what was flagged."
- Shorter steps (no executability check step, no skip handling)

### `pushBranch(branch: string): boolean`

File: `src/scripts/shared/git-ops/git-ops.ts`

Runs `git push -u origin {branch}`. Returns `true` on success, `false` on any error (swallowed). Uses `-u` to set upstream tracking.

### `fetchRemoteBranch(branch: string): boolean`

Same file.

Runs `git fetch origin {branch}:{branch}`. Returns `true` if branch exists on remote and was fetched, `false` if not (e.g. branch deleted or never pushed).

### `findEntriesWithStatus(projectRoot, status): ProgressEntry[]`

File: `src/scripts/shared/progress/progress.ts`

Parses `.clancy/progress.txt`, builds a Map<key, entry> (latest wins), filters to entries with the given status. Returns array of matching entries.

### `countReworkCycles(projectRoot, key): number`

Same file.

Counts ALL entries (not just latest) for a given key with status `REWORK`. Case-insensitive key matching.

### `computeTicketBranch(provider, key): string`

File: `src/scripts/shared/branch/branch.ts`

- Jira/Linear: `feature/{key-lowercase}` (e.g. `feature/proj-123`)
- GitHub: `feature/issue-{number}` (e.g. `feature/issue-42`, strips `#`)

---

## Progress Logging

### Format

```
YYYY-MM-DD HH:MM | TICKET-KEY | Summary | STATUS
```

### Statuses and when they're logged

| Status | When logged | Logged by |
|---|---|---|
| `PR_CREATED` | PR/MR created successfully | `deliverViaPullRequest` |
| `PUSHED` | Branch pushed but PR failed/skipped/already exists | `deliverViaPullRequest` |
| `PUSH_FAILED` | git push failed | `deliverViaPullRequest` |
| `LOCAL` | No remote configured | `deliverViaPullRequest` |
| `DONE` | Epic flow: squash merged successfully | `deliverViaEpicMerge` |
| `SKIPPED` | Feasibility failed, or max rework reached | `run()` |
| `REWORK` | Rework delivery completed | `run()` (after `deliverViaPullRequest`) |
| `PLAN` | Planner flow (not covered here) | — |
| `APPROVE` | Planner flow (not covered here) | — |

### Rework double-logging

When rework is delivered, progress.txt gets TWO entries in sequence:
1. From `deliverViaPullRequest`: `PR_CREATED` or `PUSHED` (etc.)
2. From `run()`: `REWORK` (override)

The second entry becomes the "latest" for that key, so `findEntriesWithStatus(... 'REWORK')` will find it on the next scan. This is correct for rework detection because rework candidates include both `PR_CREATED` and `REWORK` statuses.

### Timestamp and `since` filtering

The progress timestamp is local time (`YYYY-MM-DD HH:MM`). When used as a `since` filter:

1. `entry.timestamp.replace(' ', 'T')` -> `YYYY-MM-DDTHH:MM`
2. `new Date(...)` interprets as local time
3. `.toISOString()` converts to UTC

This means the `since` value is accurate to the minute (no seconds). A comment created in the same minute as the progress entry could be missed or included depending on exact second timing -- this is acceptable as a race condition is unlikely in practice.

**Platform `since` behavior:**
- **GitHub**: `since` passed as query parameter -- API filters server-side
- **GitLab**: `since` checked client-side with string comparison (`note.created_at <= since`)
- **Bitbucket Cloud**: `since` checked client-side with string comparison (`c.created_on > since`)
- **Bitbucket Server**: `since` converted to epoch ms via `Date.parse()`, compared against `comment.createdDate` (epoch ms)

---

## Platform Differences

### Authentication

| Platform | Auth method | Header |
|---|---|---|
| GitHub | Bearer token | `Authorization: Bearer {token}` |
| GitLab | Private token | `PRIVATE-TOKEN: {token}` |
| Bitbucket Cloud | HTTP Basic Auth | `Authorization: Basic {base64(user:token)}` |
| Bitbucket Server | Bearer token | `Authorization: Bearer {token}` |

### Comment types that trigger rework

| Platform | Inline indicator | Conversation indicator |
|---|---|---|
| GitHub | Any comment from `/pulls/{n}/comments` endpoint | `isReworkComment(body)` on `/issues/{n}/comments` |
| GitLab | `note.type === 'DiffNote'` with `resolvable !== false && resolved !== true` | `isReworkComment(note.body)` |
| Bitbucket Cloud | `comment.inline != null` | `isReworkComment(comment.content.raw)` |
| Bitbucket Server | `comment.anchor != null` | `isReworkComment(comment.text)` |

### Inline comment path prefixing

| Platform | Path source | Prefix format |
|---|---|---|
| GitHub | `comment.path` | `[{path}] ` |
| GitLab | `note.position.new_path` | `[{new_path}] ` |
| Bitbucket Cloud | `comment.inline.path` | `[{path}] ` |
| Bitbucket Server | `comment.anchor.path` | `[{path}] ` |

### PR creation extras

- **GitLab**: Sets `remove_source_branch: true` (auto-delete source after merge)
- **Bitbucket Cloud**: Sets `close_source_branch: true`
- **Bitbucket Server**: Uses `refs/heads/` prefixed branch refs in `fromRef`/`toRef`
- **GitHub**: PR body includes `Closes #N` for auto-close

### Status transition on PR creation

- **GitHub**: Does NOT close the issue (relies on `Closes #N` in PR body)
- **Jira/Linear**: Transitions to `CLANCY_STATUS_REVIEW` (falls back to `CLANCY_STATUS_DONE`)

---

## Configuration

### Env vars in `.clancy/.env`

| Variable | Default | Purpose |
|---|---|---|
| `CLANCY_STATUS_REVIEW` | (falls back to `CLANCY_STATUS_DONE`) | Board status after PR creation |
| `CLANCY_MAX_REWORK` | `3` | Max rework cycles before SKIPPED |
| `GITHUB_TOKEN` | (required for GitHub boards) | GitHub API token |
| `GITLAB_TOKEN` | (optional) | GitLab API token for PR creation |
| `BITBUCKET_USER` | (optional) | Bitbucket Cloud username |
| `BITBUCKET_TOKEN` | (optional) | Bitbucket app password / Server PAT |
| `CLANCY_GIT_PLATFORM` | (auto-detect) | Override: `github`, `gitlab`, `bitbucket`, `bitbucket-server` |
| `CLANCY_GIT_API_URL` | (auto-detect) | Override API base URL for self-hosted |

### Zod validation

All env vars are validated at startup via `src/schemas/env.ts`. The shared schema includes:
- `CLANCY_STATUS_REVIEW`: optional string
- `CLANCY_MAX_REWORK`: optional string (parsed to int at runtime, not in schema)
- All git host tokens: optional strings
- `CLANCY_GIT_PLATFORM` and `CLANCY_GIT_API_URL`: optional strings

---

## Test Coverage

### Orchestrator tests (`once.test.ts`)

Rework-specific tests (7 tests):
1. `detects PR-based rework from review state` -- full happy path
2. `falls through PR rework when no changes requested` -- fetches fresh ticket
3. `falls through PR rework when no PR_CREATED entries` -- skips review check
4. `PR rework errors fall through gracefully` -- filesystem error caught
5. `max rework guard triggers SKIPPED` -- 3 cycles reached
6. `rework skips feasibility check` -- feasibility not called
7. `rework creates fresh branch when remote branch is missing` -- fallback to new branch
8. `PR-flow rework checks out existing branch` -- fetchRemoteBranch + checkout

PR-flow tests (3 tests):
1. `uses PR flow when ticket has no epic` -- push + create PR, no squash merge
2. `logs PUSH_FAILED when push fails`
3. `GitHub PR flow: push + create PR, do not close issue`

### Platform PR tests

**GitHub** (`github.test.ts`): 17 tests
- `createPullRequest`: success, duplicate, auth failure, network failure, custom API base
- `checkPrReviewState`: inline triggers, Rework: triggers, non-Rework ignored, case-insensitive, no PR, API error, since parameter, old/new comments with since, backward compat without since
- `fetchPrReviewComments`: mixed inline + Rework, inline without Rework prefix, excludes non-Rework, error handling

**GitLab** (`gitlab.test.ts`): 17 tests
- `createMergeRequest`: success, URL-encoding, PRIVATE-TOKEN header, 409 conflict, auth failure, network failure
- `checkMrReviewState`: DiffNote triggers, Rework: triggers, non-Rework ignored, system notes ignored, case-insensitive, no MR, API error, since filtering (old/new/backward compat)
- `fetchMrReviewComments`: DiffNote + Rework mix, path prefix, filters system + non-Rework, error

**Bitbucket** (`bitbucket.test.ts`): ~28 tests
- Cloud `createPullRequest`: success, Basic Auth, auth failure, network failure
- Server `createServerPullRequest`: success, Bearer auth + fromRef/toRef, auth failure
- Cloud `checkPrReviewState`: inline, Rework:, non-Rework, no PR, since filtering (3 tests)
- Cloud `fetchPrReviewComments`: inline + Rework, inline only, excludes non-Rework, error
- Server `checkServerPrReviewState`: inline, Rework:, non-Rework, no PR, since filtering (3 tests)
- Server `fetchServerPrReviewComments`: inline + Rework, inline only, excludes non-Rework, error

**Rework comment** (`rework-comment.test.ts`): 10 tests
- `isReworkComment`: true for prefix, case-insensitive, trims whitespace, false for regular/embedded/empty
- `extractReworkContent`: strips prefix, case-insensitive, extra whitespace, no space, multiline

**Post PR** (`post-pr.test.ts`): 6 tests
- Success, error with status, already-exists, network failure, truncated error, headers/body

**PR body** (`pr-body.test.ts`): 6 tests
- Jira link, GitHub Closes, Linear key, empty description, footer, rework instructions

### Missing test coverage

1. **`buildManualPrUrl`** -- no dedicated tests (only tested indirectly through orchestrator)
2. **`resolveGitToken`** -- no dedicated tests
3. **`attemptPrCreation`** -- no dedicated tests (tested indirectly)
4. **GitLab/Bitbucket rework in orchestrator** -- orchestrator tests only cover GitHub rework path
5. **`since` timestamp conversion edge cases** -- no test for invalid timestamps or timezone handling
6. **Pagination** -- no tests for >100 comments (all APIs limited to 100 per page)
7. **`deliverViaPullRequest` rework path** -- the double-logging (PR_CREATED then REWORK) is tested indirectly but not explicitly verified as two separate calls

---

## Bugs, Inconsistencies & Gaps

### Bugs

1. **Double progress logging on rework**: When rework is delivered, `deliverViaPullRequest` logs `PR_CREATED` (or `PUSHED`), then `run()` immediately logs `REWORK`. This means every rework cycle adds 2 entries to progress.txt. While functionally correct (the REWORK entry becomes "latest"), it clutters the log and could confuse users reading progress.txt directly. A cleaner approach would be to pass a status parameter to `deliverViaPullRequest` or have it not log when called from rework context.

2. **GitHub inline comments don't use `since` for filtering**: GitHub's `/pulls/{n}/comments` endpoint (inline comments) supports `since` parameter, and the code passes it. However, unlike conversation comments where GitHub filters server-side, the code checks `inlineComments.length > 0` without verifying timestamps. If GitHub's API does filter server-side (it does for this endpoint), this works. But the approach is inconsistent with GitLab/Bitbucket which do explicit client-side timestamp checks on inline comments.

3. **Rework ticket has empty description**: When rework is detected, the `FetchedTicket` is constructed with `description: ''`. This means the rework prompt says `Description:\n\n` with nothing. The original ticket description is not re-fetched from the board, which could leave Claude without context about what the ticket is about. For simple feedback this is fine, but for complex rework it could be limiting.

### Inconsistencies

1. **`since` filtering approach varies by platform**:
   - GitHub: server-side via query parameter (for both inline and conversation)
   - GitLab: client-side string comparison (`<=` -- excludes exact matches)
   - Bitbucket Cloud: client-side string comparison (`>` -- excludes exact matches)
   - Bitbucket Server: client-side epoch ms comparison (`>` -- excludes exact matches)

   The GitHub approach is more reliable (can't miss comments that server returns), but the others could theoretically miss comments if the API returns comments not yet visible to server-side filtering.

2. **GitLab `since` uses `<=` but Bitbucket uses `>`**: GitLab excludes comments where `created_at <= since`, while Bitbucket excludes where `created_on > since` is false. Both achieve the same goal (only new comments) but the comparison direction is opposite. A comment with `created_at === since` is excluded on GitLab but the Bitbucket equivalent would also exclude it (since `created_on > since` is false when equal). Consistent behavior.

3. **GitLab resolved DiffNotes are ignored but GitHub has no equivalent**: GitLab checks `resolved !== true` before triggering rework on DiffNotes. GitHub inline comments have no resolution concept -- once posted, they always trigger rework. This means on GitHub, a reviewer can't "dismiss" inline feedback without deleting the comment, while on GitLab they can resolve it.

4. **`REWORK` status candidates include both `PR_CREATED` and `REWORK`**: `fetchReworkFromPrReview` searches for both statuses. Due to double-logging, a rework delivery creates `PR_CREATED` then `REWORK`. The "latest" per key is `REWORK`, which is correctly found. But if the second append fails (disk full, etc.), the latest would be `PR_CREATED`, which is also a candidate. So the logic is resilient to partial writes.

### Gaps / Not Yet Implemented

1. **`previousContext` in rework prompt**: The `ReworkPromptInput.previousContext` field exists but is always passed as `undefined` with the comment `// V1: no diff context yet`. A future version could pass `git diff` or `git log` output to give Claude context about what was previously implemented.

2. **No pagination**: All comment-fetching endpoints use `per_page=100` or `pagelen=100` or `limit=100` but never follow pagination links. PRs with >100 comments will have older comments silently dropped.

3. **No PR assignee/label**: The PR creation functions don't set assignees or labels. The memory mentions `feedback_pr_assignee.md` ("Always assign and label PRs") but this is not implemented in the current code.

4. **Azure DevOps**: Listed as a detected platform (`azure`) but explicitly excluded from PR creation and rework detection. Returns `undefined` silently.

5. **No rework for epic flow**: Rework is only supported for PR-based flow. Tickets delivered via epic merge (`DONE` status) never enter the rework queue, even if they have issues. This is by design (epic flow doesn't create PRs), but means rework is unavailable for teams using parent-based workflows.

6. **Bitbucket Server manual URL**: `buildManualPrUrl` returns `undefined` for Bitbucket Server -- no pre-filled URL is generated. Users just get "Branch pushed -- create a PR/MR manually."

7. **Comment author not tracked**: The rework pipeline doesn't filter by comment author. Bot comments, CI comments, and self-comments (Clancy's own comments, if any) could trigger rework. In practice Clancy doesn't post comments, but third-party bots on the PR could cause false rework triggers.

8. **No re-fetch of ticket description**: During rework, the ticket description comes from progress.txt (which only stores the summary, not the description). The full description is not re-fetched from the board API. This means the rework prompt has an empty description field.

### Dead Code

None identified. All imported functions are used. The `githubReviewSchema` and `githubReviewListSchema` in `src/schemas/github.ts` are defined and exported but not imported anywhere in the PR/rework flow -- they were likely intended for a review-state-based approach that was replaced by the comment-based approach. However, they may be used elsewhere in the codebase (e.g. the reviewer role).

### Documentation vs Implementation Mismatches

The documentation in `docs/roles/IMPLEMENTER.md`, `docs/guides/CONFIGURATION.md`, and `docs/guides/TROUBLESHOOTING.md` all accurately reflect the current implementation. No discrepancies found.
