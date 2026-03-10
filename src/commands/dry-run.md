# /clancy:dry-run

Preview which ticket Clancy would pick up next — no changes made.

Shows:
- The ticket that would be picked up (key, summary, epic)
- The target branch and feature branch that would be created
- Full preflight checks — catches config issues early

Nothing is written, no git operations run, Claude is not invoked.

@.claude/clancy/workflows/once.md

Run the once workflow with `--dry-run` as documented above. Treat this invocation as if the user passed `--dry-run`.
