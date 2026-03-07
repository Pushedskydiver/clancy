# Clancy Uninstall Workflow

## Overview

Remove Clancy's slash commands from the local project, globally, or both. Optionally remove the `.clancy/` project folder. Never touch `.env` or `CLAUDE.md` under any circumstances.

---

## Step 1 — Detect install locations

Check both locations silently:

- **Project-local:** `.claude/commands/clancy/` (relative to current working directory)
- **Global:** `~/.claude/commands/clancy/`

| Scenario | Action |
|---|---|
| Found in both | Ask: "Remove from project, globally, or both?" → `[1] Project only` `[2] Global only` `[3] Both` |
| Found in project only | Proceed with project removal |
| Found globally only | Proceed with global removal |
| Found in neither | Print "Clancy commands not found. Nothing to remove." and stop |

---

## Step 2 — Confirm before removing commands

Show exactly this message, filling in the detected location:

```
This will remove Clancy's slash commands from [location].
Your .clancy/ folder and .env file will not be touched.
Continue? (yes / no)
```

- `no` → print "Nothing removed." and stop
- `yes` → delete the commands directory, print "✓ Clancy commands removed from [location]."

If "Both" was chosen in Step 1: confirm once for both, remove both, print two confirmation lines.

---

## Step 3 — Offer to remove .clancy/ (if present)

Check whether `.clancy/` exists in the current project directory.

If it does, ask separately:

```
.clancy/ contains your codebase docs and progress log.
Remove it too? This cannot be undone. (yes / no)
```

- `no` → print "✓ .clancy/ kept — your docs and progress log are safe."
- `yes` → delete `.clancy/` and print "✓ .clancy/ removed."

If `.clancy/` does not exist, skip this step entirely.

---

## Step 4 — Final message

```
Clancy uninstalled. To reinstall: npx chief-clancy
```

---

## Hard constraints

- **Never touch `.env`** — under any circumstances, in any scenario
- **Never touch `CLAUDE.md`** — under any circumstances, in any scenario
- Steps 1–2 (commands removal) and Step 3 (`.clancy/` removal) are always asked separately — never bundle them into one confirmation
- If the user says no to commands removal in Step 2, skip Step 3 entirely and stop
