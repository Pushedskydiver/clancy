# /clancy:update

Update Clancy itself to the latest version via npx and show what changed.

This re-runs the installer, which copies the latest command files from the npm package into your .claude/commands/clancy/ directory. Your .clancy/ project folder (scripts, docs, progress log) is never touched.

**Supported flags:**
- `--afk` — skip the confirmation prompt and auto-approve the update (for autonomous setups)

@.claude/clancy/workflows/update.md

Run the update as documented in the workflow above. If `--afk` is passed, skip all confirmation prompts.
