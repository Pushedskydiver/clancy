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
- For GitHub: both classic PATs and fine-grained PATs are supported. Clancy auto-resolves your username via the API.
- For Jira: verify the status filter in `/clancy:settings` matches your board's status name exactly (e.g. `To Do` vs `TODO`)
- For Linear: Clancy filters by `state.type: "unstarted"` — ensure your backlog state maps to this type

---

## Push or PR creation failed?

If Clancy logs `PUSH_FAILED` or `PUSHED` (without a PR URL):

- **PUSH_FAILED** — the `git push` command failed. Common causes:
  - No remote configured (`git remote -v` is empty)
  - Authentication failed — check your git credentials or SSH key
  - Branch protection rules preventing direct push — ensure feature branches are allowed
  - The feature branch is left intact for you to push manually

- **PUSHED but no PR** — the branch was pushed successfully but PR creation failed:
  - Missing git host token — configure one via `/clancy:settings` → Git host token
  - Token lacks permissions — GitHub needs `repo` scope, GitLab needs `api` scope, Bitbucket needs `repository:write`
  - Self-hosted instance not detected — set `CLANCY_GIT_PLATFORM` and `CLANCY_GIT_API_URL` in `.clancy/.env`
  - The log includes a manual URL you can use to create the PR yourself

- **LOCAL** — no git remote detected. Add a remote: `git remote add origin <url>`

---

## Rework issues?

- **PR rework not detecting?** — Check that: (1) the PR was created by Clancy (it must follow Clancy's branch naming convention, e.g. `feature/proj-123` or `feature/issue-42`), (2) the reviewer left feedback in the right format — **inline code comments** on specific lines always trigger rework, while **general conversation comments** need a `Rework:` prefix to be detected (e.g. "Rework: this should validate inputs"), and (3) a git host token is configured in `.clancy/.env` (e.g. `GITHUB_TOKEN`, `GITLAB_TOKEN`, or `BITBUCKET_TOKEN`/`BITBUCKET_USER`). PR-based rework detection requires Clancy to be able to query the git host API.

- **Max rework cycles reached** — Clancy logged `SKIPPED` for a ticket that has hit the max rework limit. Increase `CLANCY_MAX_REWORK` in `.clancy/.env` (default: 3) or resolve the ticket manually. This limit prevents infinite rework loops.

- **No feedback found** — The reviewer may not have left actionable comments. For best results, reviewers should leave inline code comments on specific lines, or prefix general comments with `Rework:` so Clancy can detect and act on them.

- **Feature branch missing for PR rework** — If the feature branch was force-deleted from the remote, Clancy creates a fresh branch and treats it as a new implementation rather than a targeted fix.

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
