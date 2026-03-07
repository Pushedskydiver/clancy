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

3. Detect which `clancy-once.sh` variant to run:
   - If `JIRA_BASE_URL` is set → `.clancy/clancy-once.sh`
   - If `GITHUB_TOKEN` is set → `.clancy/clancy-once-github.sh` (if present) or `.clancy/clancy-once.sh`
   - If `LINEAR_API_KEY` is set → `.clancy/clancy-once-linear.sh` (if present) or `.clancy/clancy-once.sh`

4. Check the detected script exists. If not:
   ```
   .clancy/clancy-once.sh not found. Run /clancy:init to scaffold scripts.
   ```
   Stop.

---

## Step 2 — Run

Display:
```
Running Clancy for one ticket.
```

Execute:
```bash
bash .clancy/clancy-once.sh
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
