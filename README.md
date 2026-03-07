# Clancy

![Clancy terminal preview](assets/terminal-preview.svg)

Autonomous, board-driven development for Claude Code.

Named after Chief Clancy Wiggum (Ralph's dad, The Simpsons) — because Clancy equips and deploys Ralph before sending him to work. Built on the [Ralph technique](https://ghuntley.com/ralph/) coined by Geoffrey Huntley. Clancy extends that foundation with Kanban board integration, structured codebase docs, and a git workflow built for team development.

> **Work in progress** — Clancy is not yet published to npm. This repo is public for feedback and early eyes only. Watch for a release.

---

## What it does

Clancy does three things:

1. **Scaffolds itself** into a project — scripts, docs, CLAUDE.md, .clancy/.env
2. **Scans your codebase** with 5 parallel specialist agents and writes 10 structured docs that Claude reads before every run
3. **Runs autonomously** — picking one ticket per loop from your Kanban board, implementing it, committing, squash-merging, and logging progress

One ticket per run. Fresh context window every iteration. No context rot.

---

## Supported boards

- **Jira** — via REST API v3, JQL, ADF description parsing
- **GitHub Issues** — via REST API with PR filtering
- **Linear** — via GraphQL, `viewer.assignedIssues`, `state.type: unstarted`

Community can add boards — see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Install

```bash
npx chief-clancy
```

You'll be asked: global install (`~/.claude`) or local (`./.claude`). Either works. Global makes commands available in all projects.

**Prerequisites:**

- [Claude Code](https://claude.ai/code) CLI installed
- `jq` installed (`brew install jq` or `apt install jq`)
- `curl` installed (comes with macOS/most Linux)

> **Heads up:** Clancy runs Claude with `--dangerously-skip-permissions` so it can work unattended without prompting for approval on every file change, git command, and shell script. Only run Clancy on codebases you own and trust. Review the scripts in `.clancy/` before your first run if you want to see exactly what it does.

---

## Getting started

```bash
# 1. Install Clancy commands
npx chief-clancy

# 2. Open a project in Claude Code, then:
/clancy:init

# 3. Scan your codebase (or say yes during init)
/clancy:map-codebase

# 4. Watch your first ticket
/clancy:once

# 5. Go AFK
/clancy:run
```

---

## Commands

| Command                | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `/clancy:init`         | Wizard — choose board, collect config, scaffold everything               |
| `/clancy:run`          | Loop mode — processes tickets until queue is empty or MAX_ITERATIONS hit |
| `/clancy:run 5`        | Same, override MAX_ITERATIONS to 5 for this session                      |
| `/clancy:once`         | Pick up one ticket and stop                                              |
| `/clancy:status`       | Show next tickets without running — read-only                            |
| `/clancy:review`       | Score next ticket (0–100%) with actionable recommendations               |
| `/clancy:logs`         | Format and display `.clancy/progress.txt`                                |
| `/clancy:map-codebase` | Full 5-agent parallel codebase scan, writes 10 docs                      |
| `/clancy:update-docs`  | Incremental refresh — re-runs agents for changed areas                   |
| `/clancy:settings`     | View and change configuration — model, iterations, board, and more      |
| `/clancy:update`       | Update Clancy to latest version                                          |
| `/clancy:help`         | Command reference                                                        |

---

## What gets created

```
.clancy/
  clancy-once.sh      — picks up one ticket, implements, commits, merges
  clancy-afk.sh       — loop runner (board-agnostic)
  docs/               — 10 structured docs read before every run
    STACK.md
    INTEGRATIONS.md
    ARCHITECTURE.md
    CONVENTIONS.md
    TESTING.md
    GIT.md
    DESIGN-SYSTEM.md
    ACCESSIBILITY.md
    DEFINITION-OF-DONE.md
    CONCERNS.md
  progress.txt        — append-only log of completed tickets
  .env                — your board credentials (gitignored)
  .env.example        — credential template for your board
```

Clancy also merges a section into your `CLAUDE.md` (or creates one) that tells Claude to read all these docs before every run.

---

## Optional enhancements

Set during `/clancy:init` advanced setup, or by editing `.clancy/.env` directly.

### Figma MCP

```
FIGMA_API_KEY=your-key
```

When a ticket description contains a Figma URL, Clancy fetches design specs automatically:

1. Figma MCP: `get_metadata` → `get_design_context` → `get_screenshot` (3 calls)
2. Figma REST API image export (fallback)
3. Ticket image attachment (fallback)

### Playwright visual checks

```
PLAYWRIGHT_ENABLED=true
PLAYWRIGHT_DEV_COMMAND=yarn dev
PLAYWRIGHT_DEV_PORT=5173
PLAYWRIGHT_STORYBOOK_COMMAND=yarn storybook  # if applicable
PLAYWRIGHT_STORYBOOK_PORT=6006               # if applicable
PLAYWRIGHT_STARTUP_WAIT=15
```

After implementing a UI ticket, Clancy starts the dev server or Storybook, screenshots, assesses visually, checks the console, and fixes anything wrong before committing.

### Notifications

```
CLANCY_NOTIFY_WEBHOOK=https://hooks.slack.com/services/your/webhook/url
```

Posts to Slack or Teams when a ticket completes or Clancy hits an error. URL is auto-detected.

---

## How the loop works

```
clancy-afk.sh
  └─ while i < MAX_ITERATIONS:
       bash clancy-once.sh
         1. Preflight checks (credentials, git state, board reachability)
         2. Fetch next ticket from board (maxResults=1)
         3. git checkout $EPIC_BRANCH
         4. git checkout -b feature/{ticket-key}
         5. Read .clancy/docs/* (especially GIT.md)
         6. echo "$PROMPT" | claude --dangerously-skip-permissions
         7. git checkout $EPIC_BRANCH
         8. git merge --squash feature/{ticket-key}
         9. git commit -m "feat(TICKET): summary"
        10. git branch -d feature/{ticket-key}
        11. Append to .clancy/progress.txt
       if "No tickets found": break
```

Clancy reads `GIT.md` before every run and follows whatever conventions are documented there. The defaults above apply on greenfield projects or when GIT.md is silent.

---

## Lineage

![Chief Clancy Wiggum inspiration. Generated by Google Gemini](assets/inspired-chief-clancy.webp)

Clancy is built on the **Ralph technique** coined by **Geoffrey Huntley** ([ghuntley.com/ralph/](https://ghuntley.com/ralph/)).

Ralph in its purest form:

```bash
while :; do cat PROMPT.md | claude-code; done
```

Clancy is what happens when you take that idea seriously for team development. See [CREDITS.md](./CREDITS.md) for the full story.

---

## Security

### Permissions model

Clancy runs Claude with `--dangerously-skip-permissions`, which suppresses all permission prompts so it can work unattended. This means Claude has full read/write access to your file system and can execute shell commands without asking.

**Only run Clancy on codebases you own and trust.** Review the scripts in `.clancy/` before your first run if you want to see exactly what executes.

### Protect your credentials from Claude

Your board tokens and API keys live in `.clancy/.env`. Although Claude doesn't need to read this file during a run (the shell script sources it before invoking Claude), adding it to Claude Code's deny list is good defence-in-depth. Add it to `.claude/settings.json` in your project, or `~/.claude/settings.json` globally:

```json
{
  "permissions": {
    "deny": [
      "Read(.clancy/.env)",
      "Read(.env)",
      "Read(.env.*)",
      "Read(**/*.pem)",
      "Read(**/*.key)"
    ]
  }
}
```

This prevents Claude from reading these files regardless of what commands run. Clancy automatically adds `.clancy/.env` to `.gitignore` during init, but the deny list is an additional layer.

### Token scopes

Use the minimum permissions each integration requires:

| Integration | Recommended scope |
|---|---|
| GitHub PAT | `repo` — read/write issues and contents for your repo only |
| Jira API token | Standard user — no admin rights needed |
| Linear API key | Personal API key — read/write to your assigned issues |
| Figma API key | Read-only access is sufficient |

### Webhook URLs

If you configure Slack or Teams notifications, treat the webhook URL as a secret — anyone who has it can post to your channel. Keep `.clancy/.env` gitignored (Clancy does this automatically during init) and never share the URL.

---

## Troubleshooting

**Start here:** run `/clancy:doctor` — it tests every integration and tells you exactly what's broken and how to fix it.

---

**Commands not found after install?**

Restart Claude Code to reload commands, then verify the files exist:

```bash
ls ~/.claude/commands/clancy/    # global install
ls .claude/commands/clancy/      # local install
```

If missing, re-run `npx chief-clancy`.

---

**Board connection fails?**

Run `/clancy:doctor` to test your credentials. If it reports a failure, open `.clancy/.env` and check your tokens — they're the most common cause. You can also run `/clancy:settings` → Switch board to re-enter credentials without re-running full init.

---

**No tickets showing up?**

Run `/clancy:status` to see what Clancy would pick up. If the queue is empty:

- Check that tickets are assigned to you on the board
- For Jira: verify the status filter in `/clancy:settings` matches your board's status name exactly (e.g. `To Do` vs `TODO`)
- For Linear: Clancy filters by `state.type: unstarted` — ensure your backlog state maps to this type

---

**Scripts not executable?**

```bash
chmod +x .clancy/*.sh
```

---

**`.clancy/clancy-once.sh` not found?**

Re-run `/clancy:init` — it will detect the existing setup and offer to re-scaffold without asking for credentials again.

---

**Playwright port already in use?**

```bash
lsof -ti:5173 | xargs kill -9   # replace 5173 with your PLAYWRIGHT_DEV_PORT
```

---

**Updating Clancy?**

```bash
/clancy:update
```

Or directly: `npx chief-clancy@latest`

---

**Uninstalling?**

```
/clancy:uninstall
```

Removes slash commands from your chosen location. Optionally removes `.clancy/` (credentials and docs). Never touches `CLAUDE.md`.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The most useful contribution is adding a new board — it's a shell script + a JSON entry.

## License

MIT — see [LICENSE](./LICENSE).
