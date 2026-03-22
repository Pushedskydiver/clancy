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
5b. **Review Gate** — DA review (architecture) → self-review (line-level) → pre-merge sweep (artifacts). **This order is strict — DA always runs before self-review.**
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

- **Break large tickets into the smallest shippable PRs.** Each PR should do one thing well. Benefits: fewer review rounds, smaller blast radius, faster merges, easier to revert. If a ticket has multiple unknowns (e.g. "figure out mocking strategy" + "write tests for 6 boards"), split them — solve the unknowns first in a small PR, then build on the proven pattern.
- Create branch (`feature/v{X}` or `feature/{feature-name}`) — one branch per PR
- Per-wave implementation with parallel agents (wave scope defined in the execution plan)
- **All tests must pass after every wave** — run `npm test && npm run typecheck && npm run lint` and verify 0 failures before committing. Never push code with failing tests.
- Per-wave DA review between each wave (catches foundation issues before later waves build on them)
- Fix DA findings before proceeding to next wave
- After final wave, run the [Review Gate](#5b-review-gate--da--self-review--pre-merge-sweep): DA review → self-review → pre-merge sweep. **DA must run before self-review** — DA catches architectural issues that change what the self-review should focus on.
- **Session handoff:** Start a new chat session after every 3 merged PRs, or when context compression is detected — whichever comes first. Always finish the current PR before handing off. Provide a ready-to-paste handoff prompt with: what shipped (PR numbers, versions), what's next (ticket, spec file, key decisions), current branch state. Fresh sessions have full context window + all memory files loaded clean.

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

### 5b. Review Gate — DA → Self-Review → Pre-Merge Sweep

Three checks, in this strict order, before creating the PR:

**1. DA Review (architecture-level)**
Spin up a devil's advocate agent to review all changed files. For non-trivial changes this is mandatory. DA catches architectural issues, stale references, missing edge cases, and test coverage gaps.

What is **non-trivial**? Code with logic (new functions, changed conditionals, refactored modules), changed type signatures, orchestrator flow changes, new env vars, test infrastructure changes. **Trivial** = typos, badge updates, reformatting, adding test cases to proven structures. When in doubt, run DA.

**2. Self-Review (line-level)**
Run through the **[Self-Review Checklist](SELF-REVIEW.md)**. Read every changed file (`git diff main...HEAD`) and check for detail-level issues that DA and doc agents miss — stale comments, wrong endpoints, fixture shapes, unused params.

**3. Pre-Merge Sweep (artifacts)**
Run the [Pre-Merge Sweep Checklist](#pre-merge-sweep-checklist). Verify README badge, CHANGELOG, version bump, CLAUDE.md, and all docs are consistent.

**Why this order matters:** DA may flag issues that change the code, which invalidates a self-review done earlier. Self-review may fix issues that change test counts, which invalidates a pre-merge sweep done earlier. Running them out of order means repeating work or shipping with stale artifacts.

The self-review checklist is a **living document** — when Copilot catches something the self-review should have spotted, add the check to [SELF-REVIEW.md](SELF-REVIEW.md) immediately.

### 6. Ship — Merge, publish, update memory

- Create PR with label and assignee. Then request Copilot review via the API (`gh pr create --reviewer copilot` does NOT work):
  ```bash
  gh api repos/{owner}/{repo}/pulls/{number}/requested_reviewers \
    -X POST -f "reviewers[]=copilot-pull-request-reviewer[bot]"
  ```
  Available PR labels — use the one matching your branch prefix:
  - `feature/` → `feature` | `fix/` → `fix` | `chore/` → `chore`
  - Do not create new PR labels unless adding a new branch prefix type — no one-off topic labels (e.g. `QA`, `docs`). Ask the user before creating any new label.
- **If pushing additional commits to an open PR, update the PR body** (`gh pr edit`) to reflect all changes. Reviewers and Copilot read the body to understand scope — a stale body that only describes the original changes is misleading.
- Copilot review rounds — fix all findings before merge. For each comment:
  1. **Evaluate** — Copilot's suggestions are directionally correct but not always optimal. Read the suggestion, understand the underlying issue, then decide whether the suggested fix is the best approach or if there's a simpler/more efficient solution.
  2. **Fix or decline** — apply your own fix if better, apply Copilot's suggestion if it's the best option, or decline with reasoning if the comment is incorrect.
  3. **Reply** — always reply to every comment (`gh api` with `in_reply_to`) explaining what was done and why. Never leave comments unanswered.
- Squash merge to main (PR title = squash commit message, must follow gitmoji + conventional commit format)
- Publish to npm: `npm publish`
- Update MEMORY.md (current state, shipped versions, next steps) — do this AFTER publish succeeds

### 7. Post-Ship — Trim and verify

- Trim `docs/decisions/v{X}/` — delete execution-plan.md, trim brief + design to decisions-only (~50 lines each)
- Update `docs/decisions/README.md` — move version from Active to Shipped table
- Update decision doc statuses to `Shipped (decisions only)`
- Verify: test badge matches, version correct, memories updated, no stale refs
- **Memory hygiene:** scan MEMORY.md for memories created during this feature. Merge any that overlap with existing memories. Delete milestone/progress memories. See [Memory Hygiene](#memory-hygiene) section.
- **Dependency check:** run `npm outdated` — update any safe minor/patch bumps. Run `npx depcheck` if you suspect unused dependencies.

---

## Lightweight Paths

Not all changes need the full 7-step lifecycle. Use this decision matrix:

| Path | When to use | Steps |
|---|---|---|
| **Full** | New commands, roles, orchestrator phases, board integrations | brief → design → plan → build → review gate → doc sweep → ship |
| **Lightweight** | Bug fixes, refactors, test additions, chores, patches | build → review gate → ship |
| **Docs-only** | Glossary, architecture docs, decision docs, typo fixes, badges | Direct to main, no PR (only when no branch/PR is open — otherwise commit to current branch) |

**Rule of thumb:** if it changes runtime behaviour or test infrastructure, use Lightweight minimum. If it adds a user-facing capability, use Full.

### Hotfixes / Patches (e.g. v0.8.1)

For bug fixes and small enhancements that don't warrant a full brief/design:

1. **Skip steps 1-3** (brief, design, plan) — go straight to Build
2. **Break into small PRs** — if the work has multiple unknowns or touches many files, split into smaller PRs. One PR per concern.
3. Create a `fix/` or `feature/` branch
4. Implement the fix with tests
5. **Review Gate (same strict order as full lifecycle):**
   - **DA review** — spin up DA agent for non-trivial changes
   - **Self-review** — [Self-Review Checklist](SELF-REVIEW.md) on all changed files
   - **Pre-merge sweep** — README badge, CHANGELOG, version bump, test counts
6. PR + Copilot review → merge → publish
7. No decision doc directory needed (the fix is documented in the CHANGELOG)

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

Memory files in `~/.claude/projects/{project-slug}/memory/` accumulate over time. Without maintenance they overlap, go stale, and stop being useful. Follow these rules:

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
