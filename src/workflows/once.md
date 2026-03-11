## Update check

Before doing anything else, check for updates:

1. Run: `npm show chief-clancy version`
2. Read the installed version from the Clancy `package.json`
3. If a newer version exists, print: `ℹ Clancy v{current} → v{latest} available. Run /clancy:update to upgrade.` then continue normally.
4. If already on latest, continue silently.
5. If the npm check fails for any reason (offline, network error), continue silently. Never block on this.

---

# Clancy Once Workflow

## Overview

Pick up exactly one ticket from the Kanban board, implement it, commit, squash-merge, and stop. Does not loop.

---

## Step 1 — Preflight checks

1. Check `.clancy/` exists. If not:
   ```
   .clancy/ not found. Run /clancy:init first to set up Clancy.
   ```
   Stop.

2. Check `.clancy/.env` exists and board credentials are present. If not:
   ```
   Missing credentials in .clancy/.env. Run /clancy:init to reconfigure.
   ```
   Stop.

3. The script to run is always `.clancy/clancy-once.sh` regardless of board.
   `/clancy:init` copies the correct board variant as `clancy-once.sh` during setup.

4. Check `.clancy/clancy-once.sh` exists. If not:
   ```
   .clancy/clancy-once.sh not found. Run /clancy:init to scaffold scripts.
   ```
   Stop.

---

## Step 2 — Run

Check if the user passed `--dry-run` as an argument to the slash command.

**Without `--dry-run`:**

Display:
```
Running Clancy for one ticket.
```

Execute:
```bash
bash .clancy/clancy-once.sh
```

**With `--dry-run`:**

Display:
```
Running Clancy in dry-run mode — no changes will be made.
```

Execute:
```bash
bash .clancy/clancy-once.sh --dry-run
```

Stream output directly — do not buffer or summarise.

---

## Step 3 — Result

On success, echo the result line from the script output:
```
✓ {TICKET-KEY} complete.
```

On failure:
```
Clancy stopped. See output above for details.
Run /clancy:status to check the board, or /clancy:review to inspect the ticket.
```

---

## Notes

- Do not loop. This command runs the script exactly once and stops.
- Do not attempt to run scripts from `src/templates/` — only scripts in `.clancy/`.
