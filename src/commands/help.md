# /clancy:help

List all Clancy commands with descriptions.

Display the following:

---

## Clancy — autonomous, board-driven development for Claude Code

Named after Chief Clancy Wiggum (Ralph's dad, The Simpsons). Built on the Ralph technique
coined by Geoffrey Huntley (ghuntley.com/ralph/). Clancy extends that foundation with board
integration, structured codebase docs, and a git workflow built for team development.

### Commands

| Command | Description |
|---|---|
| `/clancy:init` | Wizard — choose board, collect config, scaffold everything, offer map-codebase |
| `/clancy:run` | Run in loop mode until queue is empty or MAX_ITERATIONS hit |
| `/clancy:run 5` | Same, but override MAX_ITERATIONS to 5 for this session |
| `/clancy:once` | Pick up one ticket and stop — good for first runs and debugging |
| `/clancy:status` | Show next tickets without running — read-only board check |
| `/clancy:review` | Score next ticket (0–100%) with actionable recommendations |
| `/clancy:logs` | Format and display .clancy/progress.txt |
| `/clancy:map-codebase` | Full 5-agent parallel codebase scan, writes all 10 docs |
| `/clancy:update-docs` | Incremental refresh — re-runs agents for changed areas only |
| `/clancy:settings` | View and change configuration (model, iterations, branch, etc.) |
| `/clancy:update` | Update Clancy to latest version via npx |
| `/clancy:help` | This screen |

### How it works

1. Run `/clancy:init` to connect your Kanban board and scaffold .clancy/
2. Run `/clancy:map-codebase` to generate codebase docs (or say yes during init)
3. Run `/clancy:once` to watch your first ticket — then go AFK with `/clancy:run`

Clancy picks one ticket per loop, fresh context every iteration. No context rot.

### Links

- GitHub: github.com/Pushedskydiver/clancy
- Issues: github.com/Pushedskydiver/clancy/issues
- Lineage: ghuntley.com/ralph/

---

Show this output exactly. Do not add, remove, or reformat any content.
