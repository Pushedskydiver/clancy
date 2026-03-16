# once.ts — Module Map & Extraction Plan

**File:** `src/scripts/once/once.ts`
**Total lines:** 1274 (+ 8 line main guard)
**Exports:** `run()` only
**Consumers:** None (entry point — invoked via main guard or esbuild bundle)

---

## Function Inventory

### 1. `sharedEnv(config)` — Lines 102–104

- **What:** Type-safe accessor for `config.env` (returns `SharedEnv`).
- **Lines:** 3
- **Exported:** No (private)
- **Dependencies:** `SharedEnv` type from env-schema
- **Called by:** `fetchReworkFromPrReview`, `deliverViaPullRequest`, `postReworkActions`, `resolveGitToken`, `attemptPrCreation`, `run` (max rework guard)
- **Extractable:** No — trivial one-liner, exists purely for type narrowing. Stays wherever `BoardConfig` is used. Would need to be duplicated or shared if functions move to separate files.

---

### 2. `FetchedTicket` type — Lines 108–118

- **What:** Intermediate type representing a normalised ticket from any board. Carries `key`, `title`, `description`, `parentInfo`, `blockers`, and optional Linear-specific fields.
- **Lines:** 11 (type definition)
- **Used by:** `fetchTicket`, `fetchReworkFromPrReview`, `transitionToStatus`, `deliverViaEpicMerge`, `deliverViaPullRequest`, `run`
- **Extractable:** Yes — should live in `src/types/` or in a shared `once/types.ts`. Many functions depend on it, so it becomes the key shared type across extracted modules.

---

### 3. `fetchTicket(config)` — Lines 122–195

- **What:** Board-dispatching function that fetches the next available ticket. Switches on `config.provider` to call Jira/GitHub/Linear fetch functions, then normalises the result into `FetchedTicket`.
- **Lines:** 74
- **Exported:** No (private)
- **Dependencies:** `fetchJiraTicket`, `buildAuthHeader`, `fetchGitHubIssue`, `resolveUsername`, `fetchLinearIssue`, `FetchedTicket`
- **Called by:** `run` (step 5, fresh ticket path)
- **Extractable:** Yes — clean extraction. Single caller, no state dependencies.

---

### 4. `fetchReworkFromPrReview(config)` — Lines 209–380

- **What:** Scans `progress.txt` for PR_CREATED/REWORK/PUSHED/PUSH_FAILED entries, then checks each candidate PR's review state on the detected remote. If changes are requested, fetches review comments and returns a rework payload.
- **Lines:** 172
- **Exported:** No (private)
- **Dependencies:** `findEntriesWithStatus`, `detectRemote`, `buildApiBaseUrl`, `resolveGitToken`, `computeTicketBranch`, `checkGitHubPrReviewState`, `checkGitLabMrReviewState`, `checkBitbucketPrReviewState`, `checkBitbucketServerPrReviewState`, `fetchGitHubPrReviewComments`, `fetchGitLabMrReviewComments`, `fetchBitbucketPrReviewComments`, `fetchBitbucketServerPrReviewComments`, `FetchedTicket`, `sharedEnv`
- **Called by:** `run` (step 5, rework detection)
- **Extractable:** Yes — largest function in the file. Clean extraction with `resolveGitToken` and `sharedEnv` as shared deps.

---

### 5. `pingBoard(config)` — Lines 384–400

- **What:** Board-dispatching ping — checks board connectivity before starting work.
- **Lines:** 17
- **Exported:** No (private)
- **Dependencies:** `pingJira`, `buildAuthHeader`, `pingGitHub`, `pingLinear`
- **Called by:** `run` (step 4)
- **Extractable:** Yes — simple dispatcher, no state.

---

### 6. `validateInputs(config)` — Lines 404–434

- **What:** Board-dispatching validation of user-provided env vars (JQL injection, repo format, team ID format).
- **Lines:** 31
- **Exported:** No (private)
- **Dependencies:** `isSafeJqlValue`, `isValidRepo`, `isValidTeamId`
- **Called by:** `run` (step 3)
- **Extractable:** Yes — simple dispatcher, no state.

---

