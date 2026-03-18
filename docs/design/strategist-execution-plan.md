# Strategist Role (v0.6.0) — Execution Plan

## Overview

~27 files (4 new, ~23 modified). 4 waves, 9 agents total. The strategist is a **pure markdown workflow** — no runtime TypeScript like `once.ts`. The installer picks up roles dynamically from `src/roles/`. Also includes blocker-aware ticket pickup in the implementer (runtime TypeScript change) and `fetchChildrenStatus` rewrite to use `Epic:` text convention.

## Prerequisites

**The planner fix PR (v0.5.6) must be merged first.** It handles:
- `/clancy:approve` → `/clancy:approve-plan` rename (all ~12 files)
- Planner `--force` → auto-detect + `--fresh`
- Branch freshness check (planner + implementer workflows)
- `CLANCY_STATUS_PLANNED`, `CLANCY_SKIP_COMMENTS` env vars
- `CLANCY_PLAN_STATE_TYPE` enum validation

The strategist builds on top of this — it does NOT need to redo any of the above.

---

## Wave Structure

### Wave 1 — Foundation + Core (3 parallel agents)

| Agent | Chunks | Files | Complexity |
|---|---|---|---|
| **1** | Schema + types | `src/schemas/env.ts` (add `CLANCY_BRIEF_ISSUE_TYPE`, `CLANCY_BRIEF_EPIC`, `CLANCY_COMPONENT`, `CLANCY_MODE`), `src/types/remote.ts` (add `BRIEF`, `APPROVE_BRIEF` to ProgressStatus) | Small |
| **2** | **Brief workflow** | `src/roles/strategist/workflows/brief.md` (NEW, ~500 lines) | **Large** |
| **3** | **Approve-brief workflow** | `src/roles/strategist/workflows/approve-brief.md` (NEW, ~400 lines) | **Large** |

Agents 2 and 3 are the critical path — they need the full design docs.

**No approve rename needed** — already done in v0.5.6.
**No planner --fresh change needed** — already done in v0.5.6.
**No branch freshness check needed** — already in planner + implementer from v0.5.6. Strategist brief workflow includes it natively.

### Wave 2 — Integration (4 parallel agents)

| Agent | Chunks | Files |
|---|---|---|
| **4** | Command files + installer | `src/roles/strategist/commands/brief.md` (NEW), `src/roles/strategist/commands/approve-brief.md` (NEW), `src/installer/install.ts` |
| **5** | Setup integration + scaffold | `src/roles/setup/commands/help.md`, `src/roles/setup/workflows/init.md`, `src/roles/setup/workflows/settings.md`, `src/roles/setup/workflows/scaffold.md` |
| **6** | Reviewer logs + hook + template | `src/roles/reviewer/workflows/logs.md`, `hooks/clancy-check-update.js`, `src/templates/CLAUDE.md` |
| **7** | Implementer blocker check + fetchChildrenStatus rewrite | `src/scripts/once/fetch-ticket/fetch-ticket.ts` (blocker-aware pickup), `src/scripts/board/{jira,github,linear}/*.ts` (add `fetchBlockerStatus` + rewrite `fetchChildrenStatus` to use `Epic:` text convention + add Zod validation) |

### Wave 3 — Documentation (2 parallel agents)

