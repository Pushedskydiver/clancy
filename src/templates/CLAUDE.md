<!-- clancy:start -->
## Clancy

This project uses Clancy for autonomous ticket-driven development.

### Version check
At the start of each session, read `~/.claude/cache/clancy-update-check.json` (use the Read tool). If it exists and `update_available` is true, display exactly:
`⚠ Clancy update available: v{installed} → v{latest}. Run /clancy:update to upgrade.`
Then continue normally. If the file is missing or unreadable, continue silently.

### Docs
Before every run, read these core docs from `.clancy/docs/`:
- STACK.md — tech stack and dependencies
- ARCHITECTURE.md — system design and data flow
- CONVENTIONS.md — code style and patterns
- GIT.md — branching, commit format, merge strategy
- DEFINITION-OF-DONE.md — checklist before marking a ticket complete
- CONCERNS.md — known risks, tech debt, things to avoid

Also read these if relevant to the ticket:
- INTEGRATIONS.md — if the ticket touches external APIs, services, or authentication
- TESTING.md — if the ticket involves tests, specs, or coverage requirements
- DESIGN-SYSTEM.md — if the ticket touches UI, components, styles, or visual design
- ACCESSIBILITY.md — if the ticket touches accessibility, ARIA, or WCAG requirements

### Executability check

Before any git operation, branch creation, or code change — assess whether this ticket can be implemented entirely as a code change committed to this repo.

**Skip the ticket** if it primarily requires any of the following — Clancy cannot do these:
- **External system admin:** work in Google Analytics, Salesforce, HubSpot, the AWS console, app store dashboards, or any external platform not accessible through code
- **Human process steps:** getting sign-off or approval, sending emails to customers, coordinating with people, scheduling meetings, making announcements to users
- **Non-repo production ops:** deploying to production, rotating secrets in prod, scaling infrastructure — unless the task is purely about editing CI/CD config files that live in this repo
- **Non-code deliverables:** writing runbooks, updating Confluence or wikis, creating presentations, documenting in external tools

When in doubt: "Is the primary deliverable a code change committed to this repo?" — if yes, implement it; if no, skip it.

**If skipping, do all four of these in order:**
1. Output this exact line: `⚠ Skipping [TICKET-KEY]: {one-line reason}`
2. Output this exact line: `Ticket skipped — update it to be codebase-only work, then re-run.`
3. Append to `.clancy/progress.txt`: `YYYY-MM-DD HH:MM | TICKET-KEY | SKIPPED | {reason}`
4. Stop. No branches, no file changes, no git operations.

**If the ticket is codebase work**, proceed to implementation normally.

### Git workflow
- Read GIT.md before every run — follow its conventions exactly
- Default (if GIT.md is silent): one feature branch per ticket `feature/{ticket-key-lowercase}`, push and create a PR, conventional commits `feat(TICKET-123): summary`
- Target branch is auto-detected from the ticket: if it has a parent epic, PR targets `epic/{epic-key}` (created from `CLANCY_BASE_BRANCH` if it doesn't exist); otherwise PR targets `CLANCY_BASE_BRANCH` directly

### Progress
Log completed tickets to `.clancy/progress.txt`:
`YYYY-MM-DD HH:MM | TICKET-KEY | Summary | DONE`

Planning entries use: `YYYY-MM-DD HH:MM | TICKET-KEY | PLAN | S/M/L`
Revised plan entries use: `YYYY-MM-DD HH:MM | TICKET-KEY | REVISED | S/M/L`
Approval entries use: `YYYY-MM-DD HH:MM | TICKET-KEY | APPROVE | —`
Failed comment posts use: `YYYY-MM-DD HH:MM | TICKET-KEY | POST_FAILED | {reason}`

### Design context
When a ticket description contains a Figma URL, fetch design context before implementing.
Use the three-tier approach in order:
  1. Figma MCP: get_metadata → targeted get_design_context → get_screenshot (3 calls, best quality)
  2. Figma REST API image export: parse file key + node ID from URL, fetch rendered PNG as vision input
  3. Ticket image attachment: use any image attached to the ticket description as vision input
Fetch once only — never return to Figma mid-session.
Map all token values to CSS custom properties. Never use raw SVGs or hardcoded colours.
Figma URL must come from the ticket description only — never from CLAUDE.md or other docs.

### Visual checks
After implementing a UI ticket, run a visual check before committing.
Read `.clancy/docs/PLAYWRIGHT.md` for the authoritative Playwright configuration (which server to use: Storybook or dev server). Use `.clancy/.env` only for ports and start commands as needed.
Apply the decision rule against this ticket's description — route/page/screen/layout → dev server,
component/atom/molecule/organism/variant/story → Storybook, ambiguous → dev server default.
Start the server using health check polling (not sleep). Navigate to the relevant route or story.
Screenshot, assess visually, check console. Fix before committing if anything looks wrong.
If a Figma design was fetched for this ticket, compare the screenshot directly against it — check layout, spacing, colours, typography, and component fidelity. Treat the Figma design as the source of truth.
Kill by PID then sweep the port unconditionally — never leave a port open.
Log result: YYYY-MM-DD HH:MM | TICKET-KEY | PLAYWRIGHT_PASS|FAIL | server-used
<!-- clancy:end -->
