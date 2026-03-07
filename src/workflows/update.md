# Clancy Update Workflow

## Overview

Update Clancy itself to the latest version via npx.

---

## Step 1 — Check current version

Read current version from the installed package (check `~/.claude/commands/clancy/` or `./.claude/commands/clancy/` for a `VERSION` file, or from npm).

```bash
npm view chief-clancy version 2>/dev/null || echo "unknown"
```

---

## Step 2 — Run the updater

```
Updating Clancy...
```

Run:
```bash
npx chief-clancy@latest
```

This re-runs the installer, which copies the latest command files into the correct `.claude/commands/clancy/` directory (global or local, matching the existing install location).

The update only touches `.claude/commands/clancy/`. It never modifies:
- `.clancy/` project folder
- `.clancy/docs/` codebase documentation
- `.clancy/progress.txt` progress log
- `.env` credentials
- `CLAUDE.md`

---

## Step 3 — Show changelog diff

After update, fetch and display the CHANGELOG section for any versions between old and new:

```
Updated Clancy from v{old} to v{new}.

What's new:
{relevant CHANGELOG entries}

View full changelog: github.com/Pushedskydiver/clancy/blob/main/CHANGELOG.md
```

If version is already latest:
```
Clancy is already up to date (v{version}).
```

---

## Notes

- If the user installed globally, the update applies globally
- If the user installed locally, the update applies locally
- After updating, the new commands take effect immediately in Claude Code
