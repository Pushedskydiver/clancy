# Glossary

Ubiquitous language for the Clancy project. Use these terms consistently in code, docs, commits, and agent prompts.

## Roles

| Term | Definition |
|---|---|
| **Implementer** | Core role. Picks up tickets from the board, implements them, delivers via PR. Commands: `/clancy:once`, `/clancy:run`, `/clancy:dry-run`. |
| **Reviewer** | Core role. Reviews completed work, checks quality, manages logs. Commands: `/clancy:review`, `/clancy:status`, `/clancy:logs`. |
| **Setup** | Core role. Configuration and maintenance. Commands: `/clancy:init`, `/clancy:settings`, `/clancy:doctor`, `/clancy:update`, `/clancy:map-codebase`, `/clancy:update-docs`, `/clancy:uninstall`, `/clancy:help`. |
| **Planner** | Optional role. Generates implementation plans for tickets before coding begins. Commands: `/clancy:plan`, `/clancy:approve-plan`. |
| **Strategist** | Optional role (v0.6.0). Decomposes vague ideas into actionable tickets via research and stakeholder grilling. Commands: `/clancy:brief`, `/clancy:approve-brief`. |

## Delivery

| Term | Definition |
|---|---|
| **Board** | The project management tool (Jira, GitHub Issues, or Linear) where tickets live. Clancy reads from and writes to the board via API. |
| **Ticket** | A unit of work on the board (Jira issue, GitHub issue, Linear issue). Clancy fetches, implements, and transitions tickets. |
| **Parented ticket** | A ticket that has a parent (epic in Jira, milestone in GitHub, parent issue in Linear). Delivered via PR to the epic branch. |
| **Standalone ticket** | A ticket with no parent. Delivered via PR directly to the base branch. |
| **Epic branch** | A long-lived branch where child ticket PRs are merged. Named `epic/{key}` for Jira/Linear (e.g. `epic/proj-100`) or `milestone/{slug}` for GitHub (e.g. `milestone/v2-launch`). Created on first child implementation. When all children are done, the epic branch gets a PR to the base branch. |
| **Base branch** | The branch configured as `CLANCY_BASE_BRANCH` (default: `main`). The target for standalone ticket PRs and epic PRs. |
| **Feature branch** | A short-lived branch (e.g. `feature/proj-101`) created for implementing a single ticket. PRs target either the epic branch or base branch. |
| **Single-child skip** | Optimisation: if an epic has only one child ticket, skip the epic branch overhead — deliver the child PR directly to the base branch. |
| **Epic completion** | When all children of an epic are done (PRs merged), Clancy auto-creates a PR from the epic branch to the base branch. |
| **Migration guard** | Safety check: if an epic branch exists locally but not on the remote (from the old squash-merge flow), block and show instructions to push manually. |

## Once Orchestrator

| Term | Definition |
|---|---|
| **Once** | A single ticket execution cycle: preflight → fetch ticket → implement → deliver → log. Entry point: `/clancy:once`. |
| **Run** | AFK loop that calls once repeatedly until the queue is empty or `MAX_ITERATIONS` (default 5) is reached. Stops early on preflight failure, skipped tickets, or other stop conditions. Entry point: `/clancy:run`. |
| **Preflight** | Startup checks: `.clancy/.env` exists, credentials valid, board reachable. Runs before every ticket. |
| **Blocker check** | Before implementing a ticket, the implementer checks its blocking dependencies on the board. If any blocker is incomplete, the ticket is skipped and the next one is picked up. Uses `fetchBlockerStatus` per-board: Jira checks issueLinks, GitHub parses "Blocked by #N" from body, Linear checks relations API. |
| **fetchBlockerStatus** | Per-board function (`src/scripts/board/{jira,github,linear}/`) that returns whether a ticket's blocking dependencies are resolved. Called during ticket fetch to skip blocked tickets. |
| **HITL/AFK queue filtering** | In AFK mode (`CLANCY_AFK_MODE=1`), the ticket fetch step excludes tickets labelled `clancy:hitl` so only autonomous-safe tickets are picked up. Interactive mode processes all tickets. |
| **Dual-mode fetchChildrenStatus** | `fetchEpicChildrenStatus` in `board-ops` dispatches to per-board `fetchChildrenStatus` functions. Returns child ticket statuses for epic completion detection — used by both the implementer (epic PR creation) and strategist (brief context). |
| **Feasibility check** | After fetching a ticket, Clancy assesses whether the work is achievable in the current codebase context. Skippable with `--skip-feasibility`. |
| **Rework** | Automatic re-implementation triggered by PR review comments. Inline code comments always trigger; conversation comments need `Rework:` prefix. |
| **Max rework guard** | Safety limit: `CLANCY_MAX_REWORK` (default 3) caps the number of rework cycles per ticket to prevent infinite loops. |
| **Progress entry** | A line in `.clancy/progress.txt` recording a completed action. Statuses: `DONE`, `SKIPPED`, `PR_CREATED`, `PUSHED`, `PUSH_FAILED`, `LOCAL`, `PLAN`, `APPROVE`, `REWORK`, `EPIC_PR_CREATED`, `BRIEF`, `APPROVE_BRIEF`. |
| **TDD mode** | Test-driven development mode enabled by `CLANCY_TDD=true`. The implementer writes tests first (red), implements (green), then refactors. |

