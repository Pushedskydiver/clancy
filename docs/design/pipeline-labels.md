# Pipeline Stage Labels — Design Document

## Problem

Clancy uses a single `CLANCY_LABEL` for implementation queue filtering. When `/clancy:approve-brief` creates child tickets with `CLANCY_LABEL`, the implementer picks them up immediately — before the planner has a chance to plan them. There is no way to distinguish pipeline stages on the board: a freshly briefed ticket looks identical to a fully planned, ready-to-build ticket.

A separate `CLANCY_PLAN_LABEL` exists for GitHub-specific planner filtering, but it is disconnected from the main label and does not cover the full lifecycle. The result: tickets leak between stages, especially in AFK mode where there is no human gatekeeper.

## Solution

Replace the single label with 3 pipeline stage labels that control ticket flow through Clancy's stages:

```
/clancy:brief #42 --> adds clancy:brief label to #42

/clancy:approve-brief #42 --> removes clancy:brief from #42
    Creates child issues (#43, #44, #45) with clancy:plan label
    (--skip-plan flag applies clancy:build instead)

/clancy:plan picks up #43 --> (filters by clancy:plan)

/clancy:approve-plan #43 --> removes clancy:plan, adds clancy:build

/clancy:once picks up #43 --> (filters by clancy:build)
```

Each label acts as a queue marker. Tickets move through `clancy:brief` -> `clancy:plan` -> `clancy:build` as they progress through the pipeline. Only one pipeline label is present at a time.

### Env Vars

| Variable | Default | Description |
|---|---|---|
| `CLANCY_LABEL_BRIEF` | `clancy:brief` | Label for tickets that have been briefed but not yet approved |
| `CLANCY_LABEL_PLAN` | `clancy:plan` (new installs) / falls back to `CLANCY_PLAN_LABEL` (existing) | Label for tickets needing planning |
| `CLANCY_LABEL_BUILD` | `clancy:build` | Label for tickets ready to implement |

---

## Key Decisions

### 1. Backward compatibility via fallback

`CLANCY_LABEL` is deprecated but still works. If `CLANCY_LABEL_BUILD` is not set, `CLANCY_LABEL` is used as the fallback for implementation queue filtering. If neither is set, no label filtering is applied (existing behaviour preserved).

`CLANCY_PLAN_LABEL` is replaced by `CLANCY_LABEL_PLAN`. If `CLANCY_LABEL_PLAN` is not set but `CLANCY_PLAN_LABEL` is, the old value is used as fallback.

Fallback resolution happens in the **env schema** (`src/schemas/env.ts`), not in individual consumers. This ensures every code path (board factories, fetch-ticket, workflows) sees the resolved value:

```typescript
// In env schema — resolve once, use everywhere
CLANCY_LABEL_BUILD: env.CLANCY_LABEL_BUILD ?? env.CLANCY_LABEL,
CLANCY_LABEL_PLAN: env.CLANCY_LABEL_PLAN ?? env.CLANCY_PLAN_LABEL,
CLANCY_LABEL_BRIEF: env.CLANCY_LABEL_BRIEF, // no legacy equivalent
```

The deprecated vars (`CLANCY_LABEL`, `CLANCY_PLAN_LABEL`) remain in the schema as optional inputs but are never read directly by consumers — only the resolved `CLANCY_LABEL_*` vars are used.

### 2. Create-if-missing label management

Labels are created on the board automatically when first needed. Each board handles this differently:

**GitHub:** Check if label exists via `GET /repos/{owner}/{repo}/labels/{name}`. If 404, create via `POST /repos/{owner}/{repo}/labels` with a default colour. Add to issue via `POST /repos/{owner}/{repo}/issues/{N}/labels`. Remove via `DELETE /repos/{owner}/{repo}/issues/{N}/labels/{name}`.

**Jira:** Labels auto-create on use. Include in the `labels` array on issue creation or update. To remove: fetch current labels, filter out the target, PUT the updated list.

**Linear:** Check team labels via GraphQL query, create if missing via `issueLabelCreate` mutation. Add/remove via `issueUpdate` mutation with updated `labelIds` array.

### 3. The `--skip-plan` flag

`/clancy:approve-brief --skip-plan` applies `CLANCY_LABEL_BUILD` directly instead of `CLANCY_LABEL_PLAN`. For tickets that are clear enough from the brief and do not need a planning step. The label transition becomes `clancy:brief` -> `clancy:build`, skipping the planning queue entirely.

### 4. Board type gets label management methods

