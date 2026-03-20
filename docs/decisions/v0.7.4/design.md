# Pipeline Stage Labels — Design Document

## Problem

Clancy used a single `CLANCY_LABEL` for implementation queue filtering. When `/clancy:approve-brief` created child tickets, the implementer picked them up immediately — before the planner had a chance to plan them. No way to distinguish pipeline stages on the board.

## Solution

Three pipeline stage labels control ticket flow: `clancy:brief` → `clancy:plan` → `clancy:build`. Each label marks which queue a ticket belongs to. Only one pipeline label is present at a time (steady state).

## Key Decisions

1. **Backward compatibility via fallback.** `CLANCY_LABEL_BUILD` falls back to `CLANCY_LABEL`. `CLANCY_LABEL_PLAN` falls back to `CLANCY_PLAN_LABEL`. Fallback resolution happens in `fetch-ticket.ts` at queue pickup time via `resolveBuildLabel()` / `resolvePlanLabel()` helpers.

2. **Create-if-missing label management.** Labels are created on the board automatically when first needed via `ensureLabel`. GitHub: REST API create. Jira: auto-creates on use (no-op). Linear: GraphQL team label query + create mutation.

3. **`--skip-plan` flag.** `/clancy:approve-brief --skip-plan` applies `CLANCY_LABEL_BUILD` directly instead of `CLANCY_LABEL_PLAN`, skipping the planning queue.

4. **Board type gets three label methods.** `ensureLabel(label)`, `addLabel(key, label)`, `removeLabel(key, label)`. `addLabel` calls `ensureLabel` internally. All best-effort.

5. **Label crash safety.** Add new label first, then remove old one. A ticket briefly has two labels (harmless) rather than zero labels (lost).

6. **Implementer queue guard.** Fetch-ticket excludes tickets with `CLANCY_LABEL_PLAN` to prevent dual-label AFK race during transitions.

7. **Linear label scoping.** `ensureLabel` creates team-scoped labels. If a workspace-scoped label with the same name exists, it is used rather than creating a duplicate.
