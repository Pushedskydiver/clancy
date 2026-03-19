# Strategist Role (v0.6.0) — Execution Plan

## Overview

~30 files (4 new, ~26 modified) + ~12 test files. 4 waves, 9 agents total. The strategist is a **pure markdown workflow** — no runtime TypeScript like `once.ts`. The installer picks up roles dynamically from `src/roles/`. Also includes blocker-aware ticket pickup in the implementer (runtime TypeScript change), `fetchChildrenStatus` dual-mode rewrite, and HITL/AFK queue filtering.

## Prerequisites

All of the following shipped in v0.5.6–v0.5.12:
- `/clancy:approve-plan` rename (v0.5.6)
- Planner `--fresh` + auto-detect feedback (v0.5.6)
- Branch freshness check in planner + implementer (v0.5.6)
- `CLANCY_STATUS_PLANNED`, `CLANCY_SKIP_COMMENTS` env vars (v0.5.6)
- Epic branch workflow — PR-based delivery for all tickets (v0.5.12)
- `EPIC_PR_CREATED` progress status (v0.5.12)

---

## Wave Structure

### Wave 1 — Foundation + Core (3 parallel agents)

| Agent | Chunks | Files | Tests | Complexity |
|---|---|---|---|---|
| **1** | Schema + types + progress parser | `src/schemas/env.ts` (add `CLANCY_BRIEF_ISSUE_TYPE`, `CLANCY_BRIEF_EPIC`, `CLANCY_COMPONENT`, `CLANCY_MODE` to shared schema), `src/types/remote.ts` (add `BRIEF`, `APPROVE_BRIEF` to ProgressStatus), `src/scripts/shared/progress/progress.ts` (update `parseProgressFile` to handle slug-based entries for BRIEF/APPROVE_BRIEF) | `env-schema.test.ts`, `progress.test.ts` | Small |
| **2** | **Brief workflow** | `src/roles/strategist/workflows/brief.md` (NEW, ~500 lines) — includes grill phase (human + AI-grill), all 4 input modes, batch mode, `--research`/`--afk`/`--fresh` flags, 3 board platforms | — | **Large** |
| **3** | **Approve-brief workflow** | `src/roles/strategist/workflows/approve-brief.md` (NEW, ~400 lines) — includes topological sort, `Epic: {key}` embedding, mode labels, 3 board platforms | — | **Large** |

Agents 2 and 3 are the critical path — they need the full design docs.

**Note on Agent 2 complexity:** The brief workflow handles 4 input modes × 3 boards × dual grill mode. Consider splitting into two sub-agents if context window is a concern: one for the grill phase + brief generation, one for board-specific API calls (comment posting, feedback detection, re-brief flow).

### Wave 1 Review — Devil's Advocate

Spin up a review agent after Wave 1 completes. Scope:

- Do the new types compile? Run `npm run typecheck`.
- Do the Zod schema additions (`CLANCY_MODE`, `CLANCY_BRIEF_ISSUE_TYPE`, `CLANCY_BRIEF_EPIC`, `CLANCY_COMPONENT`) match the design docs' env var tables?
- Does the progress parser handle all entry formats described in the visual flows doc (BRIEF slug-based, APPROVE_BRIEF slug-based, REVISED entries)?
- Are `BRIEF` and `APPROVE_BRIEF` added to the `ProgressStatus` type union?
- Do existing tests still pass? Run `npm test`.

### Wave 2 — Integration (4 parallel agents)

| Agent | Chunks | Files | Tests |
|---|---|---|---|
| **4** | Command files + installer | `src/roles/strategist/commands/brief.md` (NEW), `src/roles/strategist/commands/approve-brief.md` (NEW), `src/installer/install.ts` | — |
| **5** | Setup integration + scaffold | `src/roles/setup/commands/help.md`, `src/roles/setup/workflows/init.md` (add `CLANCY_MODE`, strategist toggle), `src/roles/setup/workflows/settings.md`, `src/roles/setup/workflows/scaffold.md` (add new env vars to .env.example templates). **Note:** `CLANCY_COMPONENT` prompt should clarify it only affects ticket creation, not queue filtering. | — |
| **6** | Reviewer logs + stale brief hook + template | `src/roles/reviewer/workflows/logs.md`, `hooks/clancy-check-update.js` (**stale brief detection** — scan `.clancy/briefs/` for unapproved files > 7 days old), `src/templates/CLAUDE.md` | — |
| **7** | Implementer: blocker check + HITL filter + fetchChildrenStatus | See detailed scope below | `jira.test.ts`, `github.test.ts`, `linear.test.ts`, `fetch-ticket.test.ts` |