The `Board` type gains three new methods:

```typescript
type Board = {
  // ... existing methods ...
  ensureLabel: (label: string) => Promise<void>;
  addLabel: (issueKey: string, label: string) => Promise<void>;
  removeLabel: (issueKey: string, label: string) => Promise<void>;
};
```

`ensureLabel` creates the label on the board if it does not already exist. `addLabel` and `removeLabel` manage labels on individual issues. All three are best-effort — label operations should never block ticket delivery.

### 5. Label crash safety

If a run crashes between removing one label and adding another, the ticket has no pipeline label and becomes invisible to all queues. The mitigation: add the new label first, then remove the old one. A ticket briefly has two labels (harmless — queue filters pick it up once) rather than zero labels (ticket lost).

Ordering for all transitions:

```
addLabel(ticket, newLabel)    // ticket now has both
removeLabel(ticket, oldLabel) // ticket now has only the new one
```

### 6. Only one pipeline label at a time (steady state)

In steady state, a ticket has exactly one of the three pipeline labels (or none, for tickets not managed by Clancy). The brief/approve/plan/approve cycle ensures clean transitions. The dual-label window during transitions (decision 5) is momentary.

---

## Per-Board Implementation

### GitHub

```
ensureLabel(label):
  GET /repos/{owner}/{repo}/labels/{name}
  if 404 -> POST /repos/{owner}/{repo}/labels { name, color: "0075ca" }

addLabel(issueNumber, label):
  POST /repos/{owner}/{repo}/issues/{N}/labels { labels: [label] }

removeLabel(issueNumber, label):
  DELETE /repos/{owner}/{repo}/issues/{N}/labels/{name}
  (ignore 404 — label may not be on the issue)
```

### Jira

```
ensureLabel(label):
  No-op — Jira auto-creates labels on first use

addLabel(issueKey, label):
  GET /rest/api/3/issue/{key}?fields=labels
  PUT /rest/api/3/issue/{key} { fields: { labels: [...existing, label] } }

removeLabel(issueKey, label):
  GET /rest/api/3/issue/{key}?fields=labels
  PUT /rest/api/3/issue/{key} { fields: { labels: existing.filter(l => l !== label) } }
```

### Linear

```
ensureLabel(label):
  Query team labels: { team(id: $teamId) { labels { nodes { id name } } } }
  If not found, check workspace labels: { issueLabels { nodes { id name } } }
  If still not found: issueLabelCreate({ teamId, name: label, color: "#0075ca" })

addLabel(issueId, label):
  Get current labelIds from issue
  issueUpdate({ id: issueId, labelIds: [...current, newLabelId] })

removeLabel(issueId, label):
  Get current labelIds from issue
  issueUpdate({ id: issueId, labelIds: current.filter(id => id !== targetId) })
```

---

## Files to Change

### Wave 1 — Foundation

| Scope | Files | Tests |
|---|---|---|
| Env schema | `src/schemas/env.ts` — add `CLANCY_LABEL_BRIEF`, `CLANCY_LABEL_PLAN`, `CLANCY_LABEL_BUILD`. Add fallback resolution logic for deprecated vars | `env-schema.test.ts` |
| Board type | `src/scripts/board/board.ts` — add `ensureLabel`, `addLabel`, `removeLabel` to the `Board` type | — |
| GitHub board | `src/scripts/board/github/github-board.ts` — implement the three label methods | `github-board.test.ts` |
| Jira board | `src/scripts/board/jira/jira-board.ts` — implement the three label methods | `jira-board.test.ts` |
| Linear board | `src/scripts/board/linear/linear-board.ts` — implement the three label methods | `linear-board.test.ts` |

### Wave 1 Review

- Do the new env vars compile? Does fallback resolution work (`CLANCY_LABEL_BUILD` falls back to `CLANCY_LABEL`, `CLANCY_LABEL_PLAN` falls back to `CLANCY_PLAN_LABEL`)?
- Do all three board implementations handle create-if-missing correctly?
- Does `removeLabel` gracefully handle "label not on issue" (404 / no-op)?
- `npm test && npm run typecheck && npm run lint`

### Wave 2 — Workflow Integration

