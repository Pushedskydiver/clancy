# /clancy:review

Fetch the next ticket from the board and score it — returns a confidence score (0–100%) and actionable recommendations before you run.

Does not implement anything. Read-only from Clancy's perspective, though it invokes Claude for analysis.

@.claude/clancy/workflows/review.md

Score the ticket as documented in the workflow above, including the full 7-criterion rubric and confidence bands.
