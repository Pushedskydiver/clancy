# Strategist Role *(optional)*

The strategist decomposes vague ideas into actionable, well-structured tickets **before** they reach the planner or implementer. It uses a grill phase to eliminate ambiguity, then generates a brief with a ticket decomposition table.

## Enable the Strategist

The strategist is an optional role. To enable it, add `strategist` to `CLANCY_ROLES` in `.clancy/.env` and re-run the installer:

```bash
echo 'CLANCY_ROLES="strategist"' >> .clancy/.env
npx chief-clancy@latest --local   # or --global
```

You can also toggle it via `/clancy:settings`.

## How it works

1. Takes input — a board ticket, inline text, or file path describing a vague idea
2. Runs a grill phase (human-interactive or AI-autonomous) to resolve ambiguity
3. Researches the codebase and external context via specialist agents
4. Generates a structured brief with problem statement, discovery Q&A, ticket decomposition
5. Saves the brief to `.clancy/briefs/` and (if board-sourced) posts as a comment
6. On approval, creates tickets on the board with dependencies, labels, and epic references

## Commands

| Command | What it does |
| --- | --- |
| `/clancy:brief` | Grill and generate a brief from a vague idea |
| `/clancy:brief PROJ-123` | Brief a specific board ticket |
| `/clancy:brief 3` | Brief up to 3 tickets in batch mode (max 10, implies AI-grill) |
| `/clancy:brief --afk` | Force AI-grill mode for this invocation |
| `/clancy:brief --fresh` | Discard any existing brief and start from scratch |
| `/clancy:approve-brief` | Create tickets on the board from the most recent unapproved brief |
| `/clancy:approve-brief PROJ-123` | Approve a specific brief |

Arguments can appear in any order (e.g. `/clancy:brief 3 --afk` or `/clancy:brief --fresh PROJ-123`).

## Grill phase

The grill phase is the relentless clarification step before brief generation. It walks every branch of the design tree, resolving dependencies between decisions one by one. The goal is zero ambiguity before a single ticket is written.

### Human grill (default)

Interactive mode. The strategist interviews the human — pushes back on vague answers, follows each thread to its conclusion, and explores the codebase instead of asking when the answer is in the code. Two-way: the user can ask questions back and the strategist researches and answers. Typically 2-5 rounds.

The brief is NOT generated until shared understanding is reached.

### AI-grill (`--afk` or `CLANCY_MODE=afk`)

Autonomous mode. A devil's advocate agent (prompt: `src/agents/devils-advocate.md`) interrogates its sources — codebase, board context, and web — to answer clarifying questions. Same relentless energy as the human grill: challenges its own answers, flags conflicts between sources, and follows self-generated follow-ups to their conclusion. Never asks the human. Single pass.

AI-grill is implied when running in batch mode (`/clancy:brief 3`).

## Brief template

The generated brief includes (in this order):

- **Problem Statement** — what problem this solves and why it matters
- **Goals / Non-Goals** — explicit scope boundaries
- **Discovery** — Q&A from the grill phase, each answer tagged with source: `(Source: human)`, `(Source: codebase)`, `(Source: board)`, `(Source: web)`
- **User Stories** — who benefits and how
- **Ticket Decomposition** — table of proposed child tickets with title, description, size (S/M/L), dependencies, and mode (`AFK` or `HITL`). Max 10 tickets, vertical slices preferred
- **Open Questions** — unresolved items for the PO to address during review
- **Success Criteria** — measurable outcomes
- **Risks** — potential issues, technical debt, or unknowns

## Approve flow

When `/clancy:approve-brief` runs, it:

1. **Auto-selects** — if no ticket key is provided, picks the oldest unapproved brief from `.clancy/briefs/` and shows a confirmation prompt
2. Parses the ticket decomposition table from the brief
3. **Topological sort** — orders tickets by dependency (blockers created first)
4. **Confirmation** — displays the HITL/AFK breakdown and asks for approval
5. **Creates tickets** on the board sequentially (500ms delay between creates):
   - Each ticket description includes `Epic: {key}` for cross-platform epic completion detection
   - Labels: `clancy:afk` for autonomous tickets, `clancy:hitl` for human-in-the-loop tickets
   - Issue type configurable via `CLANCY_BRIEF_ISSUE_TYPE`
   - Parent epic configurable via `CLANCY_BRIEF_EPIC`
6. **Links dependencies** — creates blocking relationships between tickets on the board
7. **Marks brief as approved** — writes `.approved` marker file
8. Displays a summary with next steps

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLANCY_MODE` | `interactive` | Grill mode: `interactive` (human) or `afk` (AI-grill). Override per-invocation with `--afk` |
| `CLANCY_BRIEF_ISSUE_TYPE` | Board default | Issue type for created tickets (e.g. `Story`, `Task`) |
| `CLANCY_BRIEF_EPIC` | — | Parent epic key for created tickets (e.g. `PROJ-100`, `#50`) |
| `CLANCY_COMPONENT` | — | Component/platform filter — limits research and ticket scope to a specific area |
| `CLANCY_ROLES` | — | Must include `strategist` to enable this role |

## Integration with other roles

The strategist sits at the start of the pipeline:

```
/clancy:brief          Grill + generate brief
      |
Human reviews brief    PO reviews on board or in .clancy/briefs/
      |
/clancy:approve-brief  Create tickets on board (with dependencies + labels)
      |
/clancy:plan           Planner refines tickets (optional)
      |
/clancy:once           Implementer picks up tickets
```

Tickets created by `/clancy:approve-brief` are immediately available to the planner or implementer depending on the board status they land in. AFK-labelled tickets are picked up by `/clancy:run`; HITL-labelled tickets are skipped in AFK mode and require interactive `/clancy:once`.

## Stale brief detection

Briefs that remain unapproved for more than 7 days are flagged as stale. The stale brief hook checks on SessionStart and warns the user, prompting them to either approve or discard the brief.
