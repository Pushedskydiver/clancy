# /clancy:help

List all Clancy commands with descriptions.

Display the following:

---

## Clancy — autonomous, board-driven development for Claude Code

Named after Chief Clancy Wiggum (Ralph's dad, The Simpsons). Built on the Ralph technique
coined by Geoffrey Huntley (ghuntley.com/ralph/). Clancy extends that foundation with board
integration (6 boards), structured codebase docs, and a git workflow built for team development.

**Supported boards:** Jira, GitHub Issues, Linear, Shortcut, Notion, Azure DevOps

### Planner *(optional — enable via `CLANCY_ROLES=planner` in `.clancy/.env`)*

| Command | Description |
|---|---|
| `/clancy:plan` | Refine backlog tickets into structured implementation plans |
| `/clancy:plan 3` | Plan up to 3 tickets in batch mode |
| `/clancy:plan PROJ-123` | Plan a specific ticket by key (also `#42`, `ENG-42`) |
| `/clancy:plan --fresh` | Discard any existing plan and start from scratch |
| `/clancy:approve-plan` | Promote an approved plan to the ticket description |

### Strategist *(optional — enable via `CLANCY_ROLES=strategist` in `.clancy/.env`)*

| Command | Description |
|---|---|
| `/clancy:brief` | Generate a strategic brief (research + grill + decomposition) |
| `/clancy:approve-brief` | Convert a brief into tickets on the board |

### Implementer

| Command | Description |
|---|---|
| `/clancy:once` | Pick up one ticket and stop — good for first runs and debugging |
| `/clancy:run` | Run in loop mode until queue is empty or MAX_ITERATIONS hit |
| `/clancy:run 20` | Same, but override MAX_ITERATIONS to 20 for this session |
| `/clancy:dry-run` | Preview next ticket without making any changes |

### Reviewer

| Command | Description |
|---|---|
| `/clancy:review` | Score next ticket (0–100%) with actionable recommendations |
| `/clancy:status` | Show next tickets without running — read-only board check |
| `/clancy:logs` | Format and display .clancy/progress.txt |

### Setup & Maintenance

| Command | Description |
|---|---|
| `/clancy:init` | Wizard — choose board, collect config, scaffold everything, offer map-codebase |
| `/clancy:settings` | View and change configuration — model, iterations, board, and more |
| `/clancy:doctor` | Diagnose your setup — test every integration and report what's broken |
| `/clancy:map-codebase` | Full 5-agent parallel codebase scan, writes all 10 docs |
| `/clancy:update-docs` | Incremental refresh — re-runs agents for changed areas only |
| `/clancy:update` | Update Clancy to latest version via npx |
| `/clancy:uninstall` | Remove Clancy commands — optionally remove `.clancy/` too |
| `/clancy:help` | This screen |

### How it works

1. Run `/clancy:init` to connect your Kanban board and scaffold .clancy/
2. Run `/clancy:map-codebase` to generate codebase docs (or say yes during init)
3. Run `/clancy:dry-run` to preview the first ticket, then `/clancy:once` to run it — then go AFK with `/clancy:run`

Clancy picks one ticket per loop, fresh context every iteration. No context rot.

### Links

- GitHub: github.com/Pushedskydiver/clancy
- Issues: github.com/Pushedskydiver/clancy/issues
- Lineage: ghuntley.com/ralph/

---

Show this output exactly. Do not add, remove, or reformat any content.
