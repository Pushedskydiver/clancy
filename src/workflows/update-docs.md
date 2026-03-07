# Clancy Update-Docs Workflow

## Overview

Incrementally refresh `.clancy/docs/` by re-running only the agents covering areas that have changed. Faster than a full `map-codebase` when changes are targeted.

---

## Step 1 — Determine what changed

Ask: "What changed since your last codebase scan? (or press Enter to auto-detect via git diff)"

If the user describes changes, parse their description to identify affected areas.

If Enter is pressed, run:
```bash
git diff --name-only HEAD~10 HEAD 2>/dev/null || git diff --name-only
```

---

## Step 2 — Map changes to agents

| Changed files / areas | Re-run agent |
|---|---|
| `package.json`, `*.lock`, deps, build config, env | tech |
| `src/` structure, API routes, data models, services | arch |
| test files, lint config, `.eslintrc`, `jest.config.*` | quality |
| CSS, tokens, Figma, component library, a11y | design |
| Security, performance, infra, known issues | concerns |

Multiple agents may need to re-run — run them in parallel.

If `PLAYWRIGHT_ENABLED=true` and the tech agent is re-running: verify `PLAYWRIGHT.md` ports/commands still match what `STACK.md` now says. Update `PLAYWRIGHT.md` if they differ.

---

## Step 3 — Confirm before running

```
Based on your changes, I'll re-run:
  - {agent list}

This will update:
  - {file list}

Continue? [Y/n]:
```

---

## Step 4 — Re-run selected agents in parallel

Same as map-codebase Step 3, but only for the selected agents.

---

## Step 5 — Verify and commit

Verify each updated file is non-empty.

```bash
git add .clancy/docs/
git commit -m "docs(clancy): update-docs — refresh .clancy/docs/"
```

---

## Step 6 — Final message

```
Docs updated.

Updated: {file list}

Run /clancy:once or /clancy:run when ready.
```