| Scope | Files | Tests |
|---|---|---|
| Brief workflow | `src/roles/strategist/workflows/brief.md` — after posting the brief comment, call `addLabel(ticket, CLANCY_LABEL_BRIEF)` via `ensureLabel` + `addLabel` | — |
| Approve-brief workflow | `src/roles/strategist/workflows/approve-brief.md` — on parent: `removeLabel(parent, CLANCY_LABEL_BRIEF)`. On each created child: apply label based on planner role + flags (see below) | — |
| Plan workflow | `src/roles/planner/workflows/plan.md` — filter queue by `CLANCY_LABEL_PLAN` instead of `CLANCY_PLAN_LABEL` | — |
| Approve-plan workflow | `src/roles/planner/workflows/approve-plan.md` — `addLabel(ticket, CLANCY_LABEL_BUILD)` then `removeLabel(ticket, CLANCY_LABEL_PLAN)`. Replace `CLANCY_LABEL` references with `CLANCY_LABEL_BUILD` | — |
| Fetch-ticket | `src/scripts/once/fetch-ticket/fetch-ticket.ts` — filter by `CLANCY_LABEL_BUILD` (with `CLANCY_LABEL` fallback) instead of `CLANCY_LABEL` directly | `fetch-ticket.test.ts` |
| Review workflow | `src/roles/reviewer/workflows/review.md` — update `CLANCY_LABEL` references to `CLANCY_LABEL_BUILD` | — |
| Status workflow | `src/roles/reviewer/workflows/status.md` — update `CLANCY_LABEL` references to `CLANCY_LABEL_BUILD` | — |

#### Approve-brief child label logic

```
--skip-plan flag?           → apply CLANCY_LABEL_BUILD (skip planning)
Planner role enabled?       → apply CLANCY_LABEL_PLAN (needs planning first)
Planner role NOT enabled?   → apply CLANCY_LABEL_BUILD (no planner = straight to build)
```

This prevents the B2 issue where Jira/Linear users without the planner role would have tickets stuck in a planning queue they never use.

#### Approve-plan operation order (crash safety)

The approve-plan workflow MUST add the new label before removing the old one:

```
1. addLabel(ticket, CLANCY_LABEL_BUILD)    ← ticket now has both
2. removeLabel(ticket, CLANCY_LABEL_PLAN)  ← ticket now has only build
```

This is reversed from the current approve-plan.md Step 6 which does remove-then-add.

#### `addLabel` internally calls `ensureLabel`

To avoid inconsistency in workflow instructions, `addLabel` should call `ensureLabel` internally before adding the label. Workflow authors only need to call `addLabel` — one call, not two.

#### Re-brief label handling

When re-briefing with `--fresh`, the brief workflow should ensure only `clancy:brief` is present. If the ticket already has `clancy:plan` or `clancy:build` (from a prior approval), remove them first:

```
removeLabel(ticket, CLANCY_LABEL_PLAN)   ← best-effort, ignore if not present
removeLabel(ticket, CLANCY_LABEL_BUILD)  ← best-effort, ignore if not present
addLabel(ticket, CLANCY_LABEL_BRIEF)
```

#### Planner queue filtering — labels supplement status

For Jira and Linear, the planning queue uses status-based filtering (`CLANCY_PLAN_STATUS` / `state.type`). Adding `CLANCY_LABEL_PLAN` supplements this — tickets must match BOTH the status filter AND have the label. For GitHub, the label replaces `CLANCY_PLAN_LABEL` (label-based filtering only, no status concept).

#### Implementer queue guard — exclude plan-labelled tickets

To prevent the dual-label AFK race (ticket has both `clancy:plan` + `clancy:build` momentarily), the implementer's fetch-ticket should exclude tickets that still have `CLANCY_LABEL_PLAN`. This ensures a ticket is only picked up for implementation after the plan label is fully removed.

### Wave 2 Review

- Does the brief workflow only add `CLANCY_LABEL_BRIEF` if the env var is set (or use the default)?
- Does approve-brief add the new label BEFORE removing the old one (crash safety — decision 5)?
- Does approve-plan add `CLANCY_LABEL_BUILD` BEFORE removing `CLANCY_LABEL_PLAN`?
- Does `--skip-plan` correctly skip the planning label and apply `CLANCY_LABEL_BUILD` directly?
- Does fetch-ticket fall back from `CLANCY_LABEL_BUILD` to `CLANCY_LABEL` for backward compat?
- Are all three boards (Jira JQL, GitHub API, Linear GraphQL) updated in the workflow files?
- `npm test && npm run typecheck && npm run lint`

### Wave 3 — Setup + Docs

