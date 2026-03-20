# v0.9.0 Brief — Design-Aware Implementation

**Status:** Approved
**Date:** 2026-03-20
**Approved:** 2026-03-20

---

## Problem

Clancy implements UI tickets with no design awareness. When a ticket says "add a login page," the implementer produces functional code but with:

- No accessibility attributes (ARIA roles, keyboard navigation, focus management)
- Placeholder text instead of real copy ("Enter value" instead of actual error messages)
- No component specifications (what props, what states, what variants?)
- No spatial layout guidance
- No visual verification that the output matches the intent

The reviewer catches these gaps manually, triggering rework cycles. Each rework costs more tokens than producing design specs upfront would have.

## Goals

1. **Design specifications in plans** — extend the planner to conditionally produce component specs, accessibility specs, content specs, user flows, layout descriptions, and page URL mappings for UI tickets
2. **Optional visual previews** — integrate Google Stitch to generate design previews from the specs, with a feedback loop via board comments
3. **Post-delivery visual verification** — Playwright screenshots, axe-core WCAG checks, and Lighthouse audits posted as PR comments

## Non-Goals

- Full designer role with its own commands and approval gates (this is a planner sub-phase, not a new role)
- Pixel-perfect design generation (Stitch is a preview tool, not a production design system)
- Replacing Figma MCP (Stitch is additive — Figma reads existing designs, Stitch generates new ones. Verify MCP configs don't conflict when both are enabled.)
- Visual verification blocking delivery (it's post-PR, informational — code checks still block via the Stop hook)
- Wireframes or visual mockups in text form (text layout descriptions instead)

## Release Strategy

**Ship in two increments:**

- **v0.9.0** — Wave 1 only (design sub-phase in planner). Zero external dependencies, immediate value, zero risk to existing flows.
- **v0.9.1** — Waves 2-3 (Stitch integration + visual verification). External tool dependencies (Stitch MCP, Playwright, axe-core, Lighthouse) isolated from the core feature.

This avoids Stitch/Playwright issues blocking the highest-value feature (design specs in plans).

## Scope

### In scope

| Feature | Description |
|---|---|
| Design sub-phase | Conditional `## Design Specifications` section in planner output for UI tickets |
| 6 specification sections | Component specs, accessibility specs, content specs, user flows (Mermaid), layout descriptions, pages (URL mapping) |
| Google Stitch integration | Optional (`CLANCY_STITCH=true`). MCP-based, not SDK. Screenshot + link posted as board comment. All 6 boards with per-board screenshot persistence (GitHub content API, Jira attachment, others via URL). |
| 2-path feedback classification | Technical-only feedback → revise plan only. Everything else → revise specs + regenerate Stitch. |
| Stitch usage tracking | `.clancy/stitch-usage.json` — monthly count, warn at 50%, skip at 100%. Claude reads/writes directly (no TypeScript module). |
| Playwright CLI | Post-delivery screenshots of affected pages. Structural comparison against Stitch (if available) or spec descriptions. |
| axe-core CLI | WCAG compliance against accessibility specs. A-level violations flagged, auto-fixable ones get follow-up commits. |
| Lighthouse CI | Performance/accessibility/SEO scores posted as PR comment. Configurable threshold (`CLANCY_LIGHTHOUSE_THRESHOLD`, default: 0 = disabled). |
| Phase 10a (visual-verify) | New orchestrator phase between deliver (10) and cost (11). Phase file in `phases/`, utility modules in `src/scripts/shared/verify/`. Only activates for UI tickets. Dev server lifecycle managed here. |
| Init wizard update | Design tool selection (None / Figma / Stitch / Both) when Planner or Strategist enabled. |
| `CLANCY_DEV_URLS` env var | Manual URL mapping for visual verification (`LoginForm=http://localhost:3000/login`). Falls back to `### Pages` in design specs or Storybook auto-detection. |

### Out of scope

- Security scanning (v0.10.0)
- Bug triage role (v0.10.0)
- Auto-refresh docs (v0.10.0)
- Review automation / confidence self-check (v0.10.0)

## Ticket Decomposition

### v0.9.0 — Design sub-phase

| # | Title | Description | Size | Deps | Mode |
|---|---|---|---|---|---|
| 1 | Design sub-phase in planner | Extend `plan.md` with conditional UI detection + 6 specification sections + tests | M | — | AFK |
| 2 | Smart feedback classification | Add 2-path classification (technical vs everything-else) to `plan.md` re-run flow + tests | S | #1 | AFK |
| 3 | Documentation + release (v0.9.0) | Doc updates, version bump, CHANGELOG, test badge, glossary, architecture, lifecycle | M | #1, #2 | HITL |

### v0.9.1 — Stitch + visual verification

| # | Title | Description | Size | Deps | Mode |
|---|---|---|---|---|---|
| 4 | Init wizard — design tools | Add design tool selection step, Stitch API key prompt, MCP server config. Verify Figma MCP coexistence. | S | #1 | AFK |
| 5 | Settings — design tools | Add D1/D2 design tool settings to settings workflow | S | #4 | AFK |
| 6 | Stitch MCP — core integration | MCP tool invocation in planner (`build_site` + `get_screen_image`), usage tracking, feedback loop | M | #1, #4 | HITL |
| 7 | Stitch MCP — board comment posting | Screenshot persistence per board (GitHub upload, Jira attachment, others URL). All 6 boards. | M | #6 | AFK |
| 8 | Playwright visual verification | Phase 10a, dev server detection/launch/cleanup, screenshot capture, structural comparison. Structural comparison is the primary risk. + tests | L | #1 | HITL |
| 9 | axe-core accessibility verification | Run axe-core against pages, check against specs, flag A-level violations, auto-fix commits + tests | M | #8 | AFK |
| 10 | Lighthouse CI | Run Lighthouse, parse scores, post to PR body, configurable threshold + tests | S | #8 | AFK |
| 11 | Documentation + release (v0.9.1) | All doc updates, version bump, CHANGELOG, test badge | M | #4-#10 | HITL |

## Success Criteria

- UI tickets produce plans with design specifications (component, a11y, content, flows, layout, pages)
- Non-UI tickets are unaffected (no design section, no extra token cost)
- UI ticket detection correctly identifies UI tickets in a representative test set
- Stitch generates design previews when configured (screenshot + link on the board, all 6 boards)
- Feedback on design comments triggers spec revision + Stitch regeneration
- PR comments include visual verification results (screenshots, WCAG findings, Lighthouse scores)
- Visual verification phase skips gracefully when no dev server is detected
- Playwright/axe-core/Lighthouse skip gracefully when their CLI is not installed
- All new env vars validated by the Zod schema
- Stitch usage tracking correctly resets monthly and warns at 50%/100%
- All existing tests pass, no regressions in non-UI ticket flow
- Target test count: 1250+ (v0.9.0), 1350+ (v0.9.1)

## Risks

1. **Stitch is Google Labs — could change or disappear.** Design specs work without it. Stitch is optional visual validation.
2. **Playwright/axe-core/Lighthouse require a running dev server.** Skip gracefully if no dev server found. Detect existing server on expected port before launching (avoid port conflicts).
3. **Stitch rate limits (350/month).** Usage tracking with 50% warning. Heavy AFK use could exhaust budget.
4. **MCP tool availability.** Stitch MCP server may fail to start (npx download, network). Fail gracefully — post warning, proceed with text specs.
5. **Design specs add ~500-1000 tokens per UI plan.** Justified: reduces rework cycles which cost more.
6. **Community MCP package stability.** `@_davideast/stitch-mcp` is maintained by one developer. If abandoned, Stitch integration breaks. Mitigation: Stitch is optional, design specs work without it.
7. **CLI tools not installed.** Playwright, axe-core, Lighthouse are `npx` commands that may not be cached. First run could be slow (download). Skip with warning if installation fails.
8. **Token cost of visual verification phase.** Running 3 tools, parsing output, posting PR comments adds token overhead per UI ticket in AFK mode. Mitigated by only activating for UI tickets.
9. **MCP server cold-start latency.** `npx @_davideast/stitch-mcp proxy` downloads on first run (10-30s). Acceptable in AFK mode but noticeable interactively.

## Resolved Questions

1. **Time guard vs visual-verify.** Phase 10a checks elapsed time against `CLANCY_TIME_LIMIT`. If >= 100%, skip visual verification entirely ("Visual verification skipped — time limit exceeded"). If >= 80% but < 100%, run visual checks but skip axe-core auto-fix commits (report only). Below 80%, run everything including auto-fixes.

2. **AFK auto-fix behaviour.** axe-core auto-fixes are pushed as a **separate commit** (not amend) to the PR branch using format `fix(a11y): <description>`. This triggers CI (expected, validates the fix). Rework detection does NOT pick it up — rework requires `changesRequested` review state from a human reviewer. The verification gate (Stop hook) does NOT re-fire — it only runs during the Claude Code session, which has ended by phase 10a.

3. **`### Pages` section — optional in design specs, required for visual verification via 3-tier fallback.** The planner includes `### Pages` when route info is available, omits otherwise. For visual verification, URL resolution: (1) `CLANCY_DEV_URLS` env var (explicit, highest priority), (2) `### Pages` from design specs, (3) Storybook auto-detection. If all three yield no URLs, skip with PR comment: "Visual verification skipped — no page URLs available."

4. **Roadmap sync.** Roadmap updated to match the brief: 2-path feedback classification and Stitch generation inside `/clancy:plan` before approval.
