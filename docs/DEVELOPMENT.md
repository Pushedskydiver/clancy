# Development Process

How Clancy itself is developed. Covers the version lifecycle, review process, and doc maintenance.

---

## Version Development Lifecycle

Each version follows a formal lifecycle with approval gates and devil's advocate reviews:

### 1. Brief — What are we building and why?

- Read the roadmap for this version
- Create `docs/decisions/v{X}/brief.md` (problem, goals, non-goals, scope, ticket decomposition)
- Spin up a DA agent to review the brief
- User reviews + leaves feedback → re-brief if needed
- User approves the brief

### 2. Design — How does it work?

- Create `docs/decisions/v{X}/design.md` from the brief
- Spin up a DA agent to review the design doc
- User reviews + leaves feedback → revise if needed
- User approves the design

### 3. Plan — How do we build it?

- Create `docs/decisions/v{X}/execution-plan.md` (waves, agents, file lists, review gates)
- Spin up a DA agent to review the execution plan
- User reviews + leaves feedback → revise if needed
- User approves the plan

### 4. Build — Execute the plan

- Create branch (`feature/v{X}` or `feature/{feature-name}`)
- Per-wave implementation with parallel agents
- **All tests must pass after every wave** — run `npm test && npm run typecheck && npm run lint` and verify 0 failures before committing. Never push code with failing tests.
- Per-wave DA review between each wave (catches foundation issues before later waves build on them)
- Fix DA findings before proceeding to next wave

### 5. Doc Sweep — Update every doc

Before creating the PR, spin up parallel agents to update ALL documentation:

| Agent | Files | What it updates |
|---|---|---|
| 1 | CLAUDE.md, .github/copilot-instructions.md, .github/pull_request_template.md, src/templates/CLAUDE.md | Key paths, technical details, hook/board counts, architecture overview |
| 2 | README.md, docs/COMPARISON.md | Test badge, feature list, board count, comparison table |
| 3 | CHANGELOG.md, package.json, package-lock.json | Version bump, changelog entry, test count, lock sync |
| 4 | docs/roles/*.md, docs/guides/CONFIGURATION.md | Role docs reflect new features, new env vars documented |
| 5 | docs/ARCHITECTURE.md, docs/VISUAL-ARCHITECTURE.md | Module map, phase list, diagrams, board nodes |
| 6 | docs/GLOSSARY.md, docs/LIFECYCLE.md | New terms defined, lifecycle steps updated |

Then spin up a DA agent that reads ALL files touched by agents 1-6 and checks for:
- Contradictions between docs
- Stale references agents missed
- Test count consistency across README, CHANGELOG, MEMORY
- Version consistency across package.json, CHANGELOG, CLAUDE.md
- Missing items from the pre-merge sweep checklist

### 6. Ship — Merge, publish, update memory

- Create PR with label + assignee
- Copilot review rounds (fix all findings)
- Squash merge to main
- Publish to npm: `npm publish`
- Update MEMORY.md (current state, shipped versions, next steps)

### 7. Post-Ship — Trim and verify

- Trim `docs/decisions/v{X}/` — delete execution-plan.md, trim brief + design to decisions-only (~50 lines each)
- Update `docs/decisions/README.md` index
- Verify: test badge matches, version correct, memories updated, no stale refs

---

## Devil's Advocate Reviews

Spin up a review agent at every necessary phase of work — not just after code.

### When to review

| Phase | What the DA checks |
|---|---|
| **Design doc created/updated** | Gaps, contradictions, feasibility, missing edge cases, consistency with existing patterns |
| **Execution plan created** | Wave ordering, agent scope overlap, test coverage, risk completeness |
| **Each implementation wave** | Bugs, stale references, missing tests, type safety, backward compatibility |
| **Pre-PR (doc sweep)** | Cross-doc consistency, test counts, version numbers, terminology |
| **After Copilot feedback** | Verify fixes didn't introduce new issues |

### What the DA checks (by phase)

**Design docs:**
- Gaps in edge case coverage
- Contradictions between docs
- Feasibility of proposed approach
- Missing env vars, API calls, or error handling
- Consistency with existing patterns in the codebase

**Execution plans:**
- Wave ordering dependencies
- Agent scope overlap or gaps
- Test file coverage
- Risk assessment completeness

**Code:**
- Bugs and logic errors
- Edge cases not handled
- Stale references (test counts, versions, renamed files)
- Missing tests for new functions
- Cross-doc consistency
- Backward compatibility
- Code complexity

### When NOT to review

Trivial docs-only changes pushed directly to main (typo fixes, badge updates). The bar is: **if the work has decisions or logic that could be wrong, it gets reviewed.**

---

## Pre-Merge Sweep Checklist

Before creating or merging any PR with code changes, check these artifacts:

**Always check:**
1. README.md test badge — does count match `npm test` output?
2. CHANGELOG.md — entry present with correct version, date, and test count?
3. package.json version bump + package-lock.json synced?
4. CLAUDE.md — key paths, technical details, commands, hook count, board count?
5. docs/ARCHITECTURE.md — new modules, phases, functions listed?
6. docs/GLOSSARY.md — new terms/concepts defined?
7. docs/LIFECYCLE.md — if roles, phases, or commands changed?
8. docs/VISUAL-ARCHITECTURE.md — diagrams reflect new boards/phases/hooks?
9. docs/decisions/README.md — decision docs moved to shipped/deleted?
10. docs/COMPARISON.md — comparison table reflects current feature set?
11. docs/roles/*.md — role docs reflect new features?
12. docs/guides/CONFIGURATION.md — new env vars documented?

**Check if touched:**
13. .github/copilot-instructions.md — reflects current architecture?
14. .github/pull_request_template.md — checklists up to date?
15. src/templates/CLAUDE.md — template for user projects current?
16. Memory files (MEMORY.md) — stale descriptions, test counts, version refs?
