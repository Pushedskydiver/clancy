# Design Documents

Design decisions for Clancy features — the "why" behind non-obvious choices. The code is the source of truth for "what" and "how."

## What belongs here

- **Design decisions** — the reasoning behind non-obvious choices. Created before building, **trimmed to decisions-only after shipping**. Full flows, edge cases, and API details belong in the code and tests.
- **In-progress design docs** — full detail while being built. Trimmed after shipping.
- **Execution plans** — wave structure, file lists, build order. **Deleted after the feature ships.**

## Lifecycle

1. **Before building:** Create design doc(s) + execution plan
2. **During building:** Reference both
3. **After shipping:** Delete execution plans. Trim design docs to decisions-only (problem, solution, key decisions). The implementation is now the truth.

## Current documents

### Shipped features (decisions only)

| Document | Feature | Version |
|---|---|---|
| `epic-branch-workflow.md` | PR-based delivery, epic branches, epic completion detection | v0.5.12 |
| `reliable-autonomous-mode.md` | Verification gates, safety hooks, crash recovery, Claude Code hook API research | v0.7.0 |
| `codebase-refactor.md` | Phase pipeline, Board type abstraction, switch elimination | v0.7.1 |
| `pipeline-labels.md` | Pipeline stage labels (clancy:brief → clancy:plan → clancy:build), Board label methods, backward compatibility | v0.7.4 |

### In progress

| Document | Feature | Version |
|---|---|---|
| `team-readiness.md` | Board ecosystem (Shortcut, Notion, Azure DevOps), auto-detection, team features (claim check, quality tracking), new hooks (notification, quiet hours, drift detector) | v0.8.0 |

### Deleted after shipping

- Strategist execution plan + 4 platform flow docs (v0.6.0) — implementation lives in `src/roles/strategist/workflows/`
- Codebase refactor execution plan (v0.7.1) — implementation lives in `src/scripts/once/phases/` and `src/scripts/board/`