### 7. `transitionToStatus(config, ticket, statusName)` — Lines 438–477

- **What:** Board-dispatching status transition (In Progress, Done, In Review).
- **Lines:** 40
- **Exported:** No (private)
- **Dependencies:** `transitionJiraIssue`, `buildAuthHeader`, `transitionLinearIssue`, `FetchedTicket`
- **Called by:** `deliverViaEpicMerge`, `deliverViaPullRequest`, `run` (step 11)
- **Extractable:** Yes — clean dispatcher pattern.

---

### 8. `resolveGitToken(config, remote)` — Lines 487–509

- **What:** Extracts the appropriate git host token from `SharedEnv` based on the detected remote platform.
- **Lines:** 23
- **Exported:** No (private)
- **Dependencies:** `sharedEnv`, `RemoteInfo`
- **Called by:** `fetchReworkFromPrReview`, `attemptPrCreation`, `postReworkActions`
- **Extractable:** Yes — shared utility for all PR/remote operations.

---

### 9. `attemptPrCreation(config, remote, ticketBranch, targetBranch, title, body)` — Lines 514–578

- **What:** Dispatches PR/MR creation to the correct platform (GitHub/GitLab/Bitbucket/Bitbucket Server).
- **Lines:** 65
- **Exported:** No (private)
- **Dependencies:** `resolveGitToken`, `buildApiBaseUrl`, `sharedEnv`, `createGitHubPr`, `createGitLabMr`, `createBitbucketPr`, `createBitbucketServerPr`, `RemoteInfo`
- **Called by:** `deliverViaPullRequest`
- **Extractable:** Yes — part of the PR creation cluster.

---

### 10. `buildManualPrUrl(remote, ticketBranch, targetBranch)` — Lines 583–604

- **What:** Constructs a browser URL for manually creating a PR/MR when API creation fails or no token is available.
- **Lines:** 22
- **Exported:** No (private)
- **Dependencies:** `RemoteInfo` (type only)
- **Called by:** `deliverViaPullRequest`
- **Extractable:** Yes — pure function, zero side effects.

---

### 11. `deliverViaEpicMerge(config, ticket, ticketBranch, targetBranch)` — Lines 611–658

- **What:** Epic/parent delivery path — squash merges the ticket branch into the target (epic) branch locally, deletes the ticket branch, transitions ticket to Done, logs to progress.
- **Lines:** 48
- **Exported:** No (private)
- **Dependencies:** `checkout`, `squashMerge`, `deleteBranch`, `closeIssue`, `transitionToStatus`, `appendProgress`, `FetchedTicket`, ANSI utils
- **Called by:** `run` (step 13, hasParent path)
- **Extractable:** Yes — self-contained delivery strategy.

---

### 12. `deliverViaPullRequest(config, ticket, ticketBranch, targetBranch, startTime, skipLog?)` — Lines 665–786

- **What:** PR delivery path — pushes the ticket branch to remote, attempts PR/MR creation, handles fallbacks (manual URL, no remote), transitions to In Review, logs to progress.
- **Lines:** 122
- **Exported:** No (private)
- **Dependencies:** `pushBranch`, `detectRemote`, `buildPrBody`, `attemptPrCreation`, `buildManualPrUrl`, `appendProgress`, `checkout`, `transitionToStatus`, `formatDuration`, `sharedEnv`, ANSI utils
- **Called by:** `run` (step 13, no-parent path and rework path)
- **Extractable:** Yes — self-contained delivery strategy, though large.

---

### 13. `buildReworkComment(feedback)` — Lines 796–803

- **What:** Builds a `[clancy]`-prefixed comment summarising addressed rework feedback for posting on the PR.
- **Lines:** 8
- **Exported:** No (private)
- **Dependencies:** None
- **Called by:** `postReworkActions`
- **Extractable:** Yes — pure function.

---

### 14. `postReworkActions(config, prNumber, feedback, discussionIds?, reviewers?)` — Lines 810–929

