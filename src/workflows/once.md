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

**Without `--dry-run`:**

Display:
```
🚨 Clancy — Once
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"I'm on the case." — Running for one ticket.
```

Execute:
```bash
node .clancy/clancy-once.js
```

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
