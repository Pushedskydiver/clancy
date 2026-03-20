# Team Readiness (v0.8.0) — Design Document

## Problem

Clancy supports three boards (Jira, GitHub Issues, Linear) and runs as a solo agent. Teams adopting Clancy hit three walls:

1. **Board coverage gaps.** Shortcut, Notion, and Azure DevOps users cannot use Clancy at all. Each new board requires implementing 11 Board methods against a different API surface — different auth, different status models, different parent/child mechanisms.
2. **No multi-agent awareness.** Two Clancy instances can pick up the same ticket simultaneously because there is no "In Progress" claim check. No visibility into quality trends (how many rework cycles, CI pass rates, review turnaround).
3. **No operational guardrails.** AFK sessions run at 3am with no desktop notification when they finish, no quiet hours to pause during business hours, and no way to detect when installed hooks/scripts have drifted from the published package version.

v0.8.0 addresses all three: expand the board ecosystem, add team coordination primitives, and ship three new hooks.

---

## Board Ecosystem

### Shortcut

**API overview:**
- REST API v3 (`https://api.app.shortcut.com/api/v3/`)
- Auth: `Shortcut-Token` header with API token
- Rate limit: 200 requests per minute per token
- Pagination: cursor-based (`next` URL in response)

**Board method mapping:**

| Board method | Shortcut API | Notes |
|---|---|---|
| `ping()` | `GET /api/v3/member-info` | Returns authenticated member; 200 = success |
| `validateInputs()` | Local check | Validate `SHORTCUT_API_TOKEN` and `SHORTCUT_WORKSPACE` are non-empty |
| `fetchTickets()` | `POST /stories/search` | Filter by `workflow_state_id`, `label_name`, `owner_ids`. Excludes PRs (Shortcut stories only). Map `story.id` to key as `sc-{id}` |
| `fetchTicket()` | Delegates to `fetchTickets()[0]` | Same pattern as existing boards |
| `fetchBlockerStatus()` | `GET /stories/{id}` | Check `story.blocked` boolean flag + `story_links` with `verb: "is blocked by"` |
| `fetchChildrenStatus()` | `GET /epics/{id}/stories` | Shortcut epics own stories directly. Count stories not in "Done" state type. Also search story descriptions for `Epic: {key}` text convention |
| `transitionTicket()` | `PUT /stories/{id}` | Set `workflow_state_id` — resolve state name to ID via `GET /workflows` (cached per process) |
| `ensureLabel()` | `GET /labels` + `POST /labels` | Search by name, create if missing |
| `addLabel()` | `PUT /stories/{id}` | Append to `label_ids` array |
| `removeLabel()` | `PUT /stories/{id}` | Filter from `label_ids` array |
| `sharedEnv()` | Return env object | Standard pattern |