| Scope | Files | Tests |
|---|---|---|
| Init workflow | `src/roles/setup/workflows/init.md` — add pipeline label prompts (see below), deprecation notice for `CLANCY_LABEL` and `CLANCY_PLAN_LABEL` | — |
| Settings workflow | `src/roles/setup/workflows/settings.md` — add new env vars to settings menu, deprecation notice | — |
| Scaffold workflow | `src/roles/setup/workflows/scaffold.md` — add new env vars to `.env.example` templates | — |
| Documentation | `docs/GLOSSARY.md` (pipeline labels), `docs/guides/CONFIGURATION.md` (new env vars, deprecation), `docs/ARCHITECTURE.md` (board label methods), `CLAUDE.md` (technical details) | — |
| Release | `CHANGELOG.md`, `package.json` (version bump), `package-lock.json` | — |

#### Init flow — conditional label prompts

Pipeline label prompts are shown conditionally based on which roles are enabled:

```
User enables Strategist (or both Strategist + Planner):
  → Ask CLANCY_LABEL_BRIEF (default: clancy:brief)
  → Ask CLANCY_LABEL_PLAN (default: clancy:plan)
  → Ask CLANCY_LABEL_BUILD (default: clancy:build)

User enables Planner only (no Strategist):
  → Skip CLANCY_LABEL_BRIEF (no /clancy:brief command)
  → Ask CLANCY_LABEL_PLAN (default: clancy:plan)
  → Ask CLANCY_LABEL_BUILD (default: clancy:build)

User enables neither optional role (implementer only):
  → Skip all pipeline labels
  → Keep existing CLANCY_LABEL behaviour (if set)
```

### Wave 3 Review — Final

- Are all new env vars documented in init, settings, scaffold, and the configuration guide?
- Do init/settings show deprecation notices for `CLANCY_LABEL` and `CLANCY_PLAN_LABEL`?
- Are the new `Board` methods documented in ARCHITECTURE.md?
- Is the pipeline label lifecycle documented in the GLOSSARY?
- Version bump + CHANGELOG entry present? Package-lock synced?
- `npm test && npm run typecheck && npm run lint`

---

## Migration

**Existing users upgrading:** The fallback resolution means existing users see no change until they explicitly set the new env vars. Their existing `CLANCY_LABEL` and `CLANCY_PLAN_LABEL` continue to work.

**Existing in-flight tickets:** Tickets already on the board with the old label name (e.g. `clancy`) won't match the new `CLANCY_LABEL_BUILD` default (`clancy:build`). Options:
1. Keep using the old var — set `CLANCY_LABEL_BUILD` to match their existing label name
2. Re-label tickets — manually update labels on the board
3. `/clancy:doctor` — add a check that warns about tickets with legacy labels when new vars are set

**Init flow for new users:** New users (or re-init) get the new pipeline labels by default. The init wizard asks for label names based on enabled roles (see Wave 3 init flow section).

---

## Risks

1. **Breaking change for existing users.** Existing tickets have `CLANCY_LABEL` not `CLANCY_LABEL_BUILD`. The fallback resolution (decision 1) preserves existing behaviour — users who do not set the new vars see no change. Users who adopt the new vars get pipeline filtering. Medium confidence this is smooth because the old vars still work.

2. **Label cleanup on crash.** If a run crashes between `addLabel` and `removeLabel`, the ticket has two pipeline labels momentarily. Decision 5 (add-before-remove) ensures a ticket is never invisible, but it may appear in two queues briefly. The next command that processes the ticket will clean up the extra label.

3. **Board API rate limits.** Adding/removing labels is 1-2 extra API calls per ticket transition. For GitHub and Linear this means 2-4 additional requests per ticket lifecycle. Jira label updates piggyback on existing issue update calls. Unlikely to hit rate limits unless processing many tickets in rapid succession.

4. **Label name collisions.** If a project already has labels named `clancy:brief`, `clancy:plan`, or `clancy:build` for a different purpose, Clancy will use them. The env vars allow customisation to avoid collisions.

5. **Linear label scoping.** Linear labels can be team-scoped or workspace-scoped. `ensureLabel` should create team-scoped labels (more specific, uses `LINEAR_TEAM_ID` from env). If a workspace-scoped label with the same name exists, use it rather than creating a duplicate.

6. **Jira label updates are not atomic.** GET labels then PUT updated list — another process could modify labels between the two calls. Acknowledged as a known Jira API limitation. Low risk in practice since label transitions are infrequent.

7. **Dual-label AFK race.** During add-before-remove transitions, a ticket briefly has two pipeline labels. The implementer fetch-ticket guard (exclude tickets with `CLANCY_LABEL_PLAN`) prevents premature pickup.
