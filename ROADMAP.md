# Roadmap

Clancy follows a deliberate, minimal-by-default release philosophy. Features are added when they're genuinely needed, not speculatively.

---

## v0.1.0 — Foundation (current)

- `npx chief-clancy` installer
- Jira, GitHub Issues, Linear board support
- `/clancy:init`, `/clancy:run`, `/clancy:once`, `/clancy:status`, `/clancy:review`, `/clancy:logs`
- `/clancy:map-codebase` with 5 parallel specialist agents (10 docs)
- `/clancy:update-docs` incremental refresh
- `/clancy:settings` — view and change config, switch boards without re-running init
- `/clancy:doctor` — diagnose your setup, test every configured integration
- `/clancy:uninstall`, `/clancy:update`, `/clancy:help`
- `CLANCY_LABEL` filter for all three boards — limit pickup to labelled tickets in mixed backlogs
- Pre-implementation executability check — Clancy self-assesses tickets before executing, skips non-codebase work
- Figma MCP three-tier integration
- Playwright visual checks with Storybook detection and Figma design compliance comparison
- Slack/Teams webhook notifications
- Board registry for community extensibility

---

## v0.2.0 — Stability and DX

- Jira/Linear ticket status transition after completion — mark ticket done, prevent re-pickup in AFK loops
- `--dry-run` flag for `clancy-once.sh` — shows what would be done without doing it
- Targeted doc loading — load only relevant `.clancy/docs/` files per ticket rather than all 10 every run (token optimisation)
- Shellcheck CI for all shell scripts
- More test fixtures (edge cases discovered post-release)

---

## v0.3.0 — Board ecosystem

- Community board contributions from v0.1.0 merged
- Shortcut (formerly Clubhouse) support
- Notion database support
- Azure DevOps support
- Board auto-detection: Clancy detects which board is configured without asking

---

## v1.0.0 — Production-ready

- Stable API — no breaking changes to command signatures after this
- Full test coverage for all three built-in boards
- Polished init wizard with auto-detection for common setups
- Complete documentation site
- npm package integrity checks
- Native Windows support — Node.js-based runner replacing bash scripts, no WSL required

---

## v1.1.0 — Review automation

- `/clancy:run --review` — confidence check before each ticket, pause if below threshold
- `CLANCY_AUTO_REVIEW=true` env var to enable by default
- `CLANCY_REVIEW_THRESHOLD=N` to set minimum score for auto-run
- Ticket quality trends in `/clancy:logs`

---

## v2.0.0 — Multi-agent

- Parallel ticket implementation (multiple tickets simultaneously)
- Dependency graph awareness — don't start a ticket blocked by another
- PR creation and review request automation
- Automatic test run after implementation
- Agent specialisation: frontend agent, backend agent, infra agent
- Team-mode: multiple Claude Code instances coordinating via shared queue

---

## Not on the roadmap

These have been considered and deliberately excluded:

- **GUI / web dashboard** — Clancy is a CLI tool. The terminal is the UI.
- **Built-in LLM** — Clancy uses Claude Code. It is not an LLM runtime.
- **Ticket creation** — Clancy consumes tickets, not creates them. That's the human's job.
- **Branch protection bypass** — Clancy follows your repo's git conventions as documented in GIT.md. It never bypasses hooks or protection rules.
