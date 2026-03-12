## Update check

Before doing anything else, check for updates:

1. Run: `npm show chief-clancy version`
2. Read the installed version from the Clancy `package.json`
3. If a newer version exists, print: `ℹ️ Clancy v{current} → v{latest} available. Run /clancy:update to upgrade.` then continue normally.
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
- If no argument: read `MAX_ITERATIONS` from `.clancy/.env`. If not set there, default to 5.

If the resolved value of `MAX_ITERATIONS` is **10 or greater**, show a warning before continuing:

```
🚨 Clancy — Run
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ You're about to run Clancy for up to {N} tickets.

At rough estimates per ticket (Sonnet):
  Simple tickets  ~$0.25–$0.75 each  →  up to ~${low} total
  Complex tickets ~$2.00–$5.00 each  →  up to ~${high} total

"Slow down there, cowboy..." — Mistakes compound. If Claude misreads a ticket, it will do so {N} times.
Consider /clancy:once or a smaller run to validate first.

Continue with {N} tickets? [Y/n]
```

Where `{low}` = N × 0.75 (rounded to nearest dollar) and `{high}` = N × 5 (rounded to nearest dollar).
If the user types `n` or `N`: print `Cancelled.` and stop. Any other input (including enter) continues.

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

4. Check `.clancy/clancy-afk.js` exists. If not:
   ```
   .clancy/clancy-afk.js not found. Run /clancy:init to scaffold scripts.
   ```
   Stop.

---

## Step 3 — Start

Display (only if the high-iteration warning was not already shown):
```
🚨 Clancy — Run
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"All right, let's do this." — Processing up to {N} ticket(s). Ctrl+C to stop early.
```

---

## Step 4 — Run

Execute:
```bash
MAX_ITERATIONS={N} node .clancy/clancy-afk.js
```

Stream output directly — do not buffer or summarise.

---

## Step 5 — Finish

When the script exits, echo the final summary line from the output.

If `clancy-afk.js` exits with a non-zero status:
```
❌ Clancy stopped with an error. Check the output above.

"Looks like we've got ourselves a 23-19." — Run /clancy:once for more detail on the next ticket.
```

---

## Notes

- The `N` argument is session-only. It never modifies `.clancy/.env`.
- If the user wants to permanently change their default, they edit `.clancy/.env` directly or re-run `/clancy:init` advanced setup.
- Do not attempt to run scripts from `src/templates/` — only run scripts in `.clancy/`.
- The runtime scripts in `.clancy/` are self-contained bundles — no npm package dependency needed at runtime.
