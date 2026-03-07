# /clancy:run

Run Clancy in loop mode — processes tickets from your Kanban board until the queue is empty or MAX_ITERATIONS is reached.

Usage:
  /clancy:run       — uses MAX_ITERATIONS from .clancy/.env (default 20)
  /clancy:run 5     — overrides MAX_ITERATIONS to 5 for this session only

@.claude/clancy/workflows/run.md

Run the loop as documented in the workflow above. The numeric argument (if provided) is session-only and never written to .clancy/.env.
