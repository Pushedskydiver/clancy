# Clancy Uninstall Workflow

## Overview

Remove Clancy's slash commands from the local project, globally, or both. Optionally remove the `.clancy/` project folder (which includes `.clancy/.env`). Clean up CLAUDE.md and .gitignore changes made during init.

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

## Step 3 — Clean up CLAUDE.md

Check whether `CLAUDE.md` exists in the current project directory.

If it does, check for Clancy markers (`<!-- clancy:start -->` and `<!-- clancy:end -->`):

**If markers found:**

Read the full file content. Determine whether Clancy created the file or appended to an existing one:

- **Clancy created it** (the file contains only whitespace outside the markers — no meaningful content before `<!-- clancy:start -->` or after `<!-- clancy:end -->`): delete the entire file.
- **Clancy appended to an existing file** (there is meaningful content outside the markers): remove everything from `<!-- clancy:start -->` through `<!-- clancy:end -->` (inclusive), plus any blank lines immediately before the start marker that were added as spacing. Write the cleaned file back.

Print `✓ CLAUDE.md cleaned up.` (or `✓ CLAUDE.md removed.` if deleted).

**If no markers found:** skip — Clancy didn't modify this file.

**If CLAUDE.md does not exist:** skip.

---

## Step 4 — Clean up .gitignore

Check whether `.gitignore` exists in the current project directory.

If it does, check whether it contains the Clancy entries (`# Clancy credentials` and/or `.clancy/.env`):

**If found:** remove the `# Clancy credentials` comment line and the `.clancy/.env` line. Also remove any blank line immediately before or after the removed block to avoid leaving double blank lines. Write the cleaned file back.

If the file is now empty (or contains only whitespace) after removal, delete it entirely — Clancy created it during init.

Print `✓ .gitignore cleaned up.` (or `✓ .gitignore removed.` if deleted).

**If not found:** skip — Clancy didn't modify this file.

**If .gitignore does not exist:** skip.

---

## Step 5 — Offer to remove .clancy/ (if present)

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

## Step 6 — Final message

```
Clancy uninstalled. To reinstall: npx chief-clancy
```

---

## Hard constraints

- **Never touch any `.env` at the project root** — Clancy's credentials live in `.clancy/.env` and are only removed as part of `.clancy/` in Step 5
- Steps 1–2 (commands removal), Steps 3–4 (CLAUDE.md and .gitignore cleanup), and Step 5 (`.clancy/` removal) are always asked separately — never bundle them into one confirmation
- If the user says no to commands removal in Step 2, skip all remaining steps and stop
