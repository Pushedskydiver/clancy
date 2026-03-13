# Clancy Map-Codebase Workflow

## Overview

Scan the codebase with 5 parallel specialist agents, each writing their assigned docs to `.clancy/docs/`. All 5 agents run simultaneously.

---

## Step 1 — Check existing docs

If `.clancy/docs/` already has non-empty files:
```
.clancy/docs/ already has content.

[1] Refresh all — re-run all 5 agents
[2] Update changed — detect what changed and re-run relevant agents
[3] Skip — keep existing docs
```

If no content exists, proceed directly to Step 2.

---

## Step 2 — Create docs directory

Create `.clancy/docs/` if it doesn't exist.

---

## Step 3 — Spawn all 5 agents simultaneously

Launch all agents in parallel. Do not wait for one before starting the next.

Each agent is defined in `src/agents/`. Pass the agent the full path to the docs directory and the project root.

| Agent | Prompt file | Docs written |
|---|---|---|
| tech | `src/agents/tech-agent.md` | `STACK.md`, `INTEGRATIONS.md` |
| arch | `src/agents/arch-agent.md` | `ARCHITECTURE.md` |
| quality | `src/agents/quality-agent.md` | `CONVENTIONS.md`, `TESTING.md`, `GIT.md`, `DEFINITION-OF-DONE.md` |
| design | `src/agents/design-agent.md` | `DESIGN-SYSTEM.md`, `ACCESSIBILITY.md` |
| concerns | `src/agents/concerns-agent.md` | `CONCERNS.md` |

Tell the user agents are running:
```
🚨 Clancy — Map Codebase
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Sending in the task force..." — 5 agents deployed.

  🔍 tech     → STACK.md, INTEGRATIONS.md
  🔍 arch     → ARCHITECTURE.md
  🔍 quality  → CONVENTIONS.md, TESTING.md, GIT.md, DEFINITION-OF-DONE.md
  🔍 design   → DESIGN-SYSTEM.md, ACCESSIBILITY.md
  🔍 concerns → CONCERNS.md
```

---

## Step 4 — Collect confirmations

Each agent returns a brief confirmation when done. Display as they complete:
```
  ✅ tech agent complete
  ✅ arch agent complete
  ✅ quality agent complete
  ✅ design agent complete
  ✅ concerns agent complete
```

---

## Step 5 — Verify

Check that all 10 files exist and are non-empty:
- `.clancy/docs/STACK.md`
- `.clancy/docs/INTEGRATIONS.md`
- `.clancy/docs/ARCHITECTURE.md`
- `.clancy/docs/CONVENTIONS.md`
- `.clancy/docs/TESTING.md`
- `.clancy/docs/GIT.md`
- `.clancy/docs/DEFINITION-OF-DONE.md`
- `.clancy/docs/DESIGN-SYSTEM.md`
- `.clancy/docs/ACCESSIBILITY.md`
- `.clancy/docs/CONCERNS.md`

If any file is missing or empty, report which agent failed and suggest re-running:
```
Warning: {filename} is missing or empty. The {agent} agent may have failed.
Run /clancy:update-docs to re-run only that agent.
```

Also check: if `PLAYWRIGHT_ENABLED=true` in `.clancy/.env`, verify `.clancy/docs/PLAYWRIGHT.md` exists. If not, create it from the template (see scaffold.md).

---

## Step 6 — Commit

```bash
git add .clancy/docs/
git commit -m "docs(clancy): map codebase — generate .clancy/docs/"
```

---

## Step 7 — Final message

```
✅ Codebase mapped — 10 files written to .clancy/docs/

"Case closed. All files accounted for." — Run /clancy:once to pick up your first ticket, or /clancy:run to process the queue.
```

---

## Agent instructions (apply to all 5 agents)

When writing agent prompts, embed these instructions:

- Use actual file paths (`src/components/Button.tsx` not "the Button component")
- Show HOW things are done with real code examples, not just WHAT exists
- Use Glob and Grep liberally before writing — understand the codebase, don't guess
- Write directly to file using the Write tool — never use bash heredocs
- Return a brief confirmation only — do not include doc contents in the response
- If a section has no content (e.g. no design system exists), write: `<!-- Not applicable to this project -->`