| Agent | Chunks | Files |
|---|---|---|
| **8** | Role doc + cross-cutting docs | `docs/roles/STRATEGIST.md` (NEW), `docs/ARCHITECTURE.md`, `docs/roles/SETUP.md`, `docs/guides/CONFIGURATION.md`, `docs/GLOSSARY.md` |
| **9** | README + project + release | `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `package.json`, `package-lock.json` |

### Wave 4 — Verification

Run `npm test && npm run typecheck && npm run lint`. Fix any issues.

---

## What's inherited from v0.5.6

| Item | Status after v0.5.6 |
|---|---|
| `/clancy:approve-plan` | Already renamed, all references updated |
| Branch freshness check | Already in `plan.md` and `once.md` — strategist copies the pattern |
| `CLANCY_STATUS_PLANNED` | Already in env schema |
| `CLANCY_SKIP_COMMENTS` | Already in env schema |
| `CLANCY_PLAN_STATE_TYPE` validation | Already validated as enum |
| Auto-detect + `--fresh` pattern | Already in planner — strategist follows same pattern |

## What's new for v0.6.0

- Strategist commands/workflows (brief, approve-brief)
- `CLANCY_BRIEF_ISSUE_TYPE`, `CLANCY_BRIEF_EPIC`, `CLANCY_COMPONENT` env vars
- `BRIEF`, `APPROVE_BRIEF` progress statuses
- `.clancy/briefs/` directory + `.approved` marker system
- Ticket creation APIs (Jira POST /issue, GitHub POST /issues, Linear issueCreate)
- Dependency linking (Jira issueLink, GitHub cross-refs, Linear issueRelationCreate)
- Adaptive agent research (1-4 agents)
- Brief template rendering
- `CLANCY_COMPONENT` auto-apply on created tickets
- Stale brief hook extension
- `--dry-run` for approve-brief
- Strategist in init/settings/scaffold/help
- **Grill phase (dual-mode)** — relentless interrogation inspired by Matt Pocock's "grill me" skill. Human grill (interactive, two-way, multi-round — pushes back on vague answers, refuses to generate brief until shared understanding) and AI-grill (autonomous, single-pass with devil's advocate agent — same intensity directed at itself). Mode determined by `--afk` flag or `CLANCY_MODE` env var
- **AI-grill** — devil's advocate agent answers clarifying questions using codebase + board + web research. Does not accept its own vague answers. Produces `## Discovery` section with source tags
- **`CLANCY_MODE` env var** — persistent `interactive` (default) or `afk` mode. `--afk` flag for per-invocation override
- **Discovery section** — Q&A from grill phase with source tags (human/codebase/board/web) in every brief
- **Vertical slice decomposition** — validation rule enforcing end-to-end slices, not horizontal layers
- **HITL/AFK classification** — each decomposed ticket tagged as autonomous (AFK) or human-required (HITL)
- **Blocking-aware ticket ordering** — topological sort of decomposition table; circular dependency detection
- **Strengthened user stories** — behaviour-driven format with traceability to decomposed tickets
- **Open Questions section** — unresolvable questions from grill phase surfaced for PO review
- **Blocker-aware ticket pickup** — implementer checks blocking dependencies before picking up a ticket. If any blocker is incomplete, skip and pick the next one. Per-board: Jira issueLinks, GitHub "Blocked by #N" body parsing, Linear relations API
- **`fetchChildrenStatus` rewrite** — all 3 board implementations rewritten to use `Epic: {key}` text convention in child descriptions (cross-platform), replacing native parent/child APIs. Zod validation added
- **`Epic: {key}` in child descriptions** — strategist embeds epic reference in every child ticket description during `/clancy:approve-brief`. Enables cross-platform epic completion detection

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

## Genuinely New

- `.clancy/briefs/` directory + slug generation + `.approved` marker
- Ticket creation APIs (new API calls not in planner)
- Dependency linking
- Adaptive agent research (1-4 agents)
- Brief template rendering
- Brief selection logic (index/slug/ticket/conversational)
- `CLANCY_COMPONENT` auto-apply on created tickets
- Stale brief hook extension
- `--dry-run` for approve-brief
- Grill phase — dual-mode (human grill + AI-grill with devil's advocate agent)
- `--afk` flag + `CLANCY_MODE` env var for grill mode detection
- AI-grill devil's advocate agent (codebase + board + web research, single pass)
- Discovery section in brief template (Q&A with source tags)
- Open Questions section in brief template (unresolved from grill)
- Vertical slice validation rule in decomposition
- HITL/AFK mode classification per ticket
- Topological sort + circular dependency detection in approve-brief
- Blocker-aware ticket pickup in implementer (`fetchTicket` checks dependencies before returning)
- `fetchChildrenStatus` rewrite — `Epic:` text convention + Zod validation for all 3 boards
- `fetchBlockerStatus` — new per-board function to check if a ticket's blockers are resolved

---

## Risks (ordered by severity)

1. **Brief workflow complexity** — 500-line markdown workflow covering 4 input modes × 3 boards × edge cases
2. **Ticket creation API payloads** — Jira next-gen vs classic parent field, GitHub label pre-creation, Linear UUID resolution
3. **Hook extension** — CommonJS, must not block SessionStart
4. **CLANCY_COMPONENT** — only implement "set on created tickets" side. Queue filtering deferred.
5. **Blocker checking across boards** — Jira uses issueLinks (reliable), GitHub uses body text parsing (fragile), Linear uses relations API (needs UUID). Different reliability levels per board.
6. **`fetchChildrenStatus` rewrite** — changing from native APIs to text convention. Must not break epic completion for existing Jira users who have children without `Epic:` in description.

---

## De-risking Order

1. Schema/types first (validates TypeScript compiles)
2. Brief workflow early (critical path, surface issues fast)
3. Docs last (can be written accurately after code is final)
