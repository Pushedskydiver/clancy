# Design Documents

Design docs for Clancy features — the "why" behind non-obvious decisions, edge cases, and platform-specific flows.

## What belongs here

- **Design docs** — flows, edge cases, API contracts, platform differences. Created before building a feature. Kept permanently as reference for why things work the way they do.
- **Execution plans** — wave structure, file lists, build order. Created before building, **deleted after the feature ships**. These are temporary build checklists, not permanent reference.

## Lifecycle

1. **Before building:** Create design doc(s) + execution plan for the feature
2. **During building:** Reference both — the design doc for decisions, the execution plan for build order
3. **After shipping:** Delete the execution plan. Keep the design docs. Update them if the implementation diverged from the original design.

## Current documents

### Shipped features

| Document | Feature | Version |
|---|---|---|
| `epic-branch-workflow.md` | PR-based delivery, epic branches, epic completion detection | v0.5.12 |

### In progress (v0.6.0 — Strategist role)

| Document | Purpose |
|---|---|
| `strategist-visual-flows.md` | Complete flow diagrams for `/clancy:brief` and `/clancy:approve-brief` across all platforms |
| `strategist-jira-flow.md` | Jira-specific scenarios, API calls, ADF format, edge cases |
| `strategist-linear-flow.md` | Linear-specific scenarios, GraphQL operations, edge cases |
| `strategist-github-flow.md` | GitHub Issues-specific scenarios, edge cases |
| `strategist-execution-plan.md` | Build plan — **delete after v0.6.0 ships** |