#### Agent 7 — Detailed Scope

This is the most complex Wave 2 agent because it touches runtime TypeScript across 4 modules.

**1. Blocker-aware ticket pickup (`src/scripts/once/fetch-ticket/fetch-ticket.ts`)**

The current `fetchTicket` returns a single result (first match). The new pattern:

```
fetchTicket(config):
  1. Fetch candidate tickets from queue (existing logic, but increase maxResults to 5)
  2. For each candidate:
     a. Call fetchBlockerStatus(config, candidate.key)
     b. If all blockers resolved → return this ticket
     c. If blockers unresolved → skip, log "Skipping {key} — blocked by {blockers}", try next
  3. If all candidates blocked → return undefined (no available work)
```

**Per-board fetch changes:**
- **Jira:** Change `maxResults: 1` to `maxResults: 5` in JQL search. Return array instead of single result.
- **GitHub:** Already fetches `per_page: 1` — change to `per_page: 5`. Return array.
- **Linear:** Already fetches `first: 1` — change to `first: 5`. Return array.

**2. `fetchBlockerStatus` (NEW — all 3 board modules)**

Per-board implementation:
- **Jira:** `GET /rest/api/3/issue/{key}?fields=issuelinks` → filter for `type.name === "Blocks"` inward links → check each blocker's `statusCategory.key !== "done"`
- **GitHub:** Parse issue body for `Blocked by #N` lines → `GET /repos/{repo}/issues/{N}` → check `state !== "closed"`
- **Linear:** `query { issue(id) { relations { nodes { type relatedIssue { state { type } } } } } }` → filter `type === "blockedBy"` → check `state.type !== "completed"`

**3. HITL/AFK queue filtering**

When running in AFK mode (`/clancy:run`), skip tickets with `clancy:hitl` label. In interactive mode (`/clancy:once`), pick up any ticket regardless of mode label.

Detection: check if the current run was invoked by the AFK runner (passed via argv or env). If AFK, add label filter to the queue query:
- **Jira:** Add `AND labels != "clancy:hitl"` to JQL
- **GitHub:** Exclude issues with `clancy:hitl` label (filter client-side after fetch)
- **Linear:** Add label filter to GraphQL query

**4. `fetchChildrenStatus` dual-mode rewrite (all 3 boards)**

**Critical: backward compatibility.** The rewrite uses dual-mode — try `Epic:` text convention first, fall back to native parent/child API:

```
fetchChildrenStatus(config, parentKey, parentId?):
  1. Try Epic: text convention:
     - Jira: JQL `description ~ "Epic: {parentKey}"`
     - GitHub: Search issues for body containing `Epic: #{parentNumber}`
     - Linear: Search issues for description containing `Epic: {parentIdentifier}`
  2. If text search returns results → use them (new convention)
  3. If text search returns 0 results → fall back to native API:
     - Jira: JQL `parent = {parentKey}` (current behaviour)
     - GitHub: Search for `Parent: #{parentNumber}` in body (current behaviour)
     - Linear: `issue(id) { children { ... } }` (current behaviour)
  4. Return { total, incomplete }
