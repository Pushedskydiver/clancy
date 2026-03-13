# /clancy:plan

Fetch backlog tickets from the board, explore the codebase, and generate structured implementation plans. Plans are posted as comments on the ticket for human review.

Accepts an optional numeric argument for batch mode (`/clancy:plan 3`) and `--force` to re-plan tickets that already have a plan.

@.claude/clancy/workflows/plan.md

Follow the plan workflow above. For each ticket: run the feasibility scan, explore the codebase, generate the plan, and post it as a comment. Do not implement anything — planning only.
