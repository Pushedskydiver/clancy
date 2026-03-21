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

### Shipped (decisions only)

| Directory | Feature | Version |
|---|---|---|
| `v0.5.12/` | PR-based delivery, epic branches, epic completion detection | v0.5.12 |
| `v0.7.0/` | Verification gates, safety hooks, crash recovery, Claude Code hook API research | v0.7.0 |
| `v0.7.1/` | Phase pipeline, Board type abstraction, switch elimination | v0.7.1 |
| `v0.7.4/` | Pipeline stage labels (clancy:brief, clancy:plan, clancy:build), Board label methods, backward compatibility | v0.7.4 |
| `v0.8.0/` | Board ecosystem (6 boards), quiet hours, desktop notifications, drift detector, version tracking | v0.8.0 |

### Active

| Directory | Feature | Version |
|---|---|---|
| `v0.9.0/` | Design sub-phase in planner, Google Stitch integration, Playwright/axe-core/Lighthouse verification. Has `brief.md` + `design.md`. | v0.9.0 |

### Cross-cutting

| Directory | Purpose |
|---|---|
| `qa-strategy/` | 2-layer QA plan (integration tests + E2E). 5 tickets: infrastructure, implementer flows, board API/pipeline/hooks, E2E real platforms, CI wiring. Ships incrementally as v0.8.x patches before v0.9.0. |

## What does NOT belong here

- **Architecture docs** — those live in `docs/ARCHITECTURE.md`
- **Role descriptions** — those live in `docs/roles/`
- **Configuration guides** — those live in `docs/guides/`
- **Glossary** — that lives in `docs/GLOSSARY.md`
- **Code comments or inline docs** — those live next to the code