```

This ensures existing users with children created before v0.6.0 (no `Epic:` in description) still get epic completion detection via the native API fallback. New children (created by the strategist) will have `Epic:` and be found by the text search.

**Add Zod schemas for all new API responses** in `src/schemas/`:
- `jira.ts`: issueLinks response schema
- `github-issues.ts`: children search response schema
- `linear.ts`: relations response schema, children search response schema

### Wave 2 Review — Devil's Advocate

Spin up a review agent after Wave 2 completes. This is the most critical review — Wave 2 has the riskiest changes. Scope:

- **Blocker check:** Does `fetchTicket` handle all-blocked gracefully (return undefined, not infinite loop)? Does it log skipped tickets? Does `fetchBlockerStatus` handle tickets with no blockers (return empty = unblocked)?
- **fetchChildrenStatus dual-mode:** Test mentally: (a) children with `Epic:` in description → found via text search, (b) children without `Epic:` (pre-v0.6.0) → found via native API fallback, (c) mixed → text search finds some, but what about the rest? Should it merge results?
- **HITL/AFK filtering:** In AFK mode, does the label filter work for all 3 boards? In interactive mode, is the filter correctly absent?
- **Workflows:** Do the brief.md and approve-brief.md prompts match the visual flows doc step-by-step? Are all flags (--afk, --research, --fresh, --from, --epic, --dry-run, --list) handled?
- **Stale brief hook:** Is it CommonJS? Does it handle missing `.clancy/briefs/` directory gracefully? Does it avoid blocking SessionStart?
- **Command files:** Do they reference the correct workflow files?
- **Init/settings:** Are all new env vars prompted with correct descriptions and defaults?
- Run `npm test && npm run typecheck && npm run lint`.

### Wave 3 — Documentation (2 parallel agents)

| Agent | Chunks | Files |
|---|---|---|
| **8** | Role doc + cross-cutting docs | `docs/roles/STRATEGIST.md` (NEW), `docs/ARCHITECTURE.md`, `docs/VISUAL-ARCHITECTURE.md`, `docs/roles/SETUP.md`, `docs/guides/CONFIGURATION.md`, `docs/GLOSSARY.md` |
| **9** | README + project + release | `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `package.json`, `package-lock.json` |

### Wave 3 Review — Devil's Advocate

Spin up a review agent after Wave 3 completes. Scope:

- **Cross-doc consistency:** Do the docs (STRATEGIST.md, ARCHITECTURE.md, CONFIGURATION.md, GLOSSARY.md) match what was actually built in Waves 1-2? Any stale refs?
- **Test count:** Has the README badge been updated with the new test count?
- **CHANGELOG:** Does it cover all new features, not just the strategist? (blocker check, HITL/AFK, fetchChildrenStatus rewrite)
- **CLAUDE.md:** Key paths table updated? Commands list updated? Technical decisions updated?
- **Visual architecture diagrams:** Do they reflect the new strategist role interactions?

### Wave 4 — Verification

Run `npm test && npm run typecheck && npm run lint`. Fix any issues.

### Wave 4 Review — Final Devil's Advocate

Final review before PR creation. Scope:

- **Full codebase grep:** Any `TODO`, `FIXME`, `HACK` left from implementation?
- **Stale references:** Any remaining mentions of old patterns (squash-merge for delivery, `github.ts` instead of `github-issues.ts`, etc.)?
- **Test coverage:** Are all new functions tested? Are edge cases covered (all-blocked, circular deps, partial failure)?
- **Package lock:** Is `package-lock.json` synced with `package.json` version?
- **Memory:** Does MEMORY.md need updating with the v0.6.0 state?

---

## What's inherited (already shipped)

| Item | Version |
|---|---|
| `/clancy:approve-plan` rename | v0.5.6 |
| Branch freshness check | v0.5.6 |
| `CLANCY_STATUS_PLANNED`, `CLANCY_SKIP_COMMENTS` | v0.5.6 |
| Auto-detect + `--fresh` pattern | v0.5.6 |
| Epic branch workflow (PR-based delivery) | v0.5.12 |
| `EPIC_PR_CREATED` progress status | v0.5.12 |
| TDD mode (`CLANCY_TDD`) | v0.5.10 |
| Visual architecture diagrams | v0.5.11 |
| Glossary + CLAUDE.md doc links | v0.5.13 |

## What's new for v0.6.0

