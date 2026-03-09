# Clancy

**Autonomous, board-driven development for Claude Code.**

[![npm](https://img.shields.io/npm/v/chief-clancy?color=cb3837)](https://www.npmjs.com/package/chief-clancy) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE) [![Tests](https://img.shields.io/badge/tests-34%20passing-brightgreen)](./test/) [![GitHub Stars](https://img.shields.io/github/stars/Pushedskydiver/clancy?style=flat)](https://github.com/Pushedskydiver/clancy/stargazers)

```bash
npx chief-clancy
```

Works on Mac and Linux. Windows requires [WSL](https://learn.microsoft.com/en-us/windows/wsl/install).

[What it does](#what-it-does) · [Install](#install) · [Commands](#commands) · [Supported boards](#supported-boards) · [Comparison](./COMPARISON.md) · [Roadmap](./ROADMAP.md) · [Contributing](./CONTRIBUTING.md)

---

![Clancy terminal preview](assets/terminal-preview.svg)

Named after Chief Clancy Wiggum (The Simpsons) — built on the [Ralph technique](https://ghuntley.com/ralph/) by Geoffrey Huntley. [See lineage →](#lineage)

---

## What it does

Clancy does three things:

1. **Scaffolds itself** into a project — scripts, docs, CLAUDE.md, .clancy/.env
2. **Scans your codebase** with 5 parallel specialist agents and writes 10 structured docs that Claude reads before every run
3. **Runs autonomously** — picking one ticket per loop from your Kanban board, implementing it, committing, squash-merging, and logging progress

One ticket per run. Fresh context window every iteration. No context rot.

---

## Who this is for

Clancy is for developers who:

- Use a Kanban board (Jira, GitHub Issues, or Linear) and want Claude to work through their backlog unattended
- Are comfortable with Claude Code and want to extend it for team workflows — not just solo hacking
- Have a codebase with enough structure that an AI agent can make meaningful progress on a ticket without constant hand-holding
- Want to go AFK and come back to committed, merged work

**Clancy is not for you if:**

- You want to supervise every change — use Claude Code directly instead
- Your tickets are large, vague, or span multiple sessions — Clancy works best with small, well-scoped tickets
- You don't use a Kanban board — you can still use `/clancy:map-codebase` for codebase scanning, but the run loop won't apply

Evaluating other tools? See [COMPARISON.md](./COMPARISON.md) for a side-by-side with GSD and PAUL.

---

## Expectations

Clancy is powerful but not magic. Here's what to expect:

**It will get things wrong sometimes.** Claude can misread a ticket, make the wrong architectural choice, or produce code that doesn't compile. This is normal. Use `/clancy:once` to watch the first few runs, then review the output before going fully AFK. Over time you'll learn which ticket types Clancy handles well on your codebase.

**Ticket quality matters more than you think.** A vague ticket produces vague implementation. Clancy works best when tickets have a clear summary, a description that explains the _why_, and concrete acceptance criteria. Use `/clancy:review` to score a ticket before running — it'll tell you exactly what's missing.

**You still own the code.** Clancy commits and merges locally, but it never pushes to remote. Review the squash commit before pushing. Treat it like code from a junior developer who works very fast — it needs a sanity check, not a full rewrite.

**Some tickets will need a retry.** If Claude gets stuck or produces something obviously wrong, delete the branch and run `/clancy:once` again. Fresh context, fresh attempt. If it fails twice on the same ticket, the ticket probably needs more detail.

**Clancy is token-heavy.** Each ticket starts a fresh Claude session that reads your codebase docs, CLAUDE.md, and then implements the ticket — before writing a single line of code, it has already consumed significant context. Rough estimates per ticket:

| Ticket complexity | Approximate total tokens | Approximate cost (Sonnet) |
|---|---|---|
| Simple (small change, clear scope) | 50,000–100,000 | $0.25–$0.75 |
| Medium (feature, 5–15 files touched) | 100,000–250,000 | $0.75–$2.00 |
| Complex (large feature, many files) | 250,000–500,000+ | $2.00–$5.00+ |

These are rough estimates — actual usage depends on your codebase doc size, how many files Claude reads during implementation, and how much code it writes. **Check Claude Code's usage dashboard after your first `/clancy:once` run to see real numbers for your codebase.**

A few ways to manage costs:
- Use a lighter model — set `CLANCY_MODEL=claude-haiku-4-5` in `.clancy/.env` for simpler tickets (significantly cheaper, less capable)
- Keep `.clancy/docs/` files concise — they're read in full on every ticket
- Use small, well-scoped tickets — fewer files read, less output generated

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
- `git` installed (comes with most development environments)

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
| `/clancy:run 20`       | Same, override MAX_ITERATIONS to 20 for this session                     |
| `/clancy:once`         | Pick up one ticket and stop                                              |
| `/clancy:status`       | Show next tickets without running — read-only                            |
| `/clancy:review`       | Score next ticket (0–100%) with actionable recommendations               |
| `/clancy:logs`         | Format and display `.clancy/progress.txt`                                |
| `/clancy:map-codebase` | Full 5-agent parallel codebase scan, writes 10 docs                      |
| `/clancy:update-docs`  | Incremental refresh — re-runs agents for changed areas                   |
| `/clancy:settings`     | View and change configuration — model, iterations, board, and more      |
| `/clancy:doctor`       | Diagnose your setup — test every integration, report what's broken       |
| `/clancy:update`       | Update Clancy to latest version                                          |
| `/clancy:uninstall`    | Remove Clancy commands — optionally remove `.clancy/` too               |
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
PLAYWRIGHT_DEV_COMMAND="yarn dev"
PLAYWRIGHT_DEV_PORT=5173
PLAYWRIGHT_STORYBOOK_COMMAND="yarn storybook"  # if applicable
PLAYWRIGHT_STORYBOOK_PORT=6006                 # if applicable
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