- **What:** After rework push: posts a summary comment on the PR, resolves GitLab discussion threads, re-requests GitHub reviews. All best-effort.
- **Lines:** 120
- **Exported:** No (private)
- **Dependencies:** `detectRemote`, `resolveGitToken`, `buildApiBaseUrl`, `sharedEnv`, `buildReworkComment`, `postGitHubPrComment`, `postMrNote`, `postCloudPrComment`, `postServerPrComment`, `resolveDiscussions`, `requestGitHubReview`, `RemoteInfo`
- **Called by:** `run` (step 13, rework path)
- **Extractable:** Yes — part of the rework cluster.

---

### 15. `run(argv)` — Lines 943–1266

- **What:** Main orchestrator — full ticket lifecycle: preflight, detect board, validate, ping, check rework, fetch ticket, feasibility, set up branches, transition In Progress, invoke Claude, deliver (merge or PR), log, notify.
- **Lines:** 324
- **Exported:** Yes (`export async function`)
- **Dependencies:** Everything above + `runPreflight`, `detectBoard`, `checkFeasibility`, `formatDuration`, `computeTicketBranch`, `computeTargetBranch`, `ensureBranch`, `fetchRemoteBranch`, `checkout`, `currentBranch`, `diffAgainstBranch`, `buildPrompt`, `buildReworkPrompt`, `invokeClaudeSession`, `sendNotification`, `appendProgress`, `countReworkCycles`, ANSI utils
- **Called by:** Main guard (line 1269–1274)
- **Extractable:** This IS the orchestrator — it stays, but should shrink dramatically when helpers are extracted.

---

## Current Dependency Graph (Internal)

```
run()
├── validateInputs()
├── pingBoard()
├── fetchReworkFromPrReview()
│   ├── resolveGitToken()
│   └── sharedEnv()
├── fetchTicket()
├── sharedEnv()               (max rework guard)
├── deliverViaEpicMerge()
│   └── transitionToStatus()
├── deliverViaPullRequest()
│   ├── attemptPrCreation()
│   │   ├── resolveGitToken()
│   │   └── sharedEnv()
│   ├── buildManualPrUrl()
│   ├── transitionToStatus()
│   └── sharedEnv()
└── postReworkActions()
    ├── resolveGitToken()
    ├── buildReworkComment()
    └── sharedEnv()
```

---

## Proposed Module Extraction

### Module 1: `src/scripts/once/types.ts`

**Functions/types that move here:**
- `FetchedTicket` type

**Public API:** `FetchedTicket`
**Estimated lines:** ~15
**Dependencies:** None
**Rationale:** Shared type used by nearly every other module. Must be extracted first to avoid circular deps.

---

### Module 2: `src/scripts/once/fetch-ticket.ts`

**Functions that move here:**
- `fetchTicket(config)`

**Public API:** `fetchTicket(config: BoardConfig): Promise<FetchedTicket | undefined>`
**Estimated lines:** ~85 (including imports)
**Dependencies:** `FetchedTicket` (from types.ts), board modules (jira, github, linear), `BoardConfig`
**Rationale:** Clean board-dispatching function with a single caller. No shared state.

---

### Module 3: `src/scripts/once/board-ops.ts`

**Functions that move here:**
- `pingBoard(config)`
- `validateInputs(config)`
- `transitionToStatus(config, ticket, statusName)`
- `sharedEnv(config)` (exported from here, consumed by other modules)

**Public API:**
- `pingBoard(config): Promise<{ok: boolean; error?: string}>`
- `validateInputs(config): string | undefined`
- `transitionToStatus(config, ticket, statusName): Promise<void>`
- `sharedEnv(config): SharedEnv`

**Estimated lines:** ~110 (including imports)
**Dependencies:** `FetchedTicket` (from types.ts), board modules (jira, github, linear), `BoardConfig`, `SharedEnv`
**Rationale:** Three small board-dispatching functions that share the same pattern and imports. `sharedEnv` is trivial but needed by multiple modules — exporting it from here avoids duplication.

---

### Module 4: `src/scripts/once/git-token.ts`

**Functions that move here:**
- `resolveGitToken(config, remote)`

**Public API:** `resolveGitToken(config: BoardConfig, remote: RemoteInfo): {token: string; username?: string} | undefined`
**Estimated lines:** ~35 (including imports)
**Dependencies:** `sharedEnv` (from board-ops.ts), `RemoteInfo` type
**Rationale:** Used by three separate modules (rework detection, PR creation, post-rework actions). Must be standalone to avoid circular deps.

