# Clancy

Autonomous, board-driven development for Claude Code.

Named after Chief Clancy Wiggum (Ralph's dad, The Simpsons) — because Clancy equips and deploys Ralph before sending him to work. Built on the [Ralph technique](https://ghuntley.com/ralph/) coined by Geoffrey Huntley. Clancy extends that foundation with Kanban board integration, structured codebase docs, and a git workflow built for team development.

```bash
npx clancy
```

---

## What it does

Clancy does three things:

1. **Scaffolds itself** into a project — scripts, docs, CLAUDE.md, .env
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
npx clancy
```

You'll be asked: global install (`~/.claude`) or local (`./.claude`). Either works. Global makes commands available in all projects.

**Prerequisites:**
- [Claude Code](https://claude.ai/code) CLI installed
- `jq` installed (`brew install jq` or `apt install jq`)
- `curl` installed (comes with macOS/most Linux)

---

## Getting started

```bash
# 1. Install Clancy commands
npx clancy

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

| Command | Description |
|---|---|
| `/clancy:init` | Wizard — choose board, collect config, scaffold everything |
| `/clancy:run` | Loop mode — processes tickets until queue is empty or MAX_ITERATIONS hit |
| `/clancy:run 5` | Same, override MAX_ITERATIONS to 5 for this session |
| `/clancy:once` | Pick up one ticket and stop |
| `/clancy:status` | Show next tickets without running — read-only |
| `/clancy:review` | Score next ticket (0–100%) with actionable recommendations |
| `/clancy:logs` | Format and display `.clancy/progress.txt` |
| `/clancy:map-codebase` | Full 5-agent parallel codebase scan, writes 10 docs |
| `/clancy:update-docs` | Incremental refresh — re-runs agents for changed areas |
| `/clancy:update` | Update Clancy to latest version |
| `/clancy:help` | Command reference |

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
  .env.example        — credential template for your board
```

Clancy also merges a section into your `CLAUDE.md` (or creates one) that tells Claude to read all these docs before every run.

---

## Optional enhancements

Set during `/clancy:init` advanced setup, or by editing `.env` directly.

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

Clancy is built on the **Ralph technique** coined by **Geoffrey Huntley** ([ghuntley.com/ralph/](https://ghuntley.com/ralph/)).

Ralph in its purest form:
```bash
while :; do cat PROMPT.md | claude-code; done
```

Clancy is what happens when you take that idea seriously for team development. See [CREDITS.md](./CREDITS.md) for the full story.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The most useful contribution is adding a new board — it's a shell script + a JSON entry.

## License

MIT — see [LICENSE](./LICENSE).