### Strategist (pure markdown)
- Strategist commands/workflows (brief, approve-brief)
- `CLANCY_BRIEF_ISSUE_TYPE`, `CLANCY_BRIEF_EPIC`, `CLANCY_COMPONENT`, `CLANCY_MODE` env vars
- `BRIEF`, `APPROVE_BRIEF` progress statuses (slug-based format)
- `.clancy/briefs/` directory + `.approved` marker system
- Ticket creation APIs (Jira POST /issue, GitHub POST /issues, Linear issueCreate)
- Dependency linking (Jira issueLink, GitHub cross-refs, Linear issueRelationCreate)
- `Epic: {key}` embedded in every child ticket description
- Adaptive agent research (1-4 agents)
- Brief template rendering (Discovery, User Stories, Vertical Slices, HITL/AFK, Open Questions)
- `CLANCY_COMPONENT` auto-apply on created tickets (creation only — queue filtering deferred)
- Stale brief hook extension (scan `.clancy/briefs/` for unapproved files > 7 days)
- `--dry-run` for approve-brief
- Strategist in init/settings/scaffold/help
- **Grill phase (dual-mode)** — relentless interrogation inspired by Matt Pocock's "grill me" skill. Human grill (interactive, two-way, multi-round) and AI-grill (autonomous, single-pass devil's advocate). Mode: `--afk` flag or `CLANCY_MODE` env var
- **AI-grill devil's advocate agent** — interrogates codebase/board/web, challenges its own answers, flags conflicts. Prompt lives in `src/agents/` alongside existing map-codebase agents
- **Discovery section** — Q&A with source tags (human/codebase/board/web)
- **Open Questions section** — unresolvable questions for PO review
- **Vertical slice decomposition** — validation rule, not horizontal layers
- **HITL/AFK classification** — per-ticket mode tags, labels on created tickets
- **Blocking-aware ticket ordering** — topological sort + circular dependency detection in approve-brief

### Implementer (runtime TypeScript)
- **Blocker-aware ticket pickup** — `fetchTicket` fetches 5 candidates, checks blockers, skips blocked tickets
- **`fetchBlockerStatus`** — new per-board function (Jira issueLinks, GitHub body parsing, Linear relations API)
- **HITL/AFK queue filtering** — AFK mode skips `clancy:hitl` tickets, interactive mode picks up any
- **`fetchChildrenStatus` dual-mode rewrite** — try `Epic:` text convention first, fall back to native parent/child API. Zod validation added. Backward compatible with pre-v0.6.0 children.

---

## Reusable Patterns

| What | Where it exists | How strategist reuses |
|---|---|---|
| Board comment posting (curl) | Planner `plan.md` step 5 | Identical curl patterns for Jira ADF, GitHub MD, Linear GQL |
| Issue fetching | Planner `approve-plan.md` step 3 | Same API calls for single-issue fetch |
| Progress logging | `appendProgress()` | New statuses `BRIEF`, `APPROVE_BRIEF` |
| Auto-detect + `--fresh` | Planner `plan.md` (from v0.5.6) | Same pattern for brief revision detection |
| Branch freshness check | Planner `plan.md` + implementer `once.md` (from v0.5.6) | Copy inline git commands |
| Optional role toggle | Init step 4c, settings R1 | Add `[2] Strategist` |
| Installer role scan | `install.ts` walks `src/roles/` | Just create the directory |
| Skip comments | Planner `plan.md` (from v0.5.6) | Same comment API patterns |
| Board detection in markdown | Planner workflows | Same inline detection logic |

## Genuinely New

