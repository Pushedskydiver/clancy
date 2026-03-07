# /clancy:run

Run Clancy in loop mode — processes tickets from your Kanban board until the queue is empty or MAX_ITERATIONS is reached.

Usage:
  /clancy:run       — uses MAX_ITERATIONS from .clancy/.env (default 5)
  /clancy:run 20    — overrides MAX_ITERATIONS to 20 for this session only

@.claude/clancy/workflows/run.md

Run the loop as documented in the workflow above. The numeric argument (if provided) is session-only and never written to .clancy/.env.