## Strategist (v0.6.0)

| Term | Definition |
|---|---|
| **Brief** | A strategic decomposition document generated by `/clancy:brief`. Contains problem statement, goals, discovery Q&A, user stories, ticket decomposition, and risks. Stored in `.clancy/briefs/`. |
| **Grill phase** | The relentless clarification step before brief generation. The strategist walks every branch of the design tree, resolving dependencies between decisions one by one. The goal is zero ambiguity before a single ticket is written. Inspired by Matt Pocock's "grill me" skill. |
| **Human grill** | Interactive grill mode (default). The strategist interviews the human relentlessly — pushes back on vague answers, follows each thread to its conclusion, and explores the codebase instead of asking when the answer is in the code. Two-way: the user can ask questions back and the strategist researches and answers. Does NOT generate the brief until shared understanding is reached. |
| **AI-grill** | Autonomous grill mode (triggered by `--afk` flag or `CLANCY_MODE=afk`). A devil's advocate agent interrogates its sources (codebase, board, web) to answer clarifying questions. Same relentless energy as the human grill — challenges its own answers, flags conflicts between sources, and follows self-generated follow-ups to their conclusion. Never asks the human. Single pass. |
| **Discovery section** | Q&A output from the grill phase, included in every brief. Each answer is tagged with its source: `(Source: human)`, `(Source: codebase)`, `(Source: board)`, `(Source: web)`. |
| **Open Questions** | Questions the grill phase couldn't resolve — surfaced in the brief for the PO to address during review. |
| **Vertical slice** | A ticket that cuts through all integration layers to deliver one thin, working piece of functionality end-to-end. Opposite of horizontal layers (e.g. "set up DB schema", "build API", "create UI"). |
| **HITL** | Human-in-the-loop. A ticket tagged as requiring human judgement during implementation (credentials, design decisions, external setup). |
| **AFK** | A ticket tagged as implementable autonomously by `/clancy:once` or `/clancy:run` without human intervention. |
| **Ticket decomposition** | The table in a brief listing proposed child tickets with title, description, size, dependencies, and mode (AFK/HITL). Max 10 tickets. |
| **Approve brief** | The act of converting a brief's decomposition into real tickets on the board. Creates child tickets, links dependencies, posts a tracking comment. |
| **Batch mode** | Running `/clancy:brief N` to brief multiple tickets from the queue in sequence (e.g. `/clancy:brief 3`). Implies AI-grill (no human questions). Max 10 per batch. |
| **Stale brief** | An unapproved brief older than 7 days. The stale brief hook checks on SessionStart and warns the user. |
| **Devil's advocate agent** | The agent prompt used during AI-grill to interrogate sources (codebase, board, web) and challenge its own answers. Lives in `src/agents/` alongside the map-codebase specialist agents. |
| **Epic reference convention** | Child tickets include `Epic: {key}` in their description (e.g. `Epic: PROJ-100`, `Epic: #50`, `Epic: ENG-42`). This text convention enables cross-platform epic completion detection. |

## Planner

| Term | Definition |
|---|---|
| **Plan** | An implementation plan generated by `/clancy:plan` for a specific ticket. Describes the approach, files to change, and steps. Posted as a comment on the ticket (marked with `## Clancy Implementation Plan` header). |
| **Approve plan** | Human approval of a plan before implementation begins. `/clancy:approve-plan`. |
| **Auto-detect feedback** | The planner checks for feedback on existing plans automatically (no `--force` needed). `--fresh` starts over. |

## Infrastructure

| Term | Definition |
|---|---|
| **Hook** | A Node.js CommonJS script in `hooks/` that runs on Claude Code events (SessionStart, PreToolUse, etc.). Best-effort — must never crash or block. |
| **Board module** | TypeScript code in `src/scripts/board/{jira,github,linear}/` that handles API communication with a specific board platform. |
| **Remote** | The git hosting platform (GitHub, GitLab, Bitbucket). Detected from the git remote URL via `parseRemote()`. |
| **Bundle** | The esbuild-compiled runtime scripts (`clancy-once.js`, `clancy-afk.js`) copied to `.clancy/` during install. Self-contained, zero npm dependency. |
| **Command** | A user-facing markdown file in `src/roles/*/commands/` that defines a slash command (e.g. `/clancy:once`). |
| **Workflow** | An implementation-detail markdown file in `src/roles/*/workflows/` referenced by commands. Not directly invocable by users. |
| **Map codebase** | `/clancy:map-codebase` — scans the codebase with 5 parallel specialist agents (architecture, concerns, design, quality, tech) and writes documentation to `.clancy/docs/`. |
| **Update docs** | `/clancy:update-docs` — incrementally refreshes `.clancy/docs/` based on recent changes without a full rescan. |
| **Board registry** | `registry/boards.json` — registry for community board integrations (Shortcut, Notion, etc.). Future use. |
