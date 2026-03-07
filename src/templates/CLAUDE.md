<!-- clancy:start -->
## Clancy

This project uses Clancy for autonomous ticket-driven development.

### Docs
Before every run, read all docs in `.clancy/docs/`:
- STACK.md — tech stack and dependencies
- INTEGRATIONS.md — external services and APIs
- ARCHITECTURE.md — system design and data flow
- CONVENTIONS.md — code style and patterns
- TESTING.md — test approach and coverage expectations
- GIT.md — branching, commit format, merge strategy
- DESIGN-SYSTEM.md — tokens, components, visual conventions
- ACCESSIBILITY.md — WCAG requirements and ARIA patterns
- DEFINITION-OF-DONE.md — checklist before marking a ticket complete
- CONCERNS.md — known risks, tech debt, things to avoid

### Git workflow
- Read GIT.md before every run — follow its conventions exactly
- Default (if GIT.md is silent): one feature branch per ticket `feature/{ticket-key-lowercase}`, squash merge into target branch, conventional commits `feat(TICKET-123): summary`
- Target branch is auto-detected from the ticket: if it has a parent epic, Clancy branches from and merges into `epic/{epic-key}` (created from `CLANCY_BASE_BRANCH` if it doesn't exist); otherwise branches from `CLANCY_BASE_BRANCH` directly
- Delete ticket branch locally after merge — never push deletes

### Progress
Log completed tickets to `.clancy/progress.txt`:
`YYYY-MM-DD HH:MM | TICKET-KEY | Summary | DONE`

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
Read .clancy/docs/PLAYWRIGHT.md to determine which server to use (Storybook or dev server).
Apply the decision rule against this ticket's description — route/page/screen/layout → dev server,
component/atom/molecule/organism/variant/story → Storybook, ambiguous → dev server default.
Start the server using health check polling (not sleep). Navigate to the relevant route or story.
Screenshot, assess visually, check console. Fix before committing if anything looks wrong.
Kill by PID then sweep the port unconditionally — never leave a port open.
Log result: YYYY-MM-DD HH:MM | TICKET-KEY | PLAYWRIGHT_PASS|FAIL | server-used
<!-- clancy:end -->
