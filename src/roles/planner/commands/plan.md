# /clancy:plan

Fetch backlog tickets from the board, explore the codebase, and generate structured implementation plans. Plans are posted as comments on the ticket for human review.

Accepts optional arguments:
- **Batch mode:** `/clancy:plan 3` — plan up to 3 tickets from the queue
- **Specific ticket:** `/clancy:plan PROJ-123`, `/clancy:plan #42`, `/clancy:plan ENG-42` — plan a single ticket by key
- **Fresh start:** `--fresh` — discard any existing plan and start over
- **Skip confirmations:** `--afk` — auto-confirm all prompts (for automation)

Examples:
- `/clancy:plan` — plan 1 ticket from queue
- `/clancy:plan 3` — plan 3 tickets from queue
- `/clancy:plan PROJ-123` — plan a specific Jira/Linear ticket
- `/clancy:plan #42` — plan a specific GitHub issue
- `/clancy:plan --fresh PROJ-123` — discard existing plan and start over

@.claude/clancy/workflows/plan.md

Follow the plan workflow above. For each ticket: run the feasibility scan, explore the codebase, generate the plan, and post it as a comment. Do not implement anything — planning only.
