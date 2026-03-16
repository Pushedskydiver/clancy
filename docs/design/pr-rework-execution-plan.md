# PR-Based Flow & QA Rework Loop -- Execution Plan

Exact changes required to fix bugs, implement design decisions, and ship the PR-based flow and rework loop. Grouped into parallelizable waves with complexity estimates and risks.

---

## Table of Contents

1. [Bug Fixes](#wave-1-bug-fixes)
2. [Core Enhancements](#wave-2-core-enhancements)
3. [Post-Rework Actions](#wave-3-post-rework-actions)
4. [Polish and Edge Cases](#wave-4-polish-and-edge-cases)
5. [Risk Assessment](#risk-assessment)
6. [Dependency Graph](#dependency-graph)

---

## Wave 1: Bug Fixes

All 8 bugs from the current-state audit, plus the "already exists" detection issue discovered during platform analysis. These can be worked in parallel.

### Bug 1: Double Progress Logging on Rework

**Problem:** `deliverViaPullRequest()` logs `PR_CREATED` or `PUSHED`, then `run()` logs `REWORK`. Two entries per rework cycle clutters progress.txt.

**File:** `src/scripts/once/once.ts`

**Change:**
- Add a `skipLog?: boolean` parameter to `deliverViaPullRequest()`.
- When `skipLog` is true, skip all `appendProgress()` calls inside `deliverViaPullRequest()`.
- In `run()` step 13, pass `skipLog: true` when `isRework` is true.
- The `run()` function already logs `REWORK` after calling `deliverViaPullRequest()` — that single entry is sufficient.

**Specific edits:**
```
deliverViaPullRequest() signature:
  BEFORE: async function deliverViaPullRequest(config, ticket, ticketBranch, targetBranch, startTime): Promise<boolean>
  AFTER:  async function deliverViaPullRequest(config, ticket, ticketBranch, targetBranch, startTime, skipLog = false): Promise<boolean>

Inside deliverViaPullRequest():
  Every appendProgress() call wrapped with: if (!skipLog) { appendProgress(...) }
  Console messages (warnings, success) still print regardless of skipLog.

In run() step 13:
  BEFORE: const delivered = await deliverViaPullRequest(config, ticket, ticketBranch, targetBranch, startTime);
  AFTER:  const delivered = await deliverViaPullRequest(config, ticket, ticketBranch, targetBranch, startTime, true);
```

**Tests to update:**
- `src/scripts/once/once.test.ts`: Verify rework path produces exactly 1 progress entry (REWORK), not 2.
- Add explicit test: "rework delivery does not double-log progress".

**Complexity:** Small
**Risk:** Low — the fallback (double-logging) was already working. Removing one entry is a strict simplification.

---

### Bug 2: Timestamps Use Local Time Instead of UTC

**Problem:** `formatTimestamp()` uses `getHours()`, `getMonth()`, etc. (local time). Progress entries written on different machines in different timezones produce inconsistent `since` values, causing rework detection to miss or duplicate comments.

**File:** `src/scripts/shared/progress/progress.ts`

**Change:**
```
BEFORE:
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');

AFTER:
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
```

**Tests to update:**
- `src/scripts/shared/progress/progress.test.ts`: Update `formatTimestamp` tests to expect UTC values. Mock `Date` with a known timezone offset to verify.

**Backward compatibility:**
- Existing progress.txt entries with local timestamps will have slightly incorrect `since` values. Acceptable — worst case: one extra or one missed rework check. Self-correcting on next cycle.

**Complexity:** Small
**Risk:** Low — existing entries are backward-compatible (parsed the same way).

---

### Bug 3: Rework Ticket Has Empty Description

**Problem:** Rework `FetchedTicket` has `description: ''`. The rework prompt says "Description:" with nothing below it. Claude lacks context about the original ticket purpose.

**File:** `src/scripts/once/once.ts`

**Change:**
- In `fetchReworkFromPrReview()`, use `entry.summary` as the description fallback.
- The summary is already stored in progress.txt and provides basic context.

```
BEFORE:
  const ticket: FetchedTicket = {
    key: entry.key,
    title: entry.summary,
    description: '',
    parentInfo: 'none',
    blockers: 'None',
  };

AFTER:
  const ticket: FetchedTicket = {
    key: entry.key,
    title: entry.summary,
    description: entry.summary,
    parentInfo: 'none',
    blockers: 'None',
  };
```

**Note:** This is a minimal fix. A fuller solution would re-fetch the ticket description from the board API, but that adds complexity (requires board-specific fetch by key, which doesn't exist for all providers). The summary-as-description approach is good enough for rework — the reviewer feedback itself provides the primary context.

**Tests to update:**
- `src/scripts/once/once.test.ts`: Update rework test assertions to expect description === summary instead of ''.

**Complexity:** Small
**Risk:** None

---

### Bug 4: Rework Detection Scope Too Narrow

**Problem:** Only `PR_CREATED` and `REWORK` statuses are scanned for rework candidates. Misses `PUSHED` (manual PR creation) and `PUSH_FAILED` (user may have pushed manually after failure).

**File:** `src/scripts/once/once.ts`

**Change:**
```
BEFORE:
  const prCreated = findEntriesWithStatus(process.cwd(), 'PR_CREATED');
  const reworked = findEntriesWithStatus(process.cwd(), 'REWORK');
  const candidates = [...prCreated, ...reworked];

AFTER:
  const prCreated = findEntriesWithStatus(process.cwd(), 'PR_CREATED');
  const reworked = findEntriesWithStatus(process.cwd(), 'REWORK');
  const pushed = findEntriesWithStatus(process.cwd(), 'PUSHED');
  const pushFailed = findEntriesWithStatus(process.cwd(), 'PUSH_FAILED');
  const candidates = [...prCreated, ...reworked, ...pushed, ...pushFailed];
```

**Note:** `PUSHED` and `PUSH_FAILED` candidates will usually fail the review state check (no open PR found) and silently return undefined. This is correct — the scan is best-effort. When a user manually creates a PR after a `PUSHED` or `PUSH_FAILED` status, the rework detection will find it.

**Tests to add:**
- "detects rework from PUSHED entry when PR was created manually"
- "detects rework from PUSH_FAILED entry after user manual push and PR"
- "PUSHED entry with no open PR returns undefined gracefully"

**Complexity:** Small
**Risk:** Low — additional candidates that have no open PR are silently skipped.

---

### Bug 5: PR Body Rework Instructions Not Collapsible

**Problem:** Rework instructions take up significant space in the PR body. Design decision: wrap in `<details>` block.

**File:** `src/scripts/shared/pull-request/pr-body/pr-body.ts`

**Change:**
```
BEFORE:
  lines.push('---');
  lines.push('**Rework instructions:** To request changes:');
  lines.push('- **Code comments** — leave inline comments on specific lines. These are always picked up automatically.');
  lines.push('- **General feedback** — reply with a comment starting with `Rework:` followed by what needs fixing. Comments without the `Rework:` prefix are treated as discussion.');
  lines.push('');
  lines.push("Example: `Rework: The form validation doesn't handle empty passwords`");

AFTER:
  lines.push('---');
  lines.push('<details>');
  lines.push('<summary><strong>Rework instructions</strong> (click to expand)</summary>');
  lines.push('');
  lines.push('To request changes:');
  lines.push('- **Code comments** — leave inline comments on specific lines. These are always picked up automatically.');
  lines.push('- **General feedback** — reply with a comment starting with `Rework:` followed by what needs fixing. Comments without the `Rework:` prefix are treated as discussion.');
  lines.push('');
  lines.push("Example: `Rework: The form validation doesn't handle empty passwords`");
  lines.push('');
  lines.push('</details>');
```

**Tests to update:**
- `src/scripts/shared/pull-request/pr-body/pr-body.test.ts`: Update rework instructions test to check for `<details>` wrapper.

**Complexity:** Small
**Risk:** None

---

### Bug 6: Bitbucket Server "Already Exists" Detection May Not Match

**Problem:** Bitbucket Server returns "Only one pull request may be open for a given source and target branch" on HTTP 409, but the detection checks for "already exists" in the body.

**File:** `src/scripts/shared/pull-request/bitbucket/bitbucket.ts`

**Change:**
```
BEFORE (in createServerPullRequest):
  (status, text) => status === 409 && text.includes('already exists'),

AFTER:
  (status, text) => status === 409 && (text.includes('already exists') || text.includes('Only one pull request')),
```

**Tests to add:**
- `src/scripts/shared/pull-request/bitbucket/bitbucket.test.ts`: "createServerPullRequest: 409 with 'Only one pull request' message detected as already-exists"

**Complexity:** Small
**Risk:** None

---

### Bug 7: Comment Author Not Filtered (Self-Triggering)

**Problem:** Clancy's own PR comments (planned post-rework comments) and bot comments could trigger rework. No author filtering exists.

**Files:**
- `src/scripts/shared/pull-request/github/github.ts`
- `src/scripts/shared/pull-request/gitlab/gitlab.ts`
- `src/scripts/shared/pull-request/bitbucket/bitbucket.ts`

**Change:** Add an `excludeAuthor?: string` parameter to all review state and comment fetch functions. Filter out comments by the authenticated user.

**GitHub:**
```
checkPrReviewState() and fetchPrReviewComments():
  Add parameter: excludeAuthor?: string
  Filter: inlineComments.filter(c => !excludeAuthor || c.user?.login !== excludeAuthor)
  Filter: convoComments.filter(c => !excludeAuthor || c.user?.login !== excludeAuthor)
```

**GitLab:**
```
checkMrReviewState() and fetchMrReviewComments():
  Add parameter: excludeAuthor?: string
  Filter: skip note if note.author?.username === excludeAuthor
```

**Bitbucket Cloud:**
```
checkPrReviewState() and fetchPrReviewComments():
  Add parameter: excludeAuthor?: string
  Filter: skip comment if c.user?.nickname === excludeAuthor || c.user?.uuid === excludeAuthor
```

**Bitbucket Server:**
```
checkServerPrReviewState() and fetchServerPrReviewComments():
  Add parameter: excludeAuthor?: string
  Filter: skip comment if comment.author?.slug === excludeAuthor
```

**Caller changes (once.ts):**
- Resolve the authenticated username for the git platform.
- GitHub: already have `resolveUsername(GITHUB_TOKEN)` — reuse it.
- GitLab/Bitbucket: add new resolution functions or pass token-derived username.
- Pass as `excludeAuthor` to all review/comment functions.

**Schema changes:**
- `src/schemas/github.ts`: Ensure `user.login` field is in PR comment schemas.
- `src/schemas/gitlab-mr.ts`: Add `author.username` to note schema if not present.
- `src/schemas/bitbucket-pr.ts`: Add `user.nickname` or `user.uuid` to comment schema if not present.

**Tests to add:**
- Per platform: "filters out comments by excludeAuthor"
- Per platform: "does not filter when excludeAuthor is undefined"

**Complexity:** Medium (touches 4 files + schemas + caller)
**Risk:** Low — excludeAuthor is optional, defaults to undefined (no filtering), backward compatible.

---

### Bug 8: Bitbucket Server Manual PR URL Missing

**Problem:** `buildManualPrUrl()` returns `undefined` for Bitbucket Server. Users get no clickable link.

**File:** `src/scripts/once/once.ts`

**Change:**
```
BEFORE:
  if (remote.host === 'bitbucket') {
    return `https://${remote.hostname}/${remote.workspace}/${remote.repoSlug}/pull-requests/new?source=${encodedTicket}&dest=${encodedTarget}`;
  }
  return undefined;

AFTER:
  if (remote.host === 'bitbucket') {
    return `https://${remote.hostname}/${remote.workspace}/${remote.repoSlug}/pull-requests/new?source=${encodedTicket}&dest=${encodedTarget}`;
  }
  if (remote.host === 'bitbucket-server') {
    return `https://${remote.hostname}/projects/${remote.projectKey}/repos/${remote.repoSlug}/pull-requests?create&sourceBranch=refs/heads/${encodedTicket}&targetBranch=refs/heads/${encodedTarget}`;
  }
  return undefined;
```

**Tests to add:**
- "buildManualPrUrl: Bitbucket Server returns pre-filled URL"

**Complexity:** Small
**Risk:** Low — the URL format may vary by Bitbucket Server version, but the standard `/pull-requests?create` pattern is widely supported (Bitbucket Server 5.0+).

---

## Wave 2: Core Enhancements

Design decisions that enhance the flow. Some depend on Wave 1 bug fixes.

### Enhancement 1: Connectivity Preflight Check

**Design decision 1:** Add `git ls-remote origin HEAD` as a warning-only check during preflight.

**File:** `src/scripts/shared/preflight/preflight.ts`

**Change:**
- After existing git repo check, add a connectivity check.
- Run `execFileSync('git', ['ls-remote', 'origin', 'HEAD'])` with a 5-second timeout.
- On failure: set `warning` field (not `error`) on the PreflightResult.
- Does NOT block — user may be working locally.

```
// After isGitRepo() check:
try {
  execFileSync('git', ['ls-remote', 'origin', 'HEAD'], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
} catch {
  warning = '⚠ Could not reach origin. PR creation and rework detection may fail.';
}
```

**PreflightResult type change (if warning not already there):**
```
type PreflightResult =
  | { ok: true; env: Record<string, string>; warning?: string }
  | { ok: false; error: string };
```

Check: the `warning` field already exists on PreflightResult (used for dirty working tree warning). If so, concatenate or use an array.

**Tests to add:**
- "preflight warns when git ls-remote fails"
- "preflight does not block when git ls-remote fails"
- "preflight succeeds silently when git ls-remote works"

**Complexity:** Small
**Risk:** Low — warning only, never blocks. The 5-second timeout prevents slow networks from stalling the entire flow.

---

### Enhancement 2: PR Number in Progress Log

**Design decision 9:** Add optional trailing field `pr:123` to progress format.

**Files:**
- `src/scripts/shared/progress/progress.ts`
- `src/types/remote.ts` (ProgressStatus — no change needed, it's the format not the type)
- `src/scripts/once/once.ts`

**Change to appendProgress:**
```
BEFORE:
  export function appendProgress(projectRoot, key, summary, status): void {
    ...
    const line = `${timestamp} | ${key} | ${summary} | ${status}\n`;
    ...
  }

AFTER:
  export function appendProgress(projectRoot, key, summary, status, prNumber?: number): void {
    ...
    const prSuffix = prNumber != null ? ` | pr:${prNumber}` : '';
    const line = `${timestamp} | ${key} | ${summary} | ${status}${prSuffix}\n`;
    ...
  }
```

**Change to parseProgressFile:**
```
BEFORE:
  entries.push({
    timestamp: parts[0]!,
    key: parts[1]!,
    summary: parts.slice(2, -1).join(' | '),
    status: parts[parts.length - 1]! as ProgressStatus,
  });

AFTER:
  const lastPart = parts[parts.length - 1]!;
  const prMatch = lastPart.match(/^pr:(\d+)$/);

  if (prMatch) {
    // Has PR number: status is second-to-last
    entries.push({
      timestamp: parts[0]!,
      key: parts[1]!,
      summary: parts.slice(2, -2).join(' | '),
      status: parts[parts.length - 2]! as ProgressStatus,
      prNumber: parseInt(prMatch[1], 10),
    });
  } else {
    // No PR number: status is last (backward compatible)
    entries.push({
      timestamp: parts[0]!,
      key: parts[1]!,
      summary: parts.slice(2, -1).join(' | '),
      status: lastPart as ProgressStatus,
    });
  }
```

**ProgressEntry type:**
```
BEFORE:
  type ProgressEntry = { timestamp, key, summary, status }

AFTER:
  type ProgressEntry = { timestamp, key, summary, status, prNumber?: number }
```

**Caller changes (once.ts):**
- In `deliverViaPullRequest()`: pass `pr.number` to `appendProgress()` when PR creation succeeds.
- In `run()` step 13 (rework): pass `prRework.prNumber` to `appendProgress()`.
- In `fetchReworkFromPrReview()`: use `entry.prNumber` if available instead of re-discovering PR number from API (optimization — skip the "find open PR" API call).

**Tests to add:**
- "appendProgress with prNumber includes pr:NNN suffix"
- "appendProgress without prNumber produces backward-compatible format"
- "parseProgressFile parses pr:NNN field"
- "parseProgressFile handles entries without pr:NNN"
- "parseProgressFile handles summaries containing pipe characters with pr:NNN"

**Complexity:** Medium
**Risk:** Low — trailing field is backward compatible. Old entries parse correctly (no pr: suffix detected).

---

### Enhancement 3: previousContext for Rework Prompts

**Design decision 11:** Populate `previousContext` with `git diff` of the branch vs target.

**Files:**
- `src/scripts/shared/git-ops/git-ops.ts` (new function)
- `src/scripts/once/once.ts`

**New function in git-ops.ts:**
```typescript
/**
 * Get the diff between the current branch and a target branch.
 * Returns the diff output, or undefined if the diff fails.
 * Truncated to maxLength characters to avoid oversized prompts.
 */
export function diffAgainstBranch(targetBranch: string, maxLength = 8000): string | undefined {
  try {
    const diff = execFileSync(
      'git', ['diff', `${targetBranch}...HEAD`, '--stat'],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 }
    ).trim();
    if (!diff) return undefined;
    return diff.length > maxLength ? diff.slice(0, maxLength) + '\n... (truncated)' : diff;
  } catch {
    return undefined;
  }
}
```

**Change in once.ts (step 12, rework path):**
```
BEFORE:
  previousContext: undefined, // V1: no diff context yet

AFTER:
  previousContext: diffAgainstBranch(targetBranch),
```

**Notes:**
- Uses `--stat` (summary) not full diff to avoid overwhelming the prompt.
- Truncated at 8000 chars (configurable) to stay within prompt size limits.
- Falls back to undefined on failure (same as current behavior).

**Tests to add:**
- `src/scripts/shared/git-ops/git-ops.test.ts`: "diffAgainstBranch returns stat output"
- "diffAgainstBranch returns undefined when diff fails"
- "diffAgainstBranch truncates long output"

**Complexity:** Small
**Risk:** Low — previousContext is optional. If diff fails, falls back to undefined (current behavior).

---

### Enhancement 4: PR Assignee and Labels

**Design decision 12:** Assign the authenticated user and add CLANCY_LABEL to the PR.

**Files:**
- `src/scripts/shared/pull-request/github/github.ts` (new function)
- `src/scripts/shared/pull-request/gitlab/gitlab.ts` (new function)
- `src/scripts/once/once.ts`

**GitHub: assignPullRequest()**
```typescript
export async function assignPullRequest(
  token: string,
  repo: string,
  prNumber: number,
  assignee: string,
  labels: string[],
  apiBase = GITHUB_API,
): Promise<void> {
  try {
    const body: Record<string, unknown> = { assignees: [assignee] };
    if (labels.length > 0) body.labels = labels;

    await fetch(`${apiBase}/repos/${repo}/issues/${prNumber}`, {
      method: 'PATCH',
      headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Best-effort
  }
}
```

**GitLab: assignMergeRequest()**
```typescript
export async function assignMergeRequest(
  token: string,
  apiBase: string,
  projectPath: string,
  mrIid: number,
  labels?: string,
): Promise<void> {
  try {
    const encodedPath = encodeURIComponent(projectPath);
    const body: Record<string, unknown> = { assignee_id: 0 }; // 0 = self
    if (labels) body.labels = labels;

    await fetch(`${apiBase}/projects/${encodedPath}/merge_requests/${mrIid}`, {
      method: 'PUT',
      headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Best-effort
  }
}
```

**Bitbucket Cloud/Server:** No assignee or label APIs for PRs. Skip.

**Caller changes (once.ts):**
- After successful PR creation, call the assign function.
- Pass CLANCY_LABEL from config.env if set.
- Best-effort — failure does not affect the flow.

**Complexity:** Small
**Risk:** Low — best-effort, separate API call after PR creation.

---

## Wave 3: Post-Rework Actions

These depend on Wave 1 (Bug 1 fix for clean logging) and Wave 2 (Enhancement 2 for PR number tracking).

### Action 1: Post-Rework PR Comment

**Design decision 4:** Leave a comment on the PR after pushing rework fixes.

**Files:**
- `src/scripts/shared/pull-request/github/github.ts` (new function)
- `src/scripts/shared/pull-request/gitlab/gitlab.ts` (new function)
- `src/scripts/shared/pull-request/bitbucket/bitbucket.ts` (new functions)
- `src/scripts/once/once.ts`

**New function per platform:**

```typescript
// GitHub
export async function postPrComment(
  token: string, repo: string, issueNumber: number,
  body: string, apiBase = GITHUB_API,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${apiBase}/repos/${repo}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
    return res.ok;
  } catch { return false; }
}

// GitLab
export async function postMrNote(
  token: string, apiBase: string, projectPath: string, mrIid: number,
  body: string,
): Promise<boolean> {
  try {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(
      `${apiBase}/projects/${encoded}/merge_requests/${mrIid}/notes`,
      {
        method: 'POST',
        headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
    return res.ok;
  } catch { return false; }
}

// Bitbucket Cloud
export async function postCloudPrComment(
  username: string, token: string, workspace: string, repoSlug: string,
  prId: number, text: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`,
      {
        method: 'POST',
        headers: { Authorization: basicAuth(username, token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { raw: text } }),
      },
    );
    return res.ok;
  } catch { return false; }
}

// Bitbucket Server
export async function postServerPrComment(
  token: string, apiBase: string, projectKey: string, repoSlug: string,
  prId: number, text: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${apiBase}/projects/${projectKey}/repos/${repoSlug}/pull-requests/${prId}/comments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      },
    );
    return res.ok;
  } catch { return false; }
}
```

**Comment body builder:**
```typescript
function buildReworkComment(feedbackCount: number, feedback: string[]): string {
  const summary = feedback.slice(0, 3).map(f => `- ${f.slice(0, 80)}`).join('\n');
  return `Rework pushed addressing ${feedbackCount} feedback item${feedbackCount !== 1 ? 's' : ''}.\n\n${summary}${feedback.length > 3 ? '\n- ...' : ''}`;
}
```

**Caller changes (once.ts):**
- After rework delivery, build comment and post via platform dispatch.
- Best-effort — failure logged but does not stop flow.

**Tests to add (per platform):**
- "postPrComment succeeds"
- "postPrComment returns false on error"

**Complexity:** Medium (4 new functions + caller wiring)
**Risk:** Low — all best-effort.

---

### Action 2: GitHub Re-Request Review

**Design decision 4:** Re-request review from the reviewer who left feedback.

**File:** `src/scripts/shared/pull-request/github/github.ts`

**New function:**
```typescript
export async function requestReview(
  token: string, repo: string, prNumber: number,
  reviewers: string[], apiBase = GITHUB_API,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${apiBase}/repos/${repo}/pulls/${prNumber}/requested_reviewers`,
      {
        method: 'POST',
        headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewers }),
      },
    );
    return res.ok;
  } catch { return false; }
}
```

**Reviewer extraction:**
- During `fetchPrReviewComments()`, collect unique `comment.user.login` values.
- Return alongside feedback comments (extend return type or use separate call).
- Alternative: add `reviewers: string[]` to the return from `fetchReworkFromPrReview()`.

**Caller changes (once.ts):**
- After rework delivery on GitHub, call `requestReview()` with collected reviewers.
- Best-effort.

**Complexity:** Small
**Risk:** Low — HTTP 422 if reviewer is not a collaborator (silently caught).

---

### Action 3: GitLab Resolve DiffNote Threads

**Design decision 4:** Resolve addressed DiffNote threads after rework.

**File:** `src/scripts/shared/pull-request/gitlab/gitlab.ts`

**New function:**
```typescript
export async function resolveDiscussions(
  token: string, apiBase: string, projectPath: string,
  mrIid: number, discussionIds: string[],
): Promise<void> {
  const encoded = encodeURIComponent(projectPath);
  for (const id of discussionIds) {
    try {
      await fetch(
        `${apiBase}/projects/${encoded}/merge_requests/${mrIid}/discussions/${id}/resolve`,
        {
          method: 'PUT',
          headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolved: true }),
        },
      );
    } catch {
      // Best-effort per discussion
    }
  }
}
```

**Discussion ID tracking:**
- During `fetchMrReviewComments()`, track which discussion IDs contained DiffNotes that triggered rework.
- Return alongside feedback comments.
- Extend return type: `{ comments: string[], discussionIds: string[] }`.

**Complexity:** Medium (return type change + new function + caller)
**Risk:** Low — resolving already-resolved threads is a no-op.

---

## Wave 4: Polish and Edge Cases

### Polish 1: Board Ticket Transition to In Review After Rework

**Current state:** `deliverViaPullRequest()` already transitions to `CLANCY_STATUS_REVIEW`. This works for both initial PR creation and rework because `deliverViaPullRequest()` is called in both paths.

**Status:** Already implemented. No change needed.

---

### Polish 2: Rework Prompt with previousContext

**Depends on:** Wave 2, Enhancement 3.

**File:** `src/scripts/shared/prompt/prompt.ts`

**Current state:** `buildReworkPrompt()` already handles `previousContext`:
```typescript
const previousSection = input.previousContext
  ? `\n\n## Previous Implementation\n\n\`\`\`\n${input.previousContext}\n\`\`\``
  : '';
```

**Status:** Already implemented in the prompt builder. Only needs the caller to provide the value (Wave 2, Enhancement 3).

---

### Polish 3: GitHub "Request Changes" Review State as Additional Signal

**Design decision 14:** Use GitHub's "Request Changes" review state as an ADDITIONAL signal alongside comment detection.

**File:** `src/scripts/shared/pull-request/github/github.ts`

**Change:**
- In `checkPrReviewState()`, fetch reviews: `GET /repos/{repo}/pulls/{number}/reviews`
- Check if any review has `state === 'CHANGES_REQUESTED'`
- If so, set `changesRequested = true` even if no inline/Rework: comments found.

```typescript
// Additional check: review state
const reviewsRes = await fetch(
  `${apiBase}/repos/${repo}/pulls/${pr.number}/reviews?per_page=10`,
  { headers },
);
if (reviewsRes.ok) {
  const reviews = await reviewsRes.json();
  const hasChangesRequested = Array.isArray(reviews) &&
    reviews.some((r: { state?: string }) => r.state === 'CHANGES_REQUESTED');
  if (hasChangesRequested) hasRework = true;
}
```

**Schema addition:**
- `src/schemas/github.ts`: Add `githubReviewListSchema` validation (may already exist — check `githubReviewSchema` and `githubReviewListSchema` mentioned in current-state as potentially unused).

**Tests to add:**
- "checkPrReviewState: CHANGES_REQUESTED review triggers rework"
- "checkPrReviewState: APPROVED review does not trigger rework"
- "checkPrReviewState: review fetch failure does not break flow"

**Complexity:** Small
**Risk:** Low — additional signal, not replacing existing detection. Reviews API is well-documented.

---

## Risk Assessment

### High-Impact Risks

```
Risk                              Mitigation                         Likelihood
────────────────────────────────────────────────────────────────────────────────
Author filtering breaks           excludeAuthor is optional,         Low
  legitimate rework               defaults to undefined. If
                                  username resolution fails,
                                  falls back to no filtering.

Post-rework comment triggers      Author filtering (Bug 7) must      Medium
  infinite rework loop             be implemented BEFORE
                                  post-rework comments (Action 1).
                                  Wave 1 before Wave 3.

Bitbucket Server URL format       URL pattern may vary by version.   Low
  doesn't match all versions      Tested on Bitbucket Server 7.0+.
                                  Fallback: "create PR manually"
                                  message still shown.

UTC timestamp migration breaks    Old entries with local time         Low
  since filtering for existing    will have slightly wrong since
  progress entries                values. Self-correcting: next
                                  cycle writes UTC, subsequent
                                  checks use correct values.
```

### Low-Impact Risks

```
Risk                              Mitigation                         Likelihood
────────────────────────────────────────────────────────────────────────────────
>100 comments on a PR             Pagination not implemented.        Very low
                                  PRs with 100+ inline comments
                                  are extremely rare.

previousContext diff too large    Truncated at 8000 chars.           Low
                                  Uses --stat (summary) not
                                  full diff.

GitLab discussion resolution      Best-effort. Failure to resolve    Low
  fails                           a thread doesn't break the flow.
                                  Worst case: reviewer sees
                                  "resolved" comment but thread
                                  is still open.
```

---

## Dependency Graph

```
Wave 1 (all parallel):
  Bug 1: Double logging fix         ─┐
  Bug 2: UTC timestamps              │
  Bug 3: Empty description           │
  Bug 4: Rework detection scope      │  No dependencies
  Bug 5: PR body collapsible         │  between these
  Bug 6: BB Server already-exists    │
  Bug 7: Author filtering           ─┤─── MUST complete before Wave 3
  Bug 8: BB Server manual URL        │
                                     │
Wave 2 (parallel, after Wave 1):     │
  Enhancement 1: Connectivity check  │  No deps on Wave 1
  Enhancement 2: PR number progress ─┤─── Depends on Bug 1 (clean logging)
  Enhancement 3: previousContext     │  No deps on Wave 1
  Enhancement 4: PR assignee/labels  │  No deps on Wave 1
                                     │
Wave 3 (after Wave 1 Bug 7):        │
  Action 1: Post-rework comment     ─┤─── Depends on Bug 7 (author filtering)
  Action 2: GitHub re-request review │    and Enhancement 2 (PR number)
  Action 3: GitLab resolve threads   │
                                     │
Wave 4 (after Wave 2+3):            │
  Polish 1: Already done             │
  Polish 2: Already done (needs E3)  │
  Polish 3: GitHub review state      │  Independent
```

### Recommended Implementation Order

```
1. Wave 1 bugs (all in parallel, one PR or multiple small PRs)
2. Wave 2 enhancements (parallel, after Wave 1 merged)
3. Wave 3 post-rework actions (after Wave 1 Bug 7 merged)
4. Wave 4 polish (after Wave 2+3)

Total estimated effort:
  Wave 1: 8 small changes, ~2-3 hours
  Wave 2: 4 medium changes, ~3-4 hours
  Wave 3: 3 medium changes, ~2-3 hours
  Wave 4: 1 small change, ~30 minutes

  Total: ~8-10 hours of implementation + testing
```

### Test Count Impact

```
Current tests: 230 (feature/pr-based-flow branch)

New tests from this plan:
  Wave 1: ~12 tests (bug fixes + edge cases)
  Wave 2: ~10 tests (new functions + parsing)
  Wave 3: ~10 tests (post-rework functions)
  Wave 4: ~3 tests (review state)

Estimated total after all waves: ~265 tests
```
