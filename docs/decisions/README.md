# Decision Documents

Design decisions for Clancy features — the "why" behind non-obvious choices. The code is the source of truth for "what" and "how."

## What belongs here

- **Briefs** (`brief.md`) — problem statement, success criteria, scope boundaries. Created during `/clancy:brief`.
- **Design docs** (`design.md`) — architecture decisions, trade-offs, key choices. Created before building.
- **Execution plans** (`execution-plan.md`) — wave structure, file lists, build order. Created during `/clancy:plan`.

Each version directory can contain up to three files following this convention:

```
docs/decisions/v0.8.0/
  brief.md           # what + why + scope (created first, trimmed after shipping)
  design.md          # how it works — decisions + trade-offs (trimmed after shipping)
  execution-plan.md  # how to build it — waves, agents, files (deleted after shipping)
```

## Lifecycle

1. **Before building:** Create brief, design doc, and/or execution plan in a version directory
2. **During building:** Reference all three
3. **After shipping:** Delete execution plans. Trim brief + design docs to decisions-only (problem, solution, key decisions ~50 lines each). The code is the source of truth for flows and edge cases.

## Version directories

### Active

| Directory | Feature | Version |
|---|---|---|
| `v0.8.24/` | Code quality refactor — `fetchAndParse<T>()`, deliver decomposition, label CRUD consolidation, rework strategy map, remote dedup, ESLint tightening. Epic branch with 9 child PRs. Has `design.md`. | v0.8.24 |
| `v0.9.0/` | Design sub-phase in planner, Google Stitch integration, Playwright/axe-core/Lighthouse verification. Has `brief.md` + `design.md`. | v0.9.0 |

### Archived (deleted after shipping)

Shipped decision docs are deleted per the lifecycle above. For historical context, check git history.

- v0.5.12 — PR-based delivery, epic branches
- v0.7.0 — Verification gates, safety hooks, crash recovery
- v0.7.1 — Phase pipeline, Board type abstraction
- v0.7.4 — Pipeline stage labels, Board label methods
- v0.8.0 — Board ecosystem (6 boards), quiet hours, notifications
- qa-strategy — 3-layer QA (unit + integration + E2E). Completed v0.8.23.

## What does NOT belong here

- **Architecture docs** — those live in `docs/ARCHITECTURE.md`
- **Role descriptions** — those live in `docs/roles/`
- **Configuration guides** — those live in `docs/guides/`
- **Glossary** — that lives in `docs/GLOSSARY.md`
- **Code comments or inline docs** — those live next to the code
