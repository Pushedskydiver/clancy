## Update check

Before doing anything else, check for updates:

1. Run: `npm show chief-clancy version`
2. Read the installed version from the Clancy `package.json`
3. If a newer version exists, print: `ℹ️ Clancy v{current} → v{latest} available. Run /clancy:update to upgrade.` then continue normally.
4. If already on latest, continue silently.
5. If the npm check fails for any reason (offline, network error), continue silently. Never block on this.

---

# Clancy Once Workflow

## Overview

Pick up exactly one ticket from the Kanban board, implement it, commit, push, create a PR, and stop. Does not loop.

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

3. The script to run is always `.clancy/clancy-once.js` regardless of board.
   `/clancy:init` copies the correct board variant as `clancy-once.js` during setup.

4. Check `.clancy/clancy-once.js` exists. If not:
   ```
   .clancy/clancy-once.js not found. Run /clancy:init to scaffold scripts.
   ```
   Stop.

---

## Step 2 — Run

Check if the user passed `--dry-run` as an argument to the slash command.

**With `--dry-run`:**

Display:
```
🚨 Clancy — Dry Run
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Just a routine patrol." — Running in dry-run mode, no changes will be made.
```

Execute:
```bash
node .clancy/clancy-once.js --dry-run
```

Stream output directly — do not buffer or summarise. Stop here (do not continue to Step 3).

**Without `--dry-run`:**

Display:
```
🚨 Clancy — Once
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"I'm on the case." — Running for one ticket.
```

### 2a. Fetch ticket details

Execute a dry-run first to retrieve ticket details:
```bash
node .clancy/clancy-once.js --dry-run
```

Stream output directly. If the output contains `No tickets found` or a preflight error (`✗`), stop — there is nothing to do.

### 2b. Feasibility evaluation

Read the ticket title and description from the dry-run output. Evaluate whether this ticket can be implemented entirely as code changes committed to a git repository.

The ticket is **infeasible** if it requires ANY of:
- Manual testing or configuration in external tools or admin panels
- Access to external services, APIs, or platforms not available in the codebase
- Physical, hardware, or infrastructure changes
- Design assets that do not yet exist
- Deployment or infrastructure changes outside the repository
- Human judgment calls that require stakeholder input

If the ticket is infeasible, display:
```
⏭️ {TICKET-KEY} skipped — {one-line reason}.

"Not on my watch." — The ticket requires work that Clancy can't do as code changes. A human should handle this one.
```
Stop here.

### 2c. Execute

If the ticket is feasible, run the full lifecycle (skipping the script's built-in feasibility check since we just evaluated it):
```bash
node .clancy/clancy-once.js --skip-feasibility
```

Stream output directly — do not buffer or summarise.

---

## Step 3 — Result

On success (output contains `complete`), echo:
```
✅ {TICKET-KEY} complete.

"That's some fine police work there, Lou."
```

On skip (output contains `Ticket skipped`), echo:
```
⏭️ {TICKET-KEY} skipped — {reason from output}.

"Not on my watch." — The ticket requires work that Clancy can't do as code changes. A human should handle this one.
```

On failure:
```
❌ Clancy stopped. See output above for details.

"Looks like we've got ourselves a 23-19." — Run /clancy:status to check the board, or /clancy:review to inspect the ticket.
```

---

## Notes

- Do not loop. This command runs the script exactly once and stops.
- Do not attempt to run scripts from `src/templates/` — only scripts in `.clancy/`.
- The runtime scripts in `.clancy/` are self-contained bundles — no npm package dependency needed at runtime.
