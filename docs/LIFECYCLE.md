# Ticket Lifecycle — End-to-End Flow

The complete journey of a feature from idea to merged code. Human steps are marked with 👤.

---

## Strategy Phase

```
👤 Create a vague ticket on your board
   (e.g. "Add customer portal" on Jira/GitHub/Linear)

👤 Run /clancy:brief PROJ-200
   │
   ├─ Clancy researches the codebase (1-4 agents)
   ├─ Grill phase:
   │    Interactive → 👤 Clancy grills you, you answer
   │    AFK (--afk) → Clancy grills itself (AI-grill)
   ├─ Generates brief with:
   │    Discovery, User Stories, Vertical Slices,
   │    Ticket Decomposition, HITL/AFK tags
   └─ Saves to .clancy/briefs/ + posts on board

👤 Review the brief
   │
   ├─ Happy? → continue
   ├─ Want changes? → 👤 Comment on ticket or add
   │    ## Feedback to the brief file, then:
   │    👤 Run /clancy:brief PROJ-200 (auto-revises)
   │    👤 Review again (loop until satisfied)
   └─ Start over? → 👤 /clancy:brief --fresh PROJ-200

👤 Run /clancy:approve-brief PROJ-200
   │
   ├─ Clancy shows ticket list + deps + HITL/AFK breakdown
   ├─ 👤 Confirm [Y/n]
   ├─ Creates child tickets on board (with Epic: convention)
   ├─ Links dependencies (blocking relationships)
   └─ Posts summary on parent ticket

   Board now has: PROJ-201, PROJ-202, PROJ-203, etc.
   Each tagged AFK or HITL, with dependencies linked.
```

---

## Planning Phase (optional)

Skip if tickets are clear enough from the brief.

```
👤 Run /clancy:plan (picks next unplanned ticket)
   │
   ├─ Clancy reads the ticket + codebase
   ├─ Generates implementation plan
   └─ Posts plan as comment on ticket

👤 Review the plan
   │
   ├─ Happy? → 👤 /clancy:approve-plan
   ├─ Want changes? → 👤 Comment on ticket, then
   │    👤 /clancy:plan (auto-revises)
   └─ Start over? → 👤 /clancy:plan --fresh

   Repeat for each ticket that needs a plan.
```

---

## Implementation Phase

### Interactive (one ticket at a time)

```
👤 Run /clancy:once
   │
   ├─ Lock check + resume detection
   ├─ Preflight + board detection
   ├─ Epic completion check (auto)
   ├─ Rework detection (auto)
   ├─ Fetches next unblocked ticket
   │    (skips blocked tickets, skips HITL in AFK mode)
   ├─ Dry-run gate, feasibility check
   ├─ Creates feature branch from epic branch
   ├─ Transitions ticket → In Progress
   ├─ Claude implements the ticket
   │    (verification gate runs lint/test/typecheck)
   │    (self-healing retry if checks fail)
   ├─ Creates PR targeting epic branch
   ├─ Logs cost
   └─ Sends notification (if configured)

👤 Review the PR
   │
   ├─ Approve → 👤 Merge the PR (into epic branch)
   ├─ Request changes → 👤 Leave PR comments
   │    (inline comments auto-trigger rework,
   │     conversation comments need "Rework:" prefix)
   │    Next /clancy:once auto-detects the rework
   └─ Close → ticket stays, Clancy moves on

👤 Repeat /clancy:once for each ticket
```

### AFK Mode (autonomous batch)

```
👤 Run /clancy:run
   │
   ├─ Loops /clancy:once up to MAX_ITERATIONS times
   ├─ Skips HITL tickets (picks AFK-only)
   ├─ Auto-resumes from crashes (lock file)
   ├─ Generates session report when done
   └─ Sends webhook notification (if configured)

👤 Come back later, review session report
   (.clancy/session-report.md)
👤 Review + merge PRs that were created
```

---

## HITL Tickets (human-in-the-loop)

Tickets tagged HITL are skipped by `/clancy:run`.

```
👤 Run /clancy:once interactively for HITL tickets
   (Clancy may ask questions during implementation)
👤 Provide credentials, design decisions, etc. as needed
👤 Review + merge the PR
```

---

## Epic Completion (automatic)

After all child PRs are merged into the epic branch:

```
Next /clancy:once or /clancy:run iteration:
   ├─ Epic completion phase detects all children complete
   ├─ Auto-creates PR from epic/{key} → base branch
   └─ Logs EPIC_PR_CREATED

👤 Review the epic PR (full feature landing on base branch)
👤 Merge the epic PR
```

---

## Human Touchpoints Summary

| Step | Human action | Required? |
|---|---|---|
| Create ticket | Write the vague idea on the board | Yes |
| `/clancy:brief` | Run the command | Yes |
| Grill answers | Answer Clancy's questions | Interactive only |
| Review brief | Read, give feedback or approve | Yes |
| `/clancy:approve-brief` | Confirm ticket creation | Yes |
| `/clancy:plan` | Run if ticket needs a plan | Optional |
| Review plan | Read, give feedback or approve | If planning |
| `/clancy:once` or `/clancy:run` | Start implementation | Yes |
| Review PRs | Approve or request changes | Yes |
| Merge PRs | Click merge | Yes |
| HITL tickets | Interactive implementation | Only for HITL |
| Epic PR review | Final feature review | Yes |

**Minimum touchpoints for a full epic:** create ticket → brief → approve-brief → run → review/merge PRs → merge epic PR. That's **6 interactions** for an entire feature.
