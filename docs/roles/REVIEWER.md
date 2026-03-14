# Reviewer Role

The reviewer scores ticket readiness and tracks what Clancy has done.

## Commands

| Command | What it does |
| --- | --- |
| `/clancy:review` | Score the next ticket's readiness (description quality, acceptance criteria, size) |
| `/clancy:status` | Show the current state of your board queue |
| `/clancy:logs` | Display the progress log — what was implemented, when, and the outcome |

## Review scoring

`/clancy:review` evaluates the next ticket in the implementation queue and scores it on:

- **Description quality** — is the ticket clear enough to implement?
- **Acceptance criteria** — are there testable criteria?
- **Size** — is the ticket appropriately scoped for a single implementation run?

This helps you catch tickets that need refinement before Clancy attempts to implement them.

## Status

`/clancy:status` gives a snapshot of your board queue — how many tickets are ready, in progress, or done.

## Logs

`/clancy:logs` reads `.clancy/progress.txt` and displays a formatted view of all Clancy activity:

```
YYYY-MM-DD HH:MM | PROJ-123 | Implement login form | DONE
YYYY-MM-DD HH:MM | PROJ-124 | Fix validation bug | DONE
YYYY-MM-DD HH:MM | PROJ-125 | PLAN | S/M/L
YYYY-MM-DD HH:MM | PROJ-125 | APPROVE | —
```

Each entry includes the timestamp, ticket key, action summary, and status.