---

### Module 5: `src/scripts/once/pr-creation.ts`

**Functions that move here:**
- `attemptPrCreation(config, remote, ticketBranch, targetBranch, title, body)`
- `buildManualPrUrl(remote, ticketBranch, targetBranch)`

**Public API:**
- `attemptPrCreation(...): Promise<PrCreationResult | undefined>`
- `buildManualPrUrl(...): string | undefined`

**Estimated lines:** ~100 (including imports)
**Dependencies:** `resolveGitToken` (from git-token.ts), `sharedEnv` (from board-ops.ts), `buildApiBaseUrl`, `detectRemote`, platform-specific PR creators, `RemoteInfo`, `PrCreationResult`
**Rationale:** PR creation logic is a coherent unit. `buildManualPrUrl` is only used alongside `attemptPrCreation`.

---

### Module 6: `src/scripts/once/deliver.ts`

**Functions that move here:**
- `deliverViaEpicMerge(config, ticket, ticketBranch, targetBranch)`
- `deliverViaPullRequest(config, ticket, ticketBranch, targetBranch, startTime, skipLog?)`

**Public API:**
- `deliverViaEpicMerge(...): Promise<void>`
- `deliverViaPullRequest(...): Promise<boolean>`

**Estimated lines:** ~195 (including imports)
**Dependencies:** `FetchedTicket` (from types.ts), `transitionToStatus` (from board-ops.ts), `sharedEnv` (from board-ops.ts), `attemptPrCreation` + `buildManualPrUrl` (from pr-creation.ts), git-ops, progress, format, ANSI, `closeIssue`, `buildPrBody`
**Rationale:** The two delivery strategies are a natural pair — they share `transitionToStatus`, `appendProgress`, `checkout`, and the same caller contract. `deliverViaPullRequest` is the largest non-`run` function (122 lines) but splitting it further would create an awkward half-function boundary.

---

### Module 7: `src/scripts/once/rework.ts`

**Functions that move here:**
- `fetchReworkFromPrReview(config)`
- `postReworkActions(config, prNumber, feedback, discussionIds?, reviewers?)`
- `buildReworkComment(feedback)`

**Public API:**
- `fetchReworkFromPrReview(config): Promise<{ticket, feedback, prNumber, discussionIds?, reviewers?} | undefined>`
- `postReworkActions(config, prNumber, feedback, discussionIds?, reviewers?): Promise<void>`

**Estimated lines:** ~320 (including imports)
**Dependencies:** `FetchedTicket` (from types.ts), `resolveGitToken` (from git-token.ts), `sharedEnv` (from board-ops.ts), `computeTicketBranch`, `detectRemote`, `buildApiBaseUrl`, `findEntriesWithStatus`, all platform-specific PR review state/comment functions, `RemoteInfo`
**Rationale:** Rework detection and post-rework actions are a self-contained lifecycle. `buildReworkComment` is a private helper within this module (not exported). This is the largest extractable module because it contains two 120+ line functions that share the same platform-dispatching pattern.

---

### Module 8: `src/scripts/once/once.ts` (reduced orchestrator)

**What remains:**
- `run(argv)` function (exported)
- Main guard (lines 1269–1274)

**Estimated lines:** ~180–200 (down from 1274)
**Dependencies:** All 7 modules above + shared utilities (preflight, env-schema, feasibility, branch, claude-cli, prompt, git-ops, progress, format, notify, ANSI)

**The `run()` function would become:**
1. Preflight + detect board + validate + ping (~30 lines)
2. Rework check + fetch ticket (~25 lines)
3. Compute branches + dry-run gate + print info (~30 lines)
4. Feasibility check (~15 lines)
5. Git branch setup (~15 lines)
6. Transition + prompt + Claude invocation (~20 lines)
7. Deliver + log + notify (~30 lines)
8. Error handler (~15 lines)

---

## Dependency Flow (Post-Extraction)

