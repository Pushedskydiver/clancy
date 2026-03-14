# Troubleshooting

**Start here:** run `/clancy:doctor` — it tests every integration and tells you exactly what's broken and how to fix it.

---

## Commands not found after install?

Restart Claude Code to reload commands, then verify the files exist:

```bash
ls ~/.claude/commands/clancy/    # global install
ls .claude/commands/clancy/      # local install
```

If missing, re-run `npx chief-clancy`.

---

## Board connection fails?

Run `/clancy:doctor` to test your credentials. If it reports a failure, open `.clancy/.env` and check your tokens — they're the most common cause. You can also run `/clancy:settings` → Switch board to re-enter credentials without re-running full init.

---

## No tickets showing up?

Run `/clancy:status` to see what Clancy would pick up. If the queue is empty:

- Check that tickets are assigned to you on the board
- For Jira: verify the status filter in `/clancy:settings` matches your board's status name exactly (e.g. `To Do` vs `TODO`)
- For Linear: Clancy filters by `state.type: "unstarted"` — ensure your backlog state maps to this type

---

## `.clancy/clancy-once.js` not found?

Re-run `/clancy:init` — it will detect the existing setup and offer to re-scaffold without asking for credentials again.

---

## Playwright port already in use?

```bash
lsof -ti:5173 | xargs kill -9   # replace 5173 with your PLAYWRIGHT_DEV_PORT
```

---

## Updating Clancy?

```bash
/clancy:update
```

Or directly: `npx chief-clancy@latest`

The update workflow shows what's changed (changelog diff) and asks for confirmation before overwriting. If you've customised any command or workflow files, they're automatically backed up to `.claude/clancy/local-patches/` before the update — check there to reapply your changes afterwards.

---

## Uninstalling?

```
/clancy:uninstall
```

Removes slash commands from your chosen location. Cleans up the `<!-- clancy:start -->` / `<!-- clancy:end -->` block from `CLAUDE.md` (or deletes it entirely if Clancy created it) and removes the `.clancy/.env` entry from `.gitignore`. Optionally removes `.clancy/` (credentials and docs).
