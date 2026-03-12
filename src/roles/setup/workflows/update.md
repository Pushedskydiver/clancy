# Clancy Update Workflow

## Overview

Check for Clancy updates via npm, display changelog for versions between installed and latest, obtain user confirmation, and execute clean installation.

---

## Step 1 — Detect installed version

Determine whether Clancy is installed locally or globally by checking both locations:

```bash
LOCAL_VERSION_FILE="./.claude/commands/clancy/VERSION"
GLOBAL_VERSION_FILE="$HOME/.claude/commands/clancy/VERSION"

if [ -f "$LOCAL_VERSION_FILE" ] && grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+' "$LOCAL_VERSION_FILE"; then
  INSTALLED=$(cat "$LOCAL_VERSION_FILE")
  INSTALL_TYPE="LOCAL"
elif [ -f "$GLOBAL_VERSION_FILE" ] && grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+' "$GLOBAL_VERSION_FILE"; then
  INSTALLED=$(cat "$GLOBAL_VERSION_FILE")
  INSTALL_TYPE="GLOBAL"
else
  INSTALLED="unknown"
  INSTALL_TYPE="UNKNOWN"
fi

echo "$INSTALLED"
echo "$INSTALL_TYPE"
```

Parse output:
- First line = installed version (or "unknown")
- Second line = install type (LOCAL, GLOBAL, or UNKNOWN)

**If version is unknown:**
```
## Clancy Update

**Installed version:** Unknown

Your installation doesn't include version tracking.

Running fresh install...
```

Proceed to Step 4 (treat as version 0.0.0 for comparison).

---

## Step 2 — Check latest version

Check npm for the latest published version:

```bash
npm view chief-clancy version 2>/dev/null
```

**If npm check fails:**
```
Couldn't check for updates (offline or npm unavailable).

To update manually: `npx chief-clancy@latest`
```

Exit.

---

## Step 3 — Compare versions and confirm

Compare installed vs latest:

**If installed == latest:**
```
🚨 Clancy — Update
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Installed:** X.Y.Z
**Latest:** X.Y.Z

✅ You're already on the latest version. "Nothing to see here, folks."
```

Exit.

**If update available**, fetch the changelog from GitHub and show what's new BEFORE updating:

```bash
curl -s https://raw.githubusercontent.com/Pushedskydiver/clancy/main/CHANGELOG.md
```

Extract only the entries between the installed version and the latest version. Display:

```
🚨 Clancy — Update
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Installed:** {installed}
**Latest:** {latest}

### What's New
────────────────────────────────────────────────────────────

{relevant CHANGELOG entries between installed and latest}

────────────────────────────────────────────────────────────

⚠️  **Note:** The update performs a clean install of Clancy command folders:
- `.claude/commands/clancy/` will be replaced
- `.claude/clancy/workflows/` will be replaced

If you've modified any Clancy files directly, they'll be automatically backed up
to `.claude/clancy/local-patches/` before overwriting.

Your project files are preserved:
- `.clancy/docs/`, `.clancy/.env`, `.clancy/progress.txt` ✅
- `CLAUDE.md` ✅
- Custom commands not in `commands/clancy/` ✅
- Custom hooks ✅

Note: `.clancy/clancy-once.js` and `.clancy/clancy-afk.js` **will be replaced** with
the latest bundled versions. The rest of `.clancy/` is untouched.
```

Ask the user: **"Proceed with update?"** with options:
- "Yes, update now"
- "No, cancel"

**If user cancels:** Exit.

---

## Step 4 — Run the update

Run the installer using the detected install type from Step 1. Pass `--global` or `--local` so the installer runs non-interactively (no prompts):

- If `INSTALL_TYPE` is `LOCAL`: `npx -y chief-clancy@latest --local`
- If `INSTALL_TYPE` is `GLOBAL`: `npx -y chief-clancy@latest --global`
- If `INSTALL_TYPE` is `UNKNOWN`: `npx -y chief-clancy@latest` (falls back to interactive mode)

```bash
# Example for local install:
npx -y chief-clancy@latest --local

# Example for global install:
npx -y chief-clancy@latest --global
```

The `--global`/`--local` flags skip the interactive install-type prompt and auto-accept the overwrite confirmation.

This touches:
- `.claude/commands/clancy/` — slash commands (replaced)
- `.claude/clancy/workflows/` — workflow files (replaced)
- `.clancy/clancy-once.js` and `.clancy/clancy-afk.js` — bundled runtime scripts (replaced)

It never modifies:
- `.clancy/docs/` — codebase documentation
- `.clancy/progress.txt` — progress log
- `.clancy/.env` — credentials
- `CLAUDE.md`

---

## Step 5 — Clear update cache and confirm

Clear the update check cache so the statusline indicator disappears:

```bash
rm -f "$HOME/.claude/cache/clancy-update-check.json"
rm -f "./.claude/cache/clancy-update-check.json"
```

Display completion message:

```
╔═══════════════════════════════════════════════════════════╗
║  ✅ Clancy Updated: v{old} → v{new}                     ║
╚═══════════════════════════════════════════════════════════╝

"New badge, same Chief." — Restart Claude Code to pick up the new commands.

View full changelog: github.com/Pushedskydiver/clancy/blob/main/CHANGELOG.md
```

---

## Step 6 — Check for local patches

After the update completes, check if the installer backed up any locally modified files:

Check for `.claude/clancy/local-patches/backup-meta.json` (local install) or `~/.claude/clancy/local-patches/backup-meta.json` (global install).

**If patches were found:**

```
Local patches were backed up before the update.
Your modified files are in .claude/clancy/local-patches/

To review what changed:
  Compare each file in local-patches/ against its counterpart in
  .claude/commands/clancy/ or .claude/clancy/workflows/ and manually
  reapply any customisations you want to keep.

Backed up files:
{list from backup-meta.json}
```

**If no patches:** Continue normally (no message needed).

---

## Notes

- If the user installed globally, the update applies globally
- If the user installed locally, the update applies locally
- After updating, restart Claude Code for new commands to take effect