- `.clancy/briefs/` directory + slug generation + `.approved` marker
- Ticket creation APIs (new API calls not in planner)
- Dependency linking APIs
- `Epic: {key}` description convention
- Adaptive agent research (1-4 agents)
- Brief template rendering
- Brief selection logic (index/slug/ticket/conversational)
- `CLANCY_COMPONENT` auto-apply on created tickets
- Stale brief hook extension
- `--dry-run` for approve-brief
- Grill phase — dual-mode (human grill + AI-grill with devil's advocate agent)
- `--afk` flag + `CLANCY_MODE` env var for grill mode detection
- AI-grill devil's advocate agent prompt (`src/agents/`)
- Discovery section in brief template (Q&A with source tags)
- Open Questions section in brief template (unresolved from grill)
- Vertical slice validation rule in decomposition
- HITL/AFK mode classification per ticket + board labels
- Topological sort + circular dependency detection in approve-brief
- Blocker-aware ticket pickup (`fetchTicket` multi-candidate + skip)
- `fetchBlockerStatus` — new per-board function
- HITL/AFK queue filtering in AFK mode
- `fetchChildrenStatus` dual-mode — `Epic:` text + native API fallback
- Zod schemas for new board API responses (issueLinks, relations, children search)
- Progress parser update for slug-based BRIEF/APPROVE_BRIEF entries

---

## Risks (ordered by severity)

1. **Brief workflow complexity** — ~500-line markdown workflow covering 4 input modes × 3 boards × dual grill mode × edge cases. Consider splitting Agent 2 into sub-agents if context window is a concern.
2. **Ticket creation API payloads** — Jira next-gen vs classic parent field, GitHub label pre-creation, Linear UUID resolution
3. **`fetchChildrenStatus` dual-mode** — must not break epic completion for existing Jira users. The fallback to native API handles this, but test thoroughly with pre-v0.6.0 children (no `Epic:` in description).
4. **Blocker-aware pickup architecture** — `fetchTicket` changes from single-result to multi-candidate. All 3 board fetch functions need to return arrays. Test that the skip logic doesn't create infinite loops (all candidates blocked → return undefined, not retry).
5. **Jira `Epic:` text search reliability** — JQL `description ~ "Epic: PROJ-100"` is a text search, not exact match. Could match false positives if "Epic: PROJ-100" appears in unrelated context. Mitigate by also checking parent field.
6. **AI-grill sub-agent invocation** — the brief workflow is markdown, but invoking a devil's advocate agent requires Claude's multi-agent capabilities. The prompt goes in `src/agents/` (same pattern as map-codebase), invoked via the Agent tool in the markdown workflow.
7. **Hook extension** — CommonJS, must not block SessionStart
8. **CLANCY_COMPONENT** — only implement "set on created tickets" side. Queue filtering deferred. Init/settings should clarify this limitation.
9. **Jira ADF generation** — approve-brief creates tickets with structured descriptions in ADF. Error-prone in markdown via `curl`. Use codeBlock fallback (existing planner pattern).
10. **Linear UUID resolution latency** — 3-4 API calls per ticket × 10 tickets = 30+ calls. Within rate limits but takes 30+ seconds.

---

## De-risking Order

1. Schema/types/progress parser first (validates TypeScript compiles)
2. Agent 7 (blocker check + fetchChildrenStatus) early — it's the riskiest runtime change
3. Brief workflow early (critical path, surface issues fast)
4. Docs last (can be written accurately after code is final)

---

## Review Checklist (post-implementation)

- [ ] All 3 `fetchBlockerStatus` implementations tested with mocked API responses
- [ ] `fetchChildrenStatus` dual-mode tested: (a) children with `Epic:` found via text, (b) children without `Epic:` found via native fallback, (c) mixed scenario
- [ ] `fetchTicket` multi-candidate tested: (a) first candidate unblocked, (b) first blocked + second unblocked, (c) all blocked
- [ ] HITL/AFK filtering tested: (a) AFK mode skips HITL tickets, (b) interactive mode picks up any
- [ ] Grill phase tested: (a) human grill produces Discovery section, (b) AI-grill produces Discovery + Open Questions
- [ ] Approve-brief tested: (a) topological sort, (b) circular dep detection, (c) `Epic: {key}` in description, (d) mode labels applied
- [ ] Progress parser handles slug-based BRIEF/APPROVE_BRIEF entries
- [ ] Stale brief hook fires on SessionStart for unapproved briefs > 7 days
- [ ] `CLANCY_MODE` in Zod schema, init, settings
- [ ] `package-lock.json` synced with version bump
