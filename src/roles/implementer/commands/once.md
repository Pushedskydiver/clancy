# /clancy:once

Pick up exactly one ticket from your Kanban board, implement it, commit, push, create a PR, and stop.

Good for:
- Your first run — watch Clancy work before going AFK
- Testing after changing .clancy/docs/ or CLAUDE.md
- Debugging a specific ticket
- When you only have time for one ticket

Pass `--dry-run` to preview what Clancy would do without making any changes:
- Shows the ticket, epic, target branch, and feature branch
- Exits before any git operations or Claude invocation

@.claude/clancy/workflows/once.md

Run one ticket as documented in the workflow above.
