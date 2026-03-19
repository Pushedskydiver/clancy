# /clancy:brief

Generate a strategic brief for a feature idea. Researches the codebase, grills you (or itself) on requirements, and produces a decomposition into actionable tickets.

Accepts optional arguments:
- **Board ticket:** `/clancy:brief PROJ-123`, `/clancy:brief #42`, `/clancy:brief ENG-42` — brief from a board ticket
- **Inline text:** `/clancy:brief "Add dark mode"` — brief from a description
- **From file:** `/clancy:brief --from docs/rfc.md` — brief from a local file
- **Batch mode:** `/clancy:brief 3` — brief up to 3 tickets from the queue
- **Fresh start:** `--fresh` — discard existing brief and start over
- **Force web research:** `--research` — include web research in analysis
- **AFK mode:** `--afk` — use AI-grill instead of human grill
- **Epic hint:** `--epic PROJ-50 "Add dark mode"` — set parent for approve step
- **List briefs:** `--list` — show inventory of existing briefs

Examples:
- `/clancy:brief` — interactive mode (prompt for idea)
- `/clancy:brief PROJ-200` — brief a Jira ticket
- `/clancy:brief #42` — brief a GitHub issue
- `/clancy:brief ENG-42` — brief a Linear issue
- `/clancy:brief "Add dark mode support"` — brief from inline text
- `/clancy:brief --afk PROJ-200` — brief with AI-grill (no human questions)
- `/clancy:brief --list` — show all briefs

@.claude/clancy/workflows/brief.md

Follow the brief workflow above. Research the codebase, conduct the grill phase, generate the brief, and save it locally. Do not create tickets — briefing only.