```
types.ts              (no deps on other once/ modules)
    ↑
board-ops.ts          (depends on: types)
    ↑
git-token.ts          (depends on: board-ops)
    ↑
pr-creation.ts        (depends on: git-token, board-ops)
    ↑
fetch-ticket.ts       (depends on: types)
    ↑
rework.ts             (depends on: types, git-token, board-ops)
    ↑
deliver.ts            (depends on: types, board-ops, pr-creation)
    ↑
once.ts               (depends on: all of the above)
```

No circular dependencies. The graph is a clean DAG.

---

## Coupling Notes

### Tightly coupled pairs (extract together or not at all)

| Pair | Reason |
|---|---|
| `attemptPrCreation` + `buildManualPrUrl` | Always used together in `deliverViaPullRequest`. Splitting them across modules would scatter PR creation logic. |
| `fetchReworkFromPrReview` + `postReworkActions` | Same platform-dispatching pattern, same imports, same lifecycle stage. |
| `deliverViaEpicMerge` + `deliverViaPullRequest` | Both are delivery strategies selected by `run()`. Share `transitionToStatus` and `appendProgress` patterns. |

### Cross-cutting concerns

| Concern | Where it appears |
|---|---|
| `sharedEnv(config)` | 6 call sites across 5 functions. Must be importable by all modules. Trivial (3 lines) but essential for type narrowing. Export from `board-ops.ts`. |
| Platform switch dispatching | `fetchReworkFromPrReview`, `postReworkActions`, `attemptPrCreation`, `pingBoard`, `validateInputs`, `transitionToStatus`, `fetchTicket`. All follow `switch (config.provider)` or `switch (remote.host)`. This is the dominant pattern — not worth abstracting further since each case has different args. |
| `process.cwd()` | Used in `appendProgress` and `findEntriesWithStatus` calls. Always passed literally. Not a coupling concern. |
| ANSI formatting (`bold`, `dim`, `green`, `red`, `yellow`) | Used in `run()`, `deliverViaEpicMerge`, `deliverViaPullRequest`. Console output stays co-located with the functions that produce it. |

### Functions that are NOT worth extracting

| Function | Reason |
|---|---|
| `sharedEnv` | 3-line type-narrowing helper. Re-export from `board-ops.ts` rather than its own file. |
| `buildReworkComment` | 8-line pure function. Keep as private helper inside `rework.ts`. |

---

## `sharedEnv()` Usage Map

| Call site | Function | Purpose |
|---|---|---|
| Line 226 | `fetchReworkFromPrReview` | Read `CLANCY_GIT_PLATFORM` |
| Line 240 | `fetchReworkFromPrReview` | Read `CLANCY_GIT_API_URL` |
| Line 491 | `resolveGitToken` | Access all git host tokens |
| Line 525 | `attemptPrCreation` | Read `CLANCY_GIT_API_URL` |
| Line 695 | `deliverViaPullRequest` | Read `CLANCY_GIT_PLATFORM` |
| Line 817 | `postReworkActions` | Read `CLANCY_GIT_PLATFORM` |
| Line 831 | `postReworkActions` | Read `CLANCY_GIT_API_URL` |
| Line 1038 | `run` | Read `CLANCY_MAX_REWORK` |

---

## Summary

| Module | Lines (est.) | Functions | Key responsibility |
|---|---|---|---|
| `types.ts` | 15 | 0 (1 type) | Shared `FetchedTicket` type |
| `fetch-ticket.ts` | 85 | 1 | Board-dispatched ticket fetch |
| `board-ops.ts` | 110 | 4 | Ping, validate, transition, sharedEnv |
| `git-token.ts` | 35 | 1 | Resolve git host credentials |
| `pr-creation.ts` | 100 | 2 | Create PR/MR + manual URL fallback |
| `deliver.ts` | 195 | 2 | Epic merge + PR delivery strategies |
| `rework.ts` | 320 | 3 | Rework detection + post-rework actions |
| `once.ts` (reduced) | 200 | 1 | Orchestrator (`run`) + main guard |
| **Total** | **~1060** | **14** | — |

The total is slightly less than 1274 because duplicate imports collapse and some inline comments consolidate. The orchestrator (`run`) drops from 324 lines to approximately 180 lines — still substantial, but each step is now a single function call rather than inline logic.
