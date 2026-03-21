# Development Process

How Clancy itself is developed. Covers the version lifecycle, review process, and doc maintenance.

**Last reviewed:** 2026-03-20

---

## Quick Reference

For experienced developers — one line per step:

1. **Brief** — create `docs/decisions/v{X}/brief.md` → DA review → user approval
2. **Design** — create `docs/decisions/v{X}/design.md` → DA review → user approval
3. **Plan** — create `docs/decisions/v{X}/execution-plan.md` → DA review → user approval
4. **Build** — branch, per-wave agents, tests after every wave, per-wave DA
5. **Doc Sweep** — 6 parallel agents update all docs, DA verifies, re-run tests
5b. **Self-Review** — line-level accuracy check on every changed file (comments, endpoints, fixtures, params)
6. **Ship** — PR + Copilot review, squash merge, npm publish, update memory
7. **Post-Ship** — trim decision docs, verify badge/version/memories

For hotfixes and patches, see [Lightweight Paths](#lightweight-paths).

---

## Version Development Lifecycle

Each version follows a formal lifecycle with approval gates and devil's advocate reviews.

### Document status header

Every brief, design doc, and execution plan must include a status header:

```markdown
**Status:** Draft | DA reviewed — awaiting user approval | Approved | Shipped (decisions only)
**Date:** YYYY-MM-DD
```

Update the status at each transition. This makes it clear where each doc is in the lifecycle.

### 1. Brief — What are we building and why?

- Read the roadmap (`ROADMAP.md` in the project root) for this version
- Create `docs/decisions/v{X}/brief.md` (problem, goals, non-goals, scope, ticket decomposition)
- Update `docs/decisions/README.md` Active table with the new version directory
- Set status: `Draft`
- Spin up a DA agent to review the brief (use Claude Code sub-agent with a prompt asking it to check for gaps, contradictions, scope issues, ticket sizing, missing risks)
- **Address all DA findings and update the brief BEFORE presenting to the user.** Addressing means either changing the document or adding a note explaining why a finding was intentionally not addressed.
- Update status: `DA reviewed — awaiting user approval`
- User reviews + leaves feedback → re-brief if needed (status stays `DA reviewed`)
- User approves → update status: `Approved`

### 2. Design — How does it work?

- Create `docs/decisions/v{X}/design.md` from the brief
- Set status: `Draft`
- Spin up a DA agent to review the design doc
- **Address all DA findings and update the design doc BEFORE presenting to the user**
- Update status: `DA reviewed — awaiting user approval`
- User reviews + leaves feedback → revise if needed
- User approves → update status: `Approved`

### 3. Plan — How do we build it?

- Create `docs/decisions/v{X}/execution-plan.md` (waves, agents, file lists, review gates)
- Set status: `Draft`
- Spin up a DA agent to review the execution plan
- **Address all DA findings and update the execution plan BEFORE presenting to the user**
- Update status: `DA reviewed — awaiting user approval`
- User reviews + leaves feedback → revise if needed
- User approves → update status: `Approved`

### 4. Build — Execute the plan

- Create branch (`feature/v{X}` or `feature/{feature-name}`)
- Per-wave implementation with parallel agents (wave scope defined in the execution plan)
- **All tests must pass after every wave** — run `npm test && npm run typecheck && npm run lint` and verify 0 failures before committing. Never push code with failing tests.
- Per-wave DA review between each wave (catches foundation issues before later waves build on them)
- Fix DA findings before proceeding to next wave
- Self-review changed files after final wave (see [step 5b](#5b-self-review--line-level-accuracy-check))

### 5. Doc Sweep — Update every doc

The doc sweep is the **execution** phase — parallel agents update all documentation. The [Pre-Merge Sweep Checklist](#pre-merge-sweep-checklist) below is the **verification** — a manual check that nothing was missed.

Spin up parallel agents to update ALL documentation:

| Agent | Files | What it updates |
|---|---|---|
| 1 | CLAUDE.md, .github/copilot-instructions.md, .github/pull_request_template.md, src/templates/CLAUDE.md | Key paths, technical details, hook/board counts, architecture overview |
| 2 | README.md, docs/COMPARISON.md | Test badge, feature list, board count, comparison table |
| 3 | CHANGELOG.md, package.json, package-lock.json (sync via `npm install --package-lock-only`) | Version bump, changelog entry, test count |
| 4 | docs/roles/*.md, docs/guides/CONFIGURATION.md | Role docs reflect new features, new env vars documented |
| 5 | docs/ARCHITECTURE.md, docs/VISUAL-ARCHITECTURE.md | Module map, phase list, diagrams, board nodes |
| 6 | docs/GLOSSARY.md, docs/LIFECYCLE.md | New terms defined, lifecycle steps updated |

Then spin up a DA agent that reads ALL files touched by agents 1-6 and checks for:
- Contradictions between docs
- Stale references agents missed
- Test count consistency across README, CHANGELOG, MEMORY
- Version consistency across package.json, CHANGELOG, CLAUDE.md
- Missing items from the pre-merge sweep checklist

**Re-verify after doc sweep:** Run `npm test && npm run typecheck && npm run lint` to ensure doc agents didn't break anything (especially package.json and lock file changes).

### 5b. Self-Review — Line-level accuracy check

After DA review and doc sweep, before creating the PR, read every changed file (`git diff main...HEAD`) and check for detail-level issues that DA and doc agents miss:

**Code accuracy:**
- Do comments/JSDoc match what the code actually does? (stale comments are the #1 review catch)
- Are all function parameters used? If not, remove or use them
- Do mock/test URLs match the actual production endpoints? (read the production code to verify)
- Do fixture shapes match what the production code expects? (check Zod schemas and actual API calls)

**Consistency:**
- Are constants duplicated across files? (single source of truth)
- Are imports unused?
- Do config options extend defaults rather than replacing them?

**Security/robustness:**
- Is `execSync` used with string interpolation? (use `execFileSync` with argument arrays)
- Are test credential values constructed at runtime where needed? (GitHub secret scanner)

This step bridges the gap between the DA (architecture-level) and Copilot (line-level). Goal: reduce Copilot review rounds from 3-4 to 1.

### 6. Ship — Merge, publish, update memory

- Create PR with label, assignee, and `--reviewer @copilot` (Copilot review starts immediately on PR creation)
- Copilot review rounds — fix all findings before merge. Address or decline each comment with reasoning.
- Squash merge to main (PR title = squash commit message, must follow gitmoji + conventional commit format)
- Publish to npm: `npm publish`
- Update MEMORY.md (current state, shipped versions, next steps) — do this AFTER publish succeeds

### 7. Post-Ship — Trim and verify

- Trim `docs/decisions/v{X}/` — delete execution-plan.md, trim brief + design to decisions-only (~50 lines each)
- Update `docs/decisions/README.md` — move version from Active to Shipped table
- Update decision doc statuses to `Shipped (decisions only)`
- Verify: test badge matches, version correct, memories updated, no stale refs
- **Memory hygiene:** scan MEMORY.md for memories created during this feature. Merge any that overlap with existing memories. Delete milestone/progress memories. See [Memory Hygiene](#memory-hygiene) section.

---

## Lightweight Paths

Not all changes need the full 7-step lifecycle.

### Hotfixes / Patches (e.g. v0.8.1)

For bug fixes and small enhancements that don't warrant a full brief/design:

1. **Skip steps 1-3** (brief, design, plan) — go straight to Build
2. Create a `fix/` or `feature/` branch
3. Implement the fix with tests
4. DA review (for non-trivial changes)
5. Self-review changed files (step 5b — line-level accuracy check)
6. Run the pre-merge sweep checklist (abbreviated — focus on CHANGELOG, version bump, test badge)
7. PR + Copilot review → merge → publish
8. No decision doc directory needed (the fix is documented in the CHANGELOG)

### Docs-only changes

Direct to main, no PR needed. See the [direct-to-main rule](../GIT.md) in GIT.md.

Examples: glossary updates, architecture doc updates, decision doc trims, README badge fixes, typo corrections, CLAUDE.md doc link updates.

**Exception:** executable markdown (`src/roles/`, `src/templates/`, `src/agents/`) always needs a PR — these are code, not docs.

### Abandoned versions

If a version is started but abandoned:
1. Delete the `docs/decisions/v{X}/` directory
2. Note in `docs/decisions/README.md` under a "Deleted" section (optional)
3. Delete any feature branch

---

## Devil's Advocate Reviews

Spin up a review agent at every necessary phase of work — not just after code.

### When to review

| Phase | What the DA checks |
|---|---|
| **Brief created** | Scope, gaps, contradictions with roadmap, ticket sizing, missing risks |
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

The verification counterpart to the doc sweep (step 5). After doc agents run and before creating the PR, verify these manually:

**Always check:**
1. README.md test badge — does combined count (unit + integration) match `npm test` + `npm run test:integration` output?
2. CHANGELOG.md — entry present with correct version, date, and test count?
3. package.json version bump + package-lock.json synced (`npm install --package-lock-only`)?
4. CLAUDE.md — key paths, technical details, commands, hook count, board count?
5. docs/ARCHITECTURE.md — new modules, phases, functions listed?
6. docs/GLOSSARY.md — new terms/concepts defined?
7. docs/LIFECYCLE.md — if roles, phases, or commands changed?
8. docs/VISUAL-ARCHITECTURE.md — diagrams reflect new boards/phases/hooks?
9. docs/decisions/README.md — decision docs in correct table (active/shipped)?
10. docs/COMPARISON.md — comparison table reflects current feature set?
11. docs/roles/*.md — role docs reflect new features?
12. docs/guides/CONFIGURATION.md — new env vars documented?

**Check if touched:**
13. .github/copilot-instructions.md — reflects current architecture?
14. .github/pull_request_template.md — checklists up to date?
15. src/templates/CLAUDE.md — template for user projects current?
16. Memory files (MEMORY.md) — stale descriptions, test counts, version refs?

---

## Memory Hygiene

Memory files in `.claude/projects/.../memory/` accumulate over time. Without maintenance they overlap, go stale, and stop being useful. Follow these rules:

### When creating a new memory
- **Check for overlap first.** Read MEMORY.md and search for existing memories on the same topic. Update the existing memory instead of creating a new one.
- **One concern per file.** Don't add unrelated rules to an existing memory just because the file exists.
- **Be specific about triggers.** "Check the badge" is vague. "Run `npm test` + `npm run test:integration`, add counts, update badge" is actionable.

### When to consolidate
- **After every major feature ships** (post-ship step 7): scan MEMORY.md for memories that were created during the feature work. Merge any that overlap with existing memories.
- **When the same mistake happens twice despite having a memory about it:** The memory isn't specific enough. Rewrite it with the exact failure mode and the exact steps to prevent it.
- **When MEMORY.md exceeds 150 lines:** Time to consolidate. Group related memories, merge overlapping ones, delete stale ones.

### When to delete
- **Progress/milestone memories** (e.g., "v0.3.0 rewrite complete") — delete after shipping. The CHANGELOG is the historical record.
- **Memories superseded by docs** — if the rule is now in DEVELOPMENT.md or CONVENTIONS.md, the memory is redundant. Delete it.
- **Memories about code that no longer exists** — grep for the function/file/pattern. If it's gone, the memory is stale.

### MEMORY.md structure
Organise by category, not chronologically:
- **Process** — how to work (review phases, PR rules, release checklist)
- **Project** — what we're building (planned features, parked ideas)
- **Reference** — where to find things (GitHub settings, external tool analysis)

---

## When to update this doc

Update DEVELOPMENT.md when:
- A new step is added to the lifecycle
- A new doc is added to the sweep checklist
- The DA review process changes
- A new lightweight path is needed (e.g., security patches, dependency updates)
- The memory hygiene rules change
