# Clancy Uninstall Workflow

## Overview

Remove Clancy's slash commands from the local project, globally, or both. Optionally remove the `.clancy/` project folder (which includes `.clancy/.env`). Never touch `CLAUDE.md` under any circumstances.

---

## Step 1 — Detect install locations

Check both locations silently. Each install has two parts — commands and workflows:

- **Project-local commands:** `.claude/commands/clancy/`
- **Project-local workflows:** `.claude/clancy/`
- **Global commands:** `~/.claude/commands/clancy/`
- **Global workflows:** `~/.claude/clancy/`

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
Your .clancy/ folder will not be touched.
Continue? (yes / no)
```

- `no` → print "Nothing removed." and stop
- `yes` → delete both the commands directory and the workflows directory for the chosen location(s), print "✓ Clancy removed from [location]."

If "Both" was chosen in Step 1: confirm once for both, remove all four directories, print two confirmation lines.

---

## Step 3 — Offer to remove .clancy/ (if present)

Check whether `.clancy/` exists in the current project directory.

If it does, ask separately:

```
.clancy/ contains your codebase docs, progress log, and credentials (.env).
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

- **Never touch any `.env` at the project root** — Clancy's credentials live in `.clancy/.env` and are only removed as part of `.clancy/` in Step 3
- **Never touch `CLAUDE.md`** — under any circumstances, in any scenario
- Steps 1–2 (commands removal) and Step 3 (`.clancy/` removal) are always asked separately — never bundle them into one confirmation
- If the user says no to commands removal in Step 2, skip Step 3 entirely and stop
