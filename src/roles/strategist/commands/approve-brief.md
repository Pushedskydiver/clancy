# /clancy:approve-brief

Convert an approved brief into real tickets on the board. Creates child tickets under the parent, links dependencies, and posts a tracking summary.

Accepts optional arguments:
- **By slug:** `/clancy:approve-brief auth-rework` — approve a specific brief
- **By index:** `/clancy:approve-brief 2` — approve the 2nd unapproved brief
- **By ticket:** `/clancy:approve-brief PROJ-123` — approve brief sourced from this ticket
- **Set parent:** `--epic PROJ-50` — override or set the parent epic
- **Preview:** `--dry-run` — show what would be created without making API calls
- **Skip confirmation:** `--afk` — auto-confirm without prompting (for automation)

Examples:
- `/clancy:approve-brief` — auto-select (if only 1 unapproved brief)
- `/clancy:approve-brief auth-rework` — approve by slug
- `/clancy:approve-brief --dry-run` — preview ticket creation
- `/clancy:approve-brief --epic PROJ-50` — set parent and approve

@.claude/clancy/workflows/approve-brief.md

Follow the approve-brief workflow above. Parse the decomposition, create tickets on the board, link dependencies, and post a tracking comment.
