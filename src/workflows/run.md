## Update check

Before doing anything else, check for updates:

1. Run: `npm show chief-clancy version`
2. Read the installed version from the Clancy `package.json`
3. If a newer version exists, print: `ℹ Clancy v{current} → v{latest} available. Run /clancy:update to upgrade.` then continue normally.
4. If already on latest, continue silently.
5. If the npm check fails for any reason (offline, network error), continue silently. Never block on this.

---

# Clancy Run Workflow

## Overview

Run Clancy in loop mode. Processes tickets from the Kanban board until the queue is empty or MAX_ITERATIONS is reached.

---

## Step 1 — Parse argument

The command may be invoked as `/clancy:run` or `/clancy:run N` where N is a positive integer.

- If N is provided: use it as `MAX_ITERATIONS` for this session only. Never write it to `.clancy/.env`.
- If no argument: read `MAX_ITERATIONS` from `.clancy/.env`. If not set there, default to 20.

---

## Step 2 — Preflight checks

1. Check `.clancy/` exists. If not:
   ```
   .clancy/ not found. Run /clancy:init first to set up Clancy.
   ```
   Stop.

2. Check `.clancy/.env` exists. If not:
   ```
   .clancy/.env not found. Run /clancy:init first.
   ```
   Stop.

3. Source `.clancy/.env` and check that board credentials are present.

   **Jira:** `JIRA_BASE_URL`, `JIRA_USER`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`
   **GitHub:** `GITHUB_TOKEN`, `GITHUB_REPO`
   **Linear:** `LINEAR_API_KEY`, `LINEAR_TEAM_ID`

   If any required var is missing:
   ```
   Missing credentials in .clancy/.env: <var name>
   Run /clancy:init to reconfigure, or edit .clancy/.env directly.
   ```
   Stop.

4. Check `.clancy/clancy-afk.sh` exists. If not:
   ```
   .clancy/clancy-afk.sh not found. Run /clancy:init to scaffold scripts.
   ```
   Stop.

---

## Step 3 — Start

Display:
```
Starting Clancy — will process up to {N} ticket(s). Ctrl+C to stop early.
```

---

## Step 4 — Run

Execute:
```bash
MAX_ITERATIONS={N} bash .clancy/clancy-afk.sh
```

Stream output directly — do not buffer or summarise.

---

## Step 5 — Finish

When the script exits, echo the final summary line from the output.

If `clancy-afk.sh` exits with a non-zero status:
```
Clancy stopped with an error. Check the output above.
Run /clancy:once for more detail on the next ticket.
```

---

## Notes

- The `N` argument is session-only. It never modifies `.clancy/.env`.
- If the user wants to permanently change their default, they edit `.clancy/.env` directly or re-run `/clancy:init` advanced setup.
- Do not attempt to run scripts from `src/templates/` — only run scripts in `.clancy/`.
