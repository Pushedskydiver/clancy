# /clancy:approve-plan

Promote an approved Clancy plan to the ticket description. Accepts an optional ticket key argument (e.g. `/clancy:approve-plan PROJ-123`). When no key is provided, auto-selects the oldest planned-but-unapproved ticket.

@.claude/clancy/workflows/approve-plan.md

Follow the approve-plan workflow above. Fetch the plan comment, confirm with the user, append it to the ticket description, and transition the ticket to the implementation queue.
