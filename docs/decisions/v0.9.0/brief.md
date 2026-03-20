# v0.9.0 Brief — Design-Aware Implementation

**Status:** Draft
**Date:** 2026-03-20

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

1. **Design specifications in plans** — extend the planner to conditionally produce component specs, accessibility specs, content specs, user flows, and layout descriptions for UI tickets
2. **Optional visual previews** — integrate Google Stitch to generate design previews from the specs, with a feedback loop via board comments
3. **Post-delivery visual verification** — Playwright screenshots, axe-core WCAG checks, and Lighthouse audits posted as PR comments

## Non-Goals

- Full designer role with its own commands and approval gates (this is a planner sub-phase, not a new role)
- Pixel-perfect design generation (Stitch is a preview tool, not a production design system)
- Replacing Figma MCP (Stitch is additive — Figma reads existing designs, Stitch generates new ones)
- Visual verification blocking delivery (it's post-PR, informational — code checks still block via the Stop hook)
- Wireframes or visual mockups in text form (text layout descriptions instead)

## Scope

### In scope

| Feature | Description |
|---|---|
| Design sub-phase | Conditional `## Design Specifications` section in planner output for UI tickets |
| 6 specification sections | Component specs, accessibility specs, content specs, user flows (Mermaid), layout descriptions, pages (URL mapping) |
| Google Stitch integration | Optional (`CLANCY_STITCH=true`). MCP-based, not SDK. Screenshot + link posted as board comment. All 6 boards supported. |
| 2-path feedback classification | Technical-only feedback → revise plan only. Everything else → revise specs + regenerate Stitch. |
| Stitch usage tracking | `.clancy/stitch-usage.json` — monthly count, warn at 50%, skip at 100%. Claude reads/writes directly (no TypeScript module). |
| Playwright CLI | Post-delivery screenshots of affected pages. Structural comparison against Stitch (if available) or spec descriptions. |
| axe-core CLI | WCAG compliance against accessibility specs. A-level violations flagged, auto-fixable ones get follow-up commits. |
| Lighthouse CI | Performance/accessibility/SEO scores posted as PR comment. Configurable threshold (`CLANCY_LIGHTHOUSE_THRESHOLD`). |
| Phase 10a (visual-verify) | New orchestrator phase between deliver and cost. Only activates for UI tickets. Dev server lifecycle managed here. |
| Init wizard update | Design tool selection (None / Figma / Stitch / Both) when Planner or Strategist enabled. |

### Out of scope

- Security scanning (v0.10.0)
- Bug triage role (v0.10.0)
- Auto-refresh docs (v0.10.0)
- Review automation / confidence self-check (v0.10.0)

## Ticket Decomposition

| # | Title | Description | Size | Deps | Mode |
|---|---|---|---|---|---|
| 1 | Design sub-phase in planner | Extend `plan.md` with conditional UI detection + 6 specification sections | M | — | AFK |
| 2 | Smart feedback classification | Add 2-path classification (technical vs everything-else) to `plan.md` re-run flow | S | #1 | AFK |
| 3 | Stitch MCP integration | MCP config in init, Stitch tool invocation in planner, screenshot posting to all 6 boards, usage tracking | L | #1 | AFK |
| 4 | Init wizard — design tools | Add design tool selection step, Stitch API key prompt, MCP server config | S | #3 | AFK |
| 5 | Settings — design tools | Add D1/D2 design tool settings to settings workflow | S | #4 | AFK |
| 6 | Playwright visual verification | Phase 10a, dev server detection/launch, screenshot capture, structural comparison | L | #1 | AFK |
| 7 | axe-core accessibility verification | Run axe-core against pages, check against specs, flag A-level violations, auto-fix commits | M | #6 | AFK |
| 8 | Lighthouse CI | Run Lighthouse, parse scores, post to PR body, configurable threshold | S | #6 | AFK |
| 9 | Documentation + release | All doc updates, version bump, CHANGELOG, test badge, glossary, architecture, lifecycle | M | #1-#8 | AFK |

## Success Criteria

- UI tickets produce plans with design specifications (component, a11y, content, flows, layout, pages)
- Non-UI tickets are unaffected (no design section, no extra token cost)
- Stitch generates design previews when configured (screenshot + link on the board)
- Feedback on design comments triggers spec revision + Stitch regeneration
- PR comments include visual verification results (screenshots, WCAG findings, Lighthouse scores)
- All existing tests pass, no regressions in non-UI ticket flow

## Risks

1. **Stitch is Google Labs — could change or disappear.** Design specs work without it. Stitch is optional visual validation.
2. **Playwright/axe-core/Lighthouse require a running dev server.** Skip gracefully if no dev server found.
3. **Stitch rate limits (350/month).** Usage tracking with 50% warning. Heavy AFK use could exhaust budget.
4. **MCP tool availability.** Stitch MCP server may fail to start. Fail gracefully — post warning, proceed with text specs.
5. **Design specs add ~500-1000 tokens per UI plan.** Justified: reduces rework cycles which cost more.

## Open Questions

- Should we ship Wave 1 (design sub-phase) as a standalone patch before Waves 2-3? It has zero external dependencies and delivers immediate value.
- Should Lighthouse threshold default to 90 (warn) or 0 (disabled)? 90 produces warnings on most sites without optimisation.