**Key differences from existing boards:**
- **Workflow states are per-workflow, not per-project.** Must resolve workflow ID first via `GET /workflows`, then map state names to IDs. Cache the workflow→state mapping per process.
- **Story IDs are numeric.** Key format: `sc-{id}` (similar to GitHub's `#{number}` pattern).
- **Epics are first-class.** Native `GET /epics/{id}/stories` endpoint — no JQL or body-text search needed for the primary path. `Epic: {key}` text convention used as fallback for cross-platform compatibility.
- **Labels are workspace-scoped** (not project-scoped). Single namespace, no team/workspace distinction like Linear.
- **Blockers use the `blocked` boolean flag** on the story object, plus `story_links` with verb `"is blocked by"` for specific blocker identification.

**Pipeline labels:** Shortcut labels are plain string labels on stories. `ensureLabel` checks `GET /labels`, creates via `POST /labels` if missing. `addLabel`/`removeLabel` update the story's `label_ids` array via `PUT /stories/{id}`.

**Env vars:**
```
SHORTCUT_API_TOKEN    # Required — API token
SHORTCUT_WORKFLOW     # Optional — workflow name (default: auto-detect first workflow)
CLANCY_SC_STATUS      # Optional — status name filter (default: "Unstarted")
```

---

### Notion

**API overview:**
- REST API (2022-06-28 version, `https://api.notion.com/v1/`)
- Auth: `Bearer` token (internal integration token) + `Notion-Version: 2022-06-28` header
- Rate limit: 3 requests per second per integration
- Pagination: cursor-based (`next_cursor` / `has_more`)

**Board method mapping:**

| Board method | Notion API | Notes |
|---|---|---|
| `ping()` | `GET /users/me` | Returns bot user; 200 = success |
| `validateInputs()` | Local check | Validate `NOTION_TOKEN` and `NOTION_DATABASE_ID` are non-empty, database ID is valid UUID |
| `fetchTickets()` | `POST /databases/{id}/query` | Filter by status property (select/status type) + assignee (people type) + label (multi_select). Map page ID to key as `notion-{short-id}` (first 8 chars of UUID) |
| `fetchTicket()` | Delegates to `fetchTickets()[0]` | Standard pattern |
| `fetchBlockerStatus()` | `POST /databases/{id}/query` | Search for relation properties linking to the ticket with a "blocks" relation, OR parse page body for `Blocked by notion-{id}` text |
| `fetchChildrenStatus()` | `POST /databases/{id}/query` | Filter by parent relation property. Count pages not in "Done" status. Also search page bodies for `Epic: {key}` text convention |
| `transitionTicket()` | `PATCH /pages/{id}` | Update status property value |
| `ensureLabel()` | No-op | Notion multi_select options are auto-created when first used |
| `addLabel()` | `PATCH /pages/{id}` | Append to multi_select property array |
| `removeLabel()` | `PATCH /pages/{id}` | Filter from multi_select property array |
| `sharedEnv()` | Return env object | Standard pattern |

**Key differences from existing boards:**
- **Schema is user-defined.** Notion databases have custom properties. Clancy needs to know which property is "Status", which is "Assignee", which is "Labels". Convention-based defaults with env var overrides.
- **Rate limit is aggressive** (3 req/s). All API calls need retry-with-backoff. Existing boards tolerate transient failures but don't retry — Notion requires it.
- **No native ticket key.** Pages have UUIDs, not human-readable keys. Use `notion-{first-8-chars}` as the key, with the full UUID stored in `issueId` for API calls.
- **Parent/child via relations.** Notion uses relation properties to link pages. The relation property name is configurable via `CLANCY_NOTION_PARENT_PROP` (default: `"Parent"` or `"Epic"`).
- **Blockers via relations or body text.** No native blocker concept — use a relation property or body text convention (`Blocked by notion-{id}`), matching the GitHub body-parsing pattern.
- **Status is a property type.** Notion has a dedicated "Status" property type (with "To-do", "In progress", "Complete" groups) since 2022. Fall back to "Select" property type for older databases.

**Pipeline labels:** Notion multi_select properties auto-create options on first use, so `ensureLabel` is a no-op (like Jira). `addLabel`/`removeLabel` use `PATCH /pages/{id}` to update the configured multi_select property.

**Env vars:**
```
NOTION_TOKEN           # Required — internal integration token
NOTION_DATABASE_ID     # Required — database UUID
CLANCY_NOTION_STATUS   # Optional — status property name (default: "Status")
CLANCY_NOTION_ASSIGNEE # Optional — assignee property name (default: "Assignee")
CLANCY_NOTION_LABELS   # Optional — labels property name (default: "Labels")
CLANCY_NOTION_PARENT   # Optional — parent relation property name (default: "Epic")
```

---

### Azure DevOps

**API overview:**
- REST API v7.1 (`https://dev.azure.com/{org}/{project}/_apis/`)
- Auth: Basic auth with PAT (empty username, PAT as password) — same pattern as Bitbucket
- Rate limit: per-user throttling with `Retry-After` header
- Pagination: `$top` / `$skip` or continuation token

**Board method mapping:**

| Board method | Azure DevOps API | Notes |
|---|---|---|
| `ping()` | `GET /_apis/projects/{project}?api-version=7.1` | Returns project; 200 = success |
| `validateInputs()` | Local check | Validate `AZDO_ORG`, `AZDO_PROJECT`, `AZDO_PAT` are non-empty |
| `fetchTickets()` | `POST /_apis/wit/wiql?api-version=7.1` | WIQL query filtering by `[System.State]`, `[System.AssignedTo]`, `[System.Tags]`. Returns work item IDs, then batch fetch details via `GET /_apis/wit/workitems?ids={ids}` |
| `fetchTicket()` | Delegates to `fetchTickets()[0]` | Standard pattern |
| `fetchBlockerStatus()` | `GET /_apis/wit/workitems/{id}?$expand=relations` | Check relations with `System.LinkTypes.Dependency-Reverse` (predecessor) link type |
| `fetchChildrenStatus()` | `POST /_apis/wit/wiql` | WIQL: `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = {parentId} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward'`. Count children not in "Done"/"Closed" state. Also search descriptions for `Epic: {key}` text convention |
| `transitionTicket()` | `PATCH /_apis/wit/workitems/{id}?api-version=7.1` | JSON Patch operation: `[{ "op": "replace", "path": "/fields/System.State", "value": "Active" }]` |
| `ensureLabel()` | No-op | Azure DevOps tags are auto-created when applied to work items |
| `addLabel()` | `PATCH /_apis/wit/workitems/{id}` | JSON Patch: add to `System.Tags` field (semicolon-separated string) |
| `removeLabel()` | `PATCH /_apis/wit/workitems/{id}` | JSON Patch: remove from `System.Tags` string |
| `sharedEnv()` | Return env object | Standard pattern |

**Key differences from existing boards:**
- **WIQL query language.** Similar to Jira's JQL but SQL-like syntax. `fetchTickets` and `fetchChildrenStatus` use WIQL POST endpoint, not REST filters.
- **Two-step fetch.** WIQL returns work item IDs only. A second `GET /workitems?ids=` call fetches details. Batch up to 200 IDs per request.
- **Tags, not labels.** Azure DevOps uses `System.Tags` — a semicolon-separated string field, not an array. Parse and rebuild on add/remove.
- **JSON Patch for updates.** All work item updates use RFC 6902 JSON Patch format, not JSON body.
- **Work item types vary.** "User Story", "Task", "Bug", "Feature", "Epic" are all work item types. Fetch should filter by configurable type(s) or accept all.
- **Hierarchy is native.** Parent/child links use `System.LinkTypes.Hierarchy-Forward` / `Hierarchy-Reverse`. Stronger than Jira's epic link but similar concept.
- **Auth header format:** `Basic ${base64(':' + PAT)}` (empty username, colon, PAT — base64 encoded). Same pattern as Bitbucket.

**Pipeline labels:** Azure DevOps tags are auto-created when applied (like Jira), so `ensureLabel` is a no-op. `addLabel`/`removeLabel` parse and rebuild the semicolon-separated `System.Tags` string via JSON Patch.

**Env vars:**
```
AZDO_ORG        # Required — organization name
AZDO_PROJECT    # Required — project name
AZDO_PAT        # Required — personal access token
CLANCY_AZDO_STATUS    # Optional — state filter (default: "New")
CLANCY_AZDO_WIT       # Optional — work item type filter (default: all types)
```

---

## Board Auto-Detection

**Problem:** During `/clancy:init`, users must select their board from a list. With 6 boards, auto-detection reduces friction.

**Approach:** Detect from env vars already set in `.clancy/.env`. Each board has unique required vars that don't overlap:

| Board | Detection signal |
|---|---|
| Jira | `JIRA_BASE_URL` present |
| GitHub | `GITHUB_REPO` present (and no other board vars) |
| Linear | `LINEAR_API_KEY` present |
| Shortcut | `SHORTCUT_API_TOKEN` present |
| Notion | `NOTION_DATABASE_ID` present |
| Azure DevOps | `AZDO_ORG` present |

**Implementation:** Extend the existing `detectBoard()` function in `src/scripts/shared/env-schema/env-schema.ts` to recognise the three new boards. The current function uses priority ordering (Jira > GitHub > Linear); extend to include Shortcut, Notion, and Azure DevOps. If multiple board signals are present, fall back to the prompt (consistent with the existing priority approach — new boards are lower priority than existing ones). Used by:
- `init.md` workflow — skip board selection prompt if detected
- `settings.md` workflow — show detected board
- `doctor.md` workflow — validate detected board config

**Conflict resolution:** If multiple board signals are present, return `undefined` and fall back to the prompt. This handles misconfigured environments gracefully.

**Files changed:**
- `src/scripts/shared/env-schema/env-schema.ts` — extend `detectBoard()` with new board signals, add new board env schemas (`shortcutEnvSchema`, `notionEnvSchema`, `azdoEnvSchema`), extend `BoardConfig` union
- `src/schemas/env.ts` — add new board env vars to shared schema
- `src/roles/setup/workflows/init.md` — use `detectBoard()` before prompting
- `src/roles/setup/workflows/settings.md` — show detected board

---

## Team Features

### Ticket Claim Check

**What it does:** Before picking up a ticket, check if another agent or human has already started working on it. Skip tickets whose board status is "In Progress" (or the board's equivalent).

**Implementation approach:** The existing `fetchCandidates()` in `fetch-ticket.ts` already filters by a "To Do" / "Unstarted" status. The claim check is a second guard: after fetching candidates, verify each candidate's current status has not changed to an in-progress state between the time the query ran and pickup. This handles the race where two AFK instances query simultaneously.

For each board:
- **Jira:** WIQL already filters by status. Add a re-fetch of the single ticket before pickup to confirm status has not changed. Check `fields.status.name` is not in the "In Progress" category.
- **GitHub:** Issues don't have native status beyond open/closed. Use assignee check — if someone else is assigned, skip. Also check for an "in progress" label convention.
- **Linear:** State type `"started"` means in-progress. The existing fetch filters by `"unstarted"` state type, which already excludes in-progress tickets. Add a re-fetch guard for race condition.
- **Shortcut:** Check `workflow_state` is in the "Unstarted" category, not "Started".
- **Notion:** Check status property is not in the "In progress" group.
- **Azure DevOps:** Check `System.State` is not "Active" or "Resolved".

**Files changed:**
- `src/scripts/once/fetch-ticket/fetch-ticket.ts` — add `isClaimedByAnother()` check in the candidate loop, between blocker check and pickup
- Board-specific `fetchTickets()` functions — ensure they return status/state info in `FetchedTicket`
- `src/scripts/once/types/types.ts` — add optional `status?: string` field to `FetchedTicket`

---

### Quality Feedback Tracking

**What it does:** Track quality metrics per ticket over time: rework cycles (how many times a PR was sent back), CI pass rate on first delivery, verification gate failures. Persisted to `.clancy/quality.json`.

**Implementation approach:** Write a `QualityTracker` module that appends entries after key events:

```
{
  "tickets": {
    "PROJ-123": {
      "reworkCycles": 2,
      "verificationRetries": 1,
      "ciPassedOnFirstTry": false,
      "deliveredAt": "2026-03-20T10:30:00Z",
      "duration": 1200
    }
  },
  "summary": {
    "totalTickets": 45,
    "avgReworkCycles": 0.8,
    "firstTryCiPassRate": 0.72,
    "avgDuration": 980
  }
}
```

Hook points (all within existing once orchestrator phases):
- **Verification gate failure** — increment `verificationRetries` (phase: verify)
- **Rework detection** — increment `reworkCycles` (phase: rework)
- **PR creation** — record `ciPassedOnFirstTry` based on verification gate result (phase: deliver)
- **Ticket completion** — finalise entry with duration (phase: deliver)

The summary is recomputed on each write. Session report (`report.ts`) reads `quality.json` to include quality trends.

**Files changed:**
- `src/scripts/once/quality/quality.ts` — new module: `QualityTracker` with `recordVerificationFailure()`, `recordRework()`, `recordDelivery()`, `getSummary()`
- `src/scripts/once/phases/` — relevant phases call quality tracker
- `src/scripts/afk/report/report.ts` — include quality summary in session report

---

### Desktop Notification Hook

**What it does:** Send a native desktop notification when Clancy completes a ticket, encounters an error, or finishes an AFK session.

**Implementation approach:** Two mechanisms:

1. **Orchestrator-level notifications.** Add `sendDesktopNotification(title, message)` to `src/scripts/shared/notify/notify.ts`. Called directly from the once orchestrator's deliver phase (on success/failure) and the AFK runner's session-complete path. Uses native OS commands: `osascript` (macOS), `notify-send` (Linux), PowerShell `New-BurntToastNotification` or `[System.Windows.Forms]` (Windows). Platform-detected at runtime.

2. **`Notification` event hook (supplementary).** If Claude Code's `Notification` event fires (it exists but fires for specific conditions: permission prompts, idle prompts, auth events), the hook at `hooks/clancy-notification.js` forwards the notification to the desktop. This catches notifications Clancy didn't explicitly trigger.

The orchestrator-level approach is the primary mechanism — it fires at known points in the lifecycle. The hook is supplementary and best-effort. No new env vars needed; notifications are always enabled. Controlled by `CLANCY_DESKTOP_NOTIFY=false` to suppress.

**Design note:** This is separate from the webhook notification (`CLANCY_NOTIFY_WEBHOOK`). Webhooks go to Slack/Teams for team visibility. Desktop notifications go to the local machine.

**Design note:** This is separate from the existing webhook notification (`CLANCY_NOTIFY_WEBHOOK` in `notify.ts`). Webhooks go to Slack/Teams channels for team visibility. Desktop notifications go to the local machine for the developer who started the session.

**Files changed:**
- `hooks/clancy-notification.js` — new CommonJS hook, `Notification` event type
- `src/installer/hook-installer.ts` — register the new hook

---

### Quiet Hours Hook

**What it does:** Pause AFK sessions during configured hours (e.g., 09:00–17:00 when the team is active and CI resources are shared). Prevents Clancy from picking up new tickets during business hours.

**Implementation approach:** Two complementary mechanisms:

1. **AFK runner check.** Before each iteration in `runAfkLoop()`, check the current time against `CLANCY_QUIET_START` and `CLANCY_QUIET_END`. If within quiet hours, sleep until the end of the quiet window, then continue.

2. **PreToolUse hook (safety net).** A `hooks/clancy-quiet-hours.js` hook that fires on `PreToolUse` and blocks tool execution if within quiet hours. This catches long-running iterations that extend into quiet hours. The hook returns `{ "decision": "block", "reason": "Quiet hours active (HH:MM-HH:MM). Tool execution blocked." }`. **Limitation:** Claude Code does not "sleep" on block — it will see the block message and may stop the session or try alternative approaches. The AFK runner check (mechanism 1) is the primary enforcement; this hook is a fail-safe that causes the session to wind down rather than gracefully pause.

**Env vars:**
```
CLANCY_QUIET_START  # Optional — start of quiet hours in HH:MM 24h format (e.g., "09:00")
CLANCY_QUIET_END    # Optional — end of quiet hours in HH:MM 24h format (e.g., "17:00")
CLANCY_QUIET_TZ     # Optional — timezone for quiet hours (default: system local)
```

**Edge cases:**
- Overnight windows (e.g., `CLANCY_QUIET_START=22:00`, `CLANCY_QUIET_END=06:00`) — handle wrap-around.
- Neither var set — hook is a no-op, AFK runner skips the check.
- Only one var set — treat as misconfigured, log warning, skip quiet hours.

**Files changed:**
- `hooks/clancy-quiet-hours.js` — new CommonJS hook, `PreToolUse` event type
- `src/scripts/afk/afk.ts` — add quiet hours check before each iteration
- `src/installer/hook-installer.ts` — register the new hook
- `src/schemas/env.ts` — add `CLANCY_QUIET_START`, `CLANCY_QUIET_END`, `CLANCY_QUIET_TZ` to shared schema

---

### Drift Detector Hook

**What it does:** Detect when installed Clancy files (hooks, bundled scripts in `.clancy/`) have drifted from the version declared in the npm package. Warns the user to run `/clancy:update` when files are stale.

**Implementation approach:** A `PostToolUse` hook (`hooks/clancy-drift-detector.js`) that runs periodically (debounced — once per session, not every tool use). On first invocation per session:

1. Read `.clancy/version.json` (written by the installer, contains `{ "version": "0.8.0", "installedAt": "..." }`).
2. Read the installed `chief-clancy` package version from `node_modules/chief-clancy/package.json` (or resolve via `require.resolve`).
3. Compare versions. If the npm package is newer than the installed version, inject a warning: `"Clancy files are outdated (installed: 0.7.3, available: 0.8.0). Run /clancy:update to update."`.

**Debounce:** Write a session flag to `os.tmpdir()` (same pattern as context-monitor) so the check runs exactly once per Claude Code session.

**Files changed:**
- `hooks/clancy-drift-detector.js` — new CommonJS hook, `PostToolUse` event type
- `src/installer/install.ts` — write `.clancy/version.json` on install/update
- `src/installer/hook-installer.ts` — register the new hook

---

## Execution Plan

Six waves, each followed by a devil's advocate review gate. Each wave is a branch + PR.

**Wave 0 — Pre-requisite: migrate fetch-ticket.ts to Board type.** Currently `fetch-ticket.ts` has its own `switch (config.provider)` with 3 board-specific cases for `fetchCandidates()` and `isBlocked()` — parallel to the Board wrappers. Adding 3 new boards without this migration means maintaining 6 switch cases in two places. Refactor `fetchTicket()` to accept a `Board` instance and delegate candidate fetching + blocker checking to `Board.fetchTickets()` and `Board.fetchBlockerStatus()`. This eliminates the dual-switch maintenance burden and validates the Board abstraction before adding new boards. Also add `retryFetch()` utility to `src/scripts/shared/http/http.ts` — a wrapper around `fetch` with exponential backoff, `Retry-After` header support, and configurable max retries. Required by Notion but available to all boards. DA review: ensure no behaviour change in existing boards, verify blocker check ordering.

**Wave 1 — Shortcut board.** New board implementation following the established pattern: `src/scripts/board/shortcut/shortcut.ts` (raw API), `shortcut-board.ts` (Board wrapper), `src/schemas/shortcut.ts` (Zod schemas), factory extension, env schema extension. Co-located tests for all modules. DA review: API mapping correctness, edge cases in workflow state resolution.

**Wave 2 — Notion board.** Same pattern for Notion: `src/scripts/board/notion/notion.ts`, `notion-board.ts`, `src/schemas/notion.ts`. Retry-with-backoff utility for the 3 req/s rate limit (shared module in `src/scripts/shared/http/`). Property name configuration via env vars. DA review: rate limit handling, property name resolution, UUID key format.

**Wave 3 — Azure DevOps board + auto-detection.** Azure DevOps board implementation: WIQL queries, JSON Patch updates, two-step fetch. Board auto-detection in `env.ts`. Init/settings/scaffold workflow updates for all three new boards. DA review: WIQL query safety (injection), JSON Patch correctness, auto-detection conflict handling.

**Wave 4 — Team features.** Ticket claim check (fetch-ticket.ts), quality tracking module (quality.ts + phase integration), `FetchedTicket` status field. DA review: race condition coverage in claim check, quality.json schema stability, session report integration.

**Wave 5 — New hooks.** Desktop notification hook, quiet hours hook, drift detector hook. Installer updates for all three hooks. Version bump, CHANGELOG, README test badge update. DA review: hook error isolation (must never crash), quiet hours edge cases, drift detection reliability.

---

## Risks

1. **Notion rate limit (3 req/s).** The most restrictive rate limit of any supported board. A retry-with-backoff utility is required and will add latency to every Notion API call. Mitigation: batch where possible, cache aggressively, keep retry count low (3 retries with exponential backoff).

2. **Notion schema variability.** Every Notion database can have different property names and types. If a user's "Status" property is called "Phase" or uses a Select instead of Status type, Clancy will fail without the override env vars. Mitigation: clear error messages during `ping()` / `validateInputs()` that name the expected property and suggest the override var.

3. **Azure DevOps WIQL injection.** WIQL queries are constructed with user-provided values (project name, status filter). Malicious or special-character values could break queries. Mitigation: build a WIQL-specific `isSafeWiqlValue()` validator (WIQL uses SQL-like syntax with `'` quotes and `--` comments — different injection vectors from Jira's JQL). Validate during `validateInputs()`.

4. **Ticket claim race condition.** Two Clancy instances can still race between the re-fetch check and the status transition. The window is small (milliseconds) but not zero. Mitigation: the re-fetch guard reduces the window from seconds (query lag) to milliseconds. For zero-race guarantees, boards would need atomic claim (not available on most boards). Accept the residual risk — worst case is duplicate PRs, which the reviewer catches.

5. **Desktop notifications cross-platform.** macOS (`osascript`), Linux (`notify-send`), and Windows (`PowerShell`) all have different notification APIs. Mitigation: best-effort with platform detection. Fall back to console log if native notification fails. No external dependencies — use built-in OS commands via `child_process.execSync`.

6. **Drift detector false positives.** If the user has intentionally modified hook files (customisation), the drift detector will warn every session. Mitigation: add a `CLANCY_SKIP_DRIFT_CHECK` env var to suppress the warning.

---

## Key Decisions

1. **No new Board interface methods.** All three new boards can be implemented against the existing 11-method Board type. Shortcut, Notion, and Azure DevOps all have mechanisms that map to the current interface. This validates the Board abstraction designed in v0.7.1.

2. **Notion needs a retry utility (built in Wave 0).** The 3 req/s rate limit is unique among supported boards. A shared `retryFetch()` wrapper in `src/scripts/shared/http/http.ts` provides exponential backoff with `Retry-After` header support and configurable max retries (default 3). The Notion board wrapper injects `retryFetch` as its HTTP client — every API call automatically retries on 429/5xx. Other boards can opt in later. Expected latency: 5-10 API calls per ticket × 333ms spacing = ~2-3s per ticket on Notion (acceptable).

3. **Property name configuration for Notion.** Convention-based defaults (`Status`, `Assignee`, `Labels`, `Epic`) with env var overrides. This is the simplest approach that handles the majority of Notion databases without requiring schema introspection at startup.

4. **Claim check is a re-fetch guard, not a lock.** Atomic distributed locking is not available on any supported board. A re-fetch of the ticket's current status immediately before pickup narrows the race window to milliseconds. This is sufficient for the typical deployment (1–3 Clancy instances).

5. **Quality tracking in `.clancy/quality.json`, not the board.** Board-agnostic persistence avoids polluting tickets with Clancy-internal metadata. The file is gitignored (`.clancy/` is already in `.gitignore`). Teams that want board-level visibility can use the session report webhook. **Concurrency note:** multiple AFK instances on different machines can corrupt the file. Acceptable for v0.8.0 (team deployment is uncommon); atomic writes or a distributed store can be added later if needed.

6. **Desktop notifications via OS commands, not npm dependencies.** Hooks are pre-built CommonJS with zero runtime dependencies. Using `osascript` / `notify-send` / PowerShell avoids adding `node-notifier` or similar packages. The hook detects the platform and falls back to console output.

7. **Quiet hours in both AFK runner and hook.** The AFK runner check prevents starting new iterations. The PreToolUse hook catches long-running iterations that extend into quiet hours. Belt and suspenders — the hook is the safety net for the runner.

8. **Drift detector uses `.clancy/version.json`.** The installer already writes files to `.clancy/`. Adding a version manifest is minimal overhead and gives the drift detector a reliable baseline. The alternative (checksumming every file) is fragile and slow.

9. **Board auto-detection by env var presence, not API probing.** Probing each board API to detect which one responds would be slow and require credentials for all boards. Env var detection is instant and deterministic. Conflict (multiple board vars present) falls back to the existing prompt.

10. **Three new boards ship in separate waves.** Each board is independently testable and reviewable. Shipping Shortcut first (simplest API surface) validates the pattern before tackling Notion (property configuration complexity) and Azure DevOps (WIQL + JSON Patch complexity).
