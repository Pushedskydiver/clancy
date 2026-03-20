# Team Readiness (v0.8.0) — Design Document (Shipped)

## Problem

Clancy supported three boards (Jira, GitHub Issues, Linear) and ran as a solo agent. Teams adopting Clancy hit three walls: board coverage gaps, no operational guardrails for AFK sessions, and no way to detect when installed files drift from the published package.

## Key Decisions

### Board ecosystem

- **6 boards supported in setup workflows:** Jira, GitHub Issues, Linear, Shortcut, Notion, Azure DevOps. Init wizard, settings, scaffold templates, and help all updated.
- **Board modules (TypeScript) for new boards are not yet implemented** — v0.8.0 adds the setup/config layer. Runtime `Board` type implementations for Shortcut, Notion, and Azure DevOps are planned for v0.8.1+.
- **Auto-detection hint:** init wizard silently checks `.clancy/.env` for existing board env vars and suggests the detected board.

### New hooks

- **Desktop notification** (`clancy-notification.js`) — Notification event hook. Platform detection: macOS (osascript), Linux (notify-send), Windows (PowerShell). Falls back to console.log. `CLANCY_DESKTOP_NOTIFY=false` to suppress.
- **Drift detector** (`clancy-drift-detector.js`) — PostToolUse hook, debounced once per session via tmpdir flag. Compares `.clancy/version.json` (written by installer) against the commands' VERSION file. Warns on mismatch.

### Quiet hours

- **AFK runner check, not a hook.** Quiet hours are checked before each iteration in `runAfkLoop()`, not via a separate hook. This avoids complexity and race conditions.
- **Overnight windows supported.** `CLANCY_QUIET_START=22:00` + `CLANCY_QUIET_END=06:00` sleeps until 06:00 whether the current time is before or after midnight.
- **Both vars required.** If only one is set, a warning is logged and the check is skipped.

### Version tracking

- **`.clancy/version.json`** written by `install.ts` on every install/update. Contains `{ version, installedAt }`. Read by the drift detector hook to compare against the commands' VERSION file.

### What was deferred

- **Board runtime implementations** for Shortcut, Notion, Azure DevOps (v0.8.1+)
- **Ticket claim check** — `CLANCY_STATUS_IN_PROGRESS` transition on pickup provides partial protection, but a true claim check (optimistic lock / CAS) was deferred
- **Quality tracking** (rework cycle stats, CI pass rates) — deferred to v0.8.1+
