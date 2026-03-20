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

The CHANGELOG uses `## [X.Y.Z]` headings. Extract all content from the `## [{latest}]` heading down to (but not including) the `## [{installed}]` heading.

If the changelog fetch fails (network error, non-200), skip the "What's New" section and show: `Could not fetch changelog. View changes at github.com/Pushedskydiver/clancy/blob/main/CHANGELOG.md`

Display:

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
- `CLAUDE.md`

It may **append** to:
- `.clancy/.env` — adds missing env var defaults (see Step 4a)

---

## Step 4a — Backfill missing env var defaults

After the installer finishes, read `.clancy/.env` and check for missing pipeline label variables. These were introduced in v0.7.4 and won't exist in `.env` files from earlier installs.

**Check for and append if missing:**

```
# Pipeline labels (added in v0.7.4)
CLANCY_LABEL_BRIEF=clancy:brief
CLANCY_LABEL_PLAN=clancy:plan
CLANCY_LABEL_BUILD=clancy:build
```

For each variable:
1. Read `.clancy/.env` content
2. If the variable name does NOT appear anywhere in the file (not even commented out), append it with its default value
3. If the variable already exists (even with a different value), leave it untouched

Add a blank line and a `# Pipeline labels (added in v0.7.4)` comment header before the new variables, but only if at least one variable was added.

**Display what was added (if any):**
```
📋 Added missing env var defaults to .clancy/.env:
   CLANCY_LABEL_BRIEF=clancy:brief
   CLANCY_LABEL_PLAN=clancy:plan
   CLANCY_LABEL_BUILD=clancy:build

   Customise these via /clancy:settings → L1/L2/L3
```

If nothing was added, display nothing.

---

## Step 5 — Check for local patches

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

## Step 6 — Clear update cache and confirm

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

"New badge, same Chief." — Start a new Claude Code session to pick up the updated commands.

View full changelog: github.com/Pushedskydiver/clancy/blob/main/CHANGELOG.md
```

### New role hints

After the completion message, check `.clancy/.env` for `CLANCY_ROLES` and display hints for any optional roles that are available but not enabled:

- If `CLANCY_ROLES` does not include `planner`:
  ```
  💡 Planner role available — refine vague tickets into structured plans.
     Run /clancy:settings to enable it.
  ```
- If `CLANCY_ROLES` does not include `strategist`:
  ```
  💡 Strategist role available — generate briefs, grill requirements, create tickets.
     Run /clancy:settings to enable it.
  ```
- If `CLANCY_ROLES` is not set at all (env var missing), show both hints.
- If all optional roles are already enabled, show nothing.

---

## Notes

- If the user installed globally, the update applies globally
- If the user installed locally, the update applies locally
- After updating, restart Claude Code for new commands to take effect
- New role hints are shown post-update so existing users discover features added in newer versions
