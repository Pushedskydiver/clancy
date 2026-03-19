# Reliable Autonomous Mode (v0.7.0) — Design Document

## Overview

v0.7.0 makes AFK mode production-grade. Today, Clancy's autonomous loop (`/clancy:run`) works but operates without safety nets: no verification that code actually passes tests before delivery, no recovery if a session crashes mid-ticket, no guard against runaway sessions burning tokens for hours on infeasible work, and no protection against destructive git commands when running with `--dangerously-skip-permissions`.

Every feature in this version addresses a specific failure mode observed in real AFK runs:

- **Verification gates** — code that fails tests gets delivered as a PR, wasting reviewer time. An agent-based Stop hook runs lint/test/typecheck before delivery and attempts self-healing when checks fail.
- **Safety hooks** — no visibility into token spend, no protection against destructive git operations, no time limit on individual tickets. Three hooks address these gaps.
- **Crash recovery** — if a session crashes mid-ticket, the next run starts fresh and picks up a new ticket, leaving orphaned branches and half-done work. Lock files and resume detection recover gracefully.

Inspired by GSD 1/2 verification gates, Claude Code's agent/prompt hook types, and Devin's self-healing retry loops.

---

## Features

### 1. Agent-Based Stop Hook (Verification Gate)

**Problem:** Claude finishes implementing a ticket and proceeds to delivery. If the code has lint errors, test failures, or type errors, the PR is created anyway. The reviewer catches issues that a machine could have caught first.

**How it works:**

The Stop hook fires when Claude signals it has finished working (the `Stop` event). It runs as a `type: "agent"` hook in Claude Code's settings — this means it gets its own agent context and can take actions (run commands, read files, fix code).

```
Claude finishes implementation
       |
       v
  Stop event fires
       |
       v
  Verification agent activates:
    1. Read package.json scripts to detect available checks
    2. Run detected checks (lint, test, typecheck)
    3. If ALL pass → approve stop (implementation complete)
    4. If ANY fail → deny stop with fix instructions
       |
       v
  Claude receives denial + error output
       |
       v
  Claude attempts fix (self-healing cycle 1)
       |
       v
  Stop event fires again → verification agent re-runs
       |
       v
  Repeat up to CLANCY_FIX_RETRIES times
       |
       v
  If still failing after max retries:
    → Approve stop (let delivery proceed)
    → Inject warning into PR body: "⚠ Verification failed: {details}"
```

**Auto-detection of check commands:**

The agent reads `package.json` and detects available scripts:

| Script name pattern | Check type |
|---|---|
| `lint`, `eslint` | Lint |
| `test`, `vitest`, `jest` | Test |
| `typecheck`, `tsc`, `check-types` | Typecheck |

If none are found, the agent tries common commands directly (`npx eslint .`, `npx tsc --noEmit`). If no checks can be detected, the hook approves the stop (no verification available).

**Override:** Users can set `CLANCY_VERIFY_COMMANDS` to explicitly define which commands to run:

```
CLANCY_VERIFY_COMMANDS=npm run lint,npm test,npm run typecheck
```

**Edge cases:**

- **Tests require environment variables or services:** The verification agent runs in the same environment as Claude. If tests need a database or API key, they will fail. The self-healing loop will not fix infrastructure issues — after max retries, the PR is created with a warning. Users should configure `CLANCY_VERIFY_COMMANDS` to exclude integration tests.
- **Tests are slow (>5 minutes):** The Stop hook has no independent timeout, but the time guard (see below) may abort the ticket. Slow test suites should be excluded via `CLANCY_VERIFY_COMMANDS`.
- **Flaky tests:** A test that fails intermittently will trigger a fix cycle. If the retry passes on the second run, the fix cycle succeeds. Persistent flakes will exhaust retries and deliver with a warning — this is correct behaviour (flaky tests should be fixed, not silently ignored).
- **Stop hook fires during non-implementation work:** The hook should only run verification during `/clancy:once` or `/clancy:run` invocations, not during `/clancy:plan` or `/clancy:brief`. Detection: check for the presence of `.clancy/lock.json` (see crash recovery below) or `CLANCY_ONCE_ACTIVE` env var set by the orchestrator.
- **No package.json:** Skip verification entirely. The project may not be a Node.js project. Future versions could detect Makefile, Cargo.toml, pyproject.toml, etc.

**Failure mode:** Best-effort. If the verification agent itself crashes, the stop is approved (fail-open). The hook must never prevent delivery of working code because the verification infrastructure broke.

### 2. Self-Healing Retry

Self-healing is integrated into the verification gate above, not a separate feature. When verification fails:

1. The Stop hook denies the stop and returns the error output as `additionalContext`.
2. Claude receives the denial and sees the test/lint/typecheck errors.
3. Claude attempts to fix the issues (it has full agent capabilities — read files, edit code, run commands).
4. Claude signals stop again, triggering another verification cycle.

**Retry budget:**

- Default: `CLANCY_FIX_RETRIES=2` (up to 2 fix attempts after initial failure, so 3 total verification runs).
- Set to `0` to disable self-healing (verify once, deliver regardless).
- Maximum: `5` (clamped — more retries rarely help and burn tokens).

**Escalation strategy (inspired by GSD 1):**

| Retry | Strategy |
|---|---|
| 1 | Fix the specific errors reported by lint/test/typecheck |
| 2 | If the same errors persist, consider reverting the problematic change and taking a different approach |
| 3+ | Broader fix — revert to last known working state if possible |

The escalation hints are included in the Stop hook's denial message to guide Claude's fix strategy.

**What happens when self-healing fails:**

The PR is created with a warning section in the body:

```markdown
## ⚠ Verification Warning

The following checks failed after 2 fix attempts:

- `npm test` — 3 failing tests (see output below)
- `npm run lint` — 2 lint errors

<details>
<summary>Last verification output</summary>

[truncated output from last failed run]

</details>

This PR may need manual fixes before merging.
```

### 3. PostCompact Hook

**Problem:** When Claude's context window fills up, Claude Code compacts the conversation. This loses the current ticket key, branch name, and requirements. Claude then operates without context about what it was implementing, leading to confused or incomplete work.

**How it works:**

The PostCompact hook fires after context compaction. It uses `type: "command"` — a CommonJS script that reads the lock file and returns `additionalContext` via JSON output. PostCompact is a **non-blocking** event (cannot deny/block, but can inject context).

The hook reads the current ticket context from `.clancy/lock.json` (see crash recovery below) and injects it:

```
Context compaction occurs
       |
       v
  PostCompact event fires
       |
       v
  Hook reads .clancy/lock.json:
    {
      "pid": 12345,
      "ticketKey": "PROJ-101",
      "ticketTitle": "Add login form",
      "ticketBranch": "feature/proj-101",
      "targetBranch": "epic/proj-100",
      "parentKey": "PROJ-100",
      "description": "Implement the login form with email/password...",
      "startedAt": "2026-03-19T14:30:00Z"
    }
       |
       v
  Injects prompt:
    "You are implementing ticket [PROJ-101] Add login form.
     Branch: feature/proj-101 targeting epic/proj-100.
     Requirements: {description}
     Continue your implementation. Do not start over."
```

**Implementation:** This is a `type: "command"` hook (CommonJS script in `hooks/`) that reads stdin for the PostCompact event data, reads the lock file, and outputs a `hookSpecificOutput.additionalContext` message — same pattern as `clancy-context-monitor.js`.

**Edge cases:**

- **No lock file:** The hook exits silently. Compaction may happen outside of a Clancy run (e.g., during `/clancy:map-codebase`). No injection needed.
- **Lock file from a dead process:** The hook still injects the context — the ticket info is still useful even if the process that created the lock file crashed. The next run's startup will clean up the stale lock.
- **Description too long:** Truncate to 2000 characters to avoid consuming too much of the freshly compacted context.

**Failure mode:** Best-effort. If the hook crashes or the lock file is unreadable, no context is injected. Claude continues without the hint — suboptimal but not catastrophic.

### 4. Cost Tracker

**Problem:** No visibility into how many tokens each ticket consumes. Users running AFK overnight discover unexpectedly high bills with no way to attribute costs to specific tickets.

**How it works:**

**Note:** Claude Code's `Notification` events do NOT contain token usage data (they fire for permission prompts, idle prompts, etc.). Detailed per-call token tracking is deferred to a post-v0.7.0 patch when better APIs are available.

For v0.7.0, the cost tracker uses a **duration-based approach**: the orchestrator (`once.ts`) logs a cost entry after each ticket completes, using the lock file's `startedAt` timestamp to calculate duration and estimate tokens.

**Log format:**

```
2026-03-19T14:48:00Z | PROJ-101 | 18min | ~120000 tokens (estimated)
2026-03-19T15:13:00Z | PROJ-102 | 25min | ~165000 tokens (estimated)
```

Token estimates use a configurable rate: `CLANCY_TOKEN_RATE` tokens per minute (default: `6600` — rough average based on typical Claude Code sessions). This is a coarse estimate for budgeting, not a precise measurement.

**Budget alert:**

`CLANCY_COST_LIMIT` sets a per-ticket time budget in minutes (since we can't measure actual tokens). When elapsed time exceeds this limit, the time guard (see below) handles the warning. The cost tracker logs the overage.

**Default:** No limit (`CLANCY_COST_LIMIT` unset). Duration logging still occurs — the log is always written after each ticket.

**Edge cases:**

- **costs.log grows large:** The hook appends only. Users can truncate or rotate the file. A future `/clancy:logs` enhancement could summarize costs.
- **Clock changes during a run:** Duration calculation uses monotonic-ish timestamps (Date.now). Minor clock skew is acceptable.

**Failure mode:** Best-effort. Never crashes, never blocks.

### 5. Branch Guard

**Problem:** When running with `--dangerously-skip-permissions`, Claude can execute any git command including force pushes, pushes to protected branches, and destructive resets. A single bad command can destroy shared history.

**How it works:**

A `PreToolUse` hook (same pattern as `clancy-credential-guard.js`) that intercepts `Bash` tool calls. It parses the command string for dangerous git operations and blocks them.

**Blocked patterns:**

| Pattern | Why |
|---|---|
| `git push --force` / `git push -f` (without `--force-with-lease`) | Destroys remote history |
| `git push` to `main`, `master`, `develop`, or `CLANCY_BASE_BRANCH` | Direct push to protected branches |
| `git reset --hard` | Destroys uncommitted work |
| `git clean -f` / `git clean -fd` | Deletes untracked files irrecoverably |
| `git checkout -- .` / `git restore .` | Discards all uncommitted changes |
| `git branch -D` on the current branch | Deletes the branch you are on |

**Implementation:**

```javascript
// PreToolUse hook — same structure as clancy-credential-guard.js
// Input: { tool_name, tool_input: { command } }
// Output: { decision: "approve" } or { decision: "block", reason: "..." }

const input = JSON.parse(readInput());
if (input.tool_name !== 'Bash') {
  output({ decision: 'approve' });
  exit();
}

const cmd = input.tool_input.command || '';
// Check each pattern...
```

**Allowlist:** `git push --force-with-lease` is allowed — it is the safe version of force push that checks the remote ref before overwriting.

**Configuration:** `CLANCY_BRANCH_GUARD=false` disables the hook entirely for users who need unrestricted git access. Default: enabled.

**Edge cases:**

- **Piped commands:** The hook scans the full command string, so `echo foo | git push --force` is caught.
- **Aliases:** `git push -f` (short flag) is caught. Custom git aliases are not — this is a best-effort guard.
- **Legitimate force push needed:** The user can disable the hook via env var, or run the command manually outside Clancy.

**Failure mode:** Best-effort. On error, approves the command (fail-open). The hook must never block legitimate git operations because of a parsing bug.

### 6. Time Guard

**Problem:** Claude sometimes gets stuck in a loop on a difficult ticket — repeatedly trying approaches that do not work, burning tokens and wall-clock time indefinitely. In AFK mode, nobody is watching to intervene.

**How it works:**

The time guard is implemented inside the once orchestrator (`once.ts`), not as a hook. Hooks do not have persistent state across tool calls in the way needed for time tracking.

The orchestrator records the start time (already does this — `const startTime = Date.now()`) and passes it to the Claude session. A `PostToolUse` hook (extending the existing `clancy-context-monitor.js`) checks elapsed time after each tool call:

```
PostToolUse fires
       |
       v
  Read .clancy/lock.json for startedAt timestamp
       |
       v
  Elapsed = now - startedAt
  Limit = CLANCY_TIME_LIMIT (default 30 min)
       |
       v
  Elapsed >= 80% of limit?
    → Inject warning: "⚠ Time limit: 80% elapsed ({elapsed}/{limit}).
       Wrap up implementation and prepare for delivery."
       |
       v
  Elapsed >= 100% of limit?
    → Inject critical: "⏰ Time limit reached ({elapsed}/{limit}).
       STOP immediately. Commit current work, push the branch,
       and log a WIP entry to progress.txt."
```

**After time limit:** The orchestrator itself does NOT force-kill the Claude session. The warning/critical messages instruct Claude to stop. If Claude ignores the critical warning and continues, the context monitor's existing CRITICAL threshold (25% context remaining) will eventually force a stop.

**Default:** `CLANCY_TIME_LIMIT=30` (minutes). Set to `0` to disable. Maximum: `120` (2 hours — clamped).

**Edge cases:**

- **Rework tickets:** Same time limit applies. Rework should be faster than initial implementation — if it hits the time limit, the ticket likely needs human intervention.
- **Time limit reached during self-healing retry:** The time warning takes priority. Claude should stop fixing and deliver what it has.
- **Multiple tool calls in rapid succession:** The debounce from `clancy-context-monitor.js` applies — warnings are not repeated on every tool call.

**Failure mode:** Best-effort. If the hook fails to read the lock file or compute elapsed time, no warning is injected. The session continues without time limits.

### 7. Lock File

**Problem:** If a Clancy session crashes (machine reboot, network loss, OOM kill), the next run has no idea a ticket was in progress. It picks up a new ticket, leaving an orphaned feature branch with uncommitted work.

**How it works:**

The orchestrator writes `.clancy/lock.json` at ticket pickup (step 10 in `once.ts`, after branch creation) and deletes it after delivery (step 13) or on error (catch block).

**Lock file format:**

```json
{
  "pid": 12345,
  "ticketKey": "PROJ-101",
  "ticketTitle": "Add login form",
  "ticketBranch": "feature/proj-101",
  "targetBranch": "epic/proj-100",
  "parentKey": "PROJ-100",
  "description": "Implement the login form with email/password...",
  "startedAt": "2026-03-19T14:30:00Z"
}
```

**Startup check (in `once.ts`, before step 1):**

```
Run starts
       |
       v
  Does .clancy/lock.json exist?
       |
  +----+----+
  No        Yes
  |         |
  v         v
Continue  Is the PID still alive?
            |
       +----+----+
       Yes       No
       |         |
       v         v
     ABORT:    Stale lock — clean up:
     "Another   1. Delete lock.json
      Clancy     2. Check for resume (see below)
      session    3. Continue
      is running
      (PID 12345)"
```

**PID check:** `process.kill(pid, 0)` — sends signal 0 (no-op) to test if the process exists. Cross-platform (works on macOS, Linux, Windows).

**Edge cases:**

- **PID reuse:** After a crash, the OS may assign the same PID to a different process. The lock file includes `startedAt` — if the PID is alive but the lock is older than 24 hours, treat it as stale.
- **Lock file corruption:** If JSON parsing fails, delete the file and continue.
- **Multiple Clancy instances (worktrees):** Each worktree has its own `.clancy/` directory, so lock files do not conflict.
- **AFK runner spawns once.js:** The AFK runner (`afk.ts`) spawns `clancy-once.js` as a child process. The once script writes the lock file. If the AFK runner is killed, the once child also dies, leaving a stale lock. Next run detects dead PID and cleans up.

**Failure mode:** If the lock file cannot be written (disk full, permissions), the run continues without crash protection. Log a warning.

### 8. Resume Detection

**Problem:** After a crash, the user (or AFK loop) runs Clancy again. A feature branch with uncommitted or unpushed work exists from the crashed session. Clancy should offer to resume rather than abandoning that work.

**How it works:**

After cleaning up a stale lock file, the orchestrator checks for the ticket branch:

```
Stale lock cleaned up (PROJ-101, branch: feature/proj-101)
       |
       v
  Does feature/proj-101 exist locally?
       |
  +----+----+
  No        Yes
  |         |
  v         v
Continue  Check branch state:
(pick       |
 new        +-- Has uncommitted changes?
 ticket)    +-- Has unpushed commits?
            +-- Has no changes at all?
            |
            v
        +-----------+------------------+-----------------+
        Uncommitted   Unpushed only     No changes
        changes       (clean)           (already pushed)
        |             |                 |
        v             v                 v
      Resume:       Resume:           Skip resume
      "Found         "Found            (branch exists
       uncommitted    unpushed work     but nothing to
       work on        on feature/       recover)
       feature/       proj-101.
       proj-101.      Resuming
       Resuming       delivery."
       — committing   Push + create PR
       + delivering."
```

**In AFK mode:** Resume is automatic — no interactive prompt. The orchestrator commits any uncommitted changes with message `fix(PROJ-101): resume after crash`, pushes, and creates the PR.

**In interactive mode (`/clancy:once`):** The orchestrator prints the resume option and waits for confirmation. The user can choose to resume or abandon (delete the branch and start fresh).

**Edge cases:**

- **Branch exists but ticket was already delivered:** Check progress.txt for a `PR_CREATED` or `DONE` entry for this ticket key. If found, skip resume.
- **Branch has merge conflicts:** The resume commit will fail. Log a warning and let the user resolve manually.
- **Multiple stale branches:** Only the branch from the lock file is considered for resume. Other orphaned branches are not touched.

**Failure mode:** If resume detection fails (git errors, etc.), skip it and proceed to pick a new ticket. Log a warning about the orphaned branch.

### 9. AFK Session Report

**Problem:** After an overnight AFK run completes N tickets, the user has no summary. They must read progress.txt and individual PRs to understand what happened.

**How it works:**

After the AFK loop completes (all iterations done or stop condition hit), `afk.ts` generates a session report:

```
AFK loop ends (completed or stopped)
       |
       v
  Read progress.txt entries from this session
  (entries with timestamp >= loopStart)
       |
       v
  Read .clancy/costs.log entries from this session
       |
       v
  Generate .clancy/session-report.md:
    # AFK Session Report — 2026-03-19

    ## Summary
    - Tickets completed: 3
    - Tickets failed: 1
    - Total duration: 1h 42m
    - Estimated token usage: 450,000

    ## Tickets

    ### ✓ PROJ-101 — Add login form
    - Duration: 18m
    - Tokens: ~120,000
    - PR: #42 (feature/proj-101 → epic/proj-100)
    - Verification: passed (lint, test, typecheck)

    ### ✓ PROJ-102 — Password reset flow
    - Duration: 25m
    - Tokens: ~95,000
    - PR: #43 (feature/proj-102 → epic/proj-100)
    - Verification: passed after 1 fix cycle

    ### ✓ PROJ-103 — Email notifications
    - Duration: 32m
    - Tokens: ~140,000
    - PR: #44 (feature/proj-103 → main)
    - Verification: passed

    ### ✗ PROJ-104 — OAuth2 integration
    - Duration: 27m
    - Tokens: ~95,000
    - Status: SKIPPED — infeasible
    - Reason: Requires third-party API credentials not configured

    ## Next Steps
    - Review PRs #42, #43, #44
    - PROJ-104 needs manual intervention
       |
       v
  Print summary to stdout
  Send to webhook (if CLANCY_NOTIFY_WEBHOOK configured)
```

**The report is overwritten each AFK run** — it reflects the most recent session only. Historical data lives in progress.txt and costs.log.

**Edge cases:**

- **No tickets completed:** Report still generated with "0 tickets completed" and the stop reason.
- **Costs.log not available:** Token estimates omitted from the report.
- **Webhook notification:** The full report is too long for most webhooks. Send a one-line summary: `"Clancy AFK: 3 completed, 1 failed in 1h 42m. Report: .clancy/session-report.md"`.

**Failure mode:** Best-effort. If the report cannot be written, print the summary to stdout only.

---

## Hook Architecture

### New Hooks

| Hook | Event | Type | File | Blocking? |
|---|---|---|---|---|
| Verification gate | `Stop` | `agent` | Configured in `.claude/settings.json`, prompt in `src/agents/verification-gate.md` | **Yes** — denies stop on failure (up to N retries). Checks `.clancy/lock.json` to skip non-Clancy runs. Uses `.clancy/verify-attempt.txt` for retry tracking. |
| PostCompact context | `PostCompact` | `command` | `hooks/clancy-post-compact.js` | No — injects context via `additionalContext`, never blocks (PostCompact is non-blocking event) |
| Branch guard | `PreToolUse` | `command` | `hooks/clancy-branch-guard.js` | **Yes** — blocks dangerous git commands |
| Time guard | `PostToolUse` | Integrated into `hooks/clancy-context-monitor.js` | No — warns only, never blocks |

### Existing Hooks (Modified)

| Hook | Change |
|---|---|
| `clancy-context-monitor.js` | Add time guard check. Read `.clancy/lock.json` for `startedAt`. Emit time warnings alongside existing context warnings. Time warning uses separate debounce counter from context warning. |
| `clancy-check-update.js` | No changes. |
| `clancy-credential-guard.js` | No changes. |
| `clancy-statusline.js` | No changes. |

### Hook Type Distinction

**File-based hooks** (`hooks/` directory): CommonJS scripts run as child processes. Used for `PreToolUse`, `PostToolUse`, `SessionStart`, `PostCompact`, `Notification` events. These are installed by the Clancy installer into `.claude/hooks/` and configured in `.claude/settings.json` with `"type": "command"`.

**Agent hooks** (settings.json only): Configured in `.claude/settings.json` with `"type": "agent"` and a prompt. The prompt lives in `src/agents/` and is referenced by path. Used for the `Stop` event verification gate — it needs agent capabilities (run commands, edit files) that command hooks cannot provide.

**Settings.json hook configuration example:**

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "agent",
            "prompt": "You are a verification agent for Clancy. First, check if .clancy/lock.json exists — if not, respond with {\"decision\": \"allow\"} (not a Clancy run). If it exists, read package.json to detect lint/test/typecheck scripts. Run each detected check. Read .clancy/verify-attempt.txt for the current attempt number. If all checks pass, respond with {\"decision\": \"allow\"}. If any fail, increment the attempt file and respond with {\"decision\": \"block\", \"reason\": \"Verification failed: [errors]. Fix attempt N of M.\"}.",
            "timeout": 120
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/clancy-post-compact.js"
          }
        ]
      }
    ]
  }
}
```

**No `condition` syntax** — Claude Code does not support conditions on hooks. The verification agent checks for `.clancy/lock.json` internally to determine if it's in a Clancy run. If no lock file exists, it immediately allows the stop. The `stop_hook_active` field in hook input prevents infinite loops.

---

## File System Artifacts

### New Files

| Path | Purpose | Format | Created by | Lifetime |
|---|---|---|---|---|
| `.clancy/lock.json` | Active ticket lock | JSON (see format above) | `once.ts` at ticket pickup | Deleted after delivery or on next startup (stale) |
| `.clancy/verify-attempt.txt` | Verification retry counter | Plain text integer | `verification-gate.md` agent | Deleted by `once.ts` after delivery or lock cleanup |
| `.clancy/costs.log` | Duration + estimated token log | Pipe-delimited text, one line per ticket | `once.ts` after delivery | Persistent, append-only |
| `.clancy/session-report.md` | AFK session summary | Markdown | `afk.ts` at loop end | Overwritten each AFK session |

### New Hook Files

| Path | Purpose |
|---|---|
| `hooks/clancy-post-compact.js` | PostCompact context injection |
| `hooks/clancy-branch-guard.js` | PreToolUse git safety guard |
| `src/agents/verification-gate.md` | Stop hook agent prompt |

### Modified Files

| Path | Change |
|---|---|
| `hooks/clancy-context-monitor.js` | Add time guard logic |

---

## Env Vars

| Variable | Default | Description |
|---|---|---|
| `CLANCY_FIX_RETRIES` | `2` | Max self-healing fix attempts after verification failure. Range: 0–5. |
| `CLANCY_VERIFY_COMMANDS` | Auto-detect | Comma-separated commands for verification gate. Overrides auto-detection. |
| `CLANCY_TOKEN_RATE` | `6600` | Estimated tokens per minute for cost logging. Adjust based on your usage patterns. |
| `CLANCY_TIME_LIMIT` | `30` | Per-ticket time limit in minutes. Warn at 80%, critical at 100%. Range: 0–120. `0` disables. |
| `CLANCY_BRANCH_GUARD` | `true` | Enable/disable branch guard hook. Set `false` to allow all git operations. |

All env vars are defined in `.clancy/.env` and validated by the Zod schema in `src/schemas/env.ts`.

**Internal env vars** (set by the orchestrator, not user-configured):

| Variable | Purpose |
|---|---|
| `CLANCY_ONCE_ACTIVE` | Set to `1` by `once.ts` during a run. Used by the Stop hook condition to avoid running verification outside of ticket implementation. |

---

## Execution Plan

### Prerequisites

All of the following must be shipped before v0.7.0:

- v0.6.0 Strategist role (includes `CLANCY_MODE`, blocker-aware pickup, HITL/AFK filtering)
- `.clancy/lock.json` is a new concept — no migration needed

### Wave 1 — Foundation (3 parallel agents)

| Agent | Scope | Files | Tests |
|---|---|---|---|
| **1** | Lock file + schema + types | `src/schemas/env.ts` (add `CLANCY_FIX_RETRIES`, `CLANCY_VERIFY_COMMANDS`, `CLANCY_COST_LIMIT`, `CLANCY_TIME_LIMIT`, `CLANCY_BRANCH_GUARD`), `src/types/remote.ts` (add `COST_LIMIT`, `TIME_LIMIT`, `RESUMED` to ProgressStatus), `src/scripts/once/lock/lock.ts` (NEW — `writeLock`, `readLock`, `deleteLock`, `isLockStale`, `isPidAlive`) | `lock.test.ts`, `env-schema.test.ts` |
| **2** | Branch guard hook | `hooks/clancy-branch-guard.js` (NEW) | `clancy-branch-guard.test.ts` (co-located in hooks/) |
| **3** | Cost logging in once.ts | Duration + estimated token logging after delivery in `once.ts`, writing to `.clancy/costs.log` | `once.test.ts` (extend) |

### Wave 1 Review

- Do the new env vars compile in the Zod schema?
- Does the lock module handle all PID edge cases (dead process, PID reuse, corrupt JSON)?
- Does the branch guard catch all blocked patterns? Test with piped commands, short flags, `--force-with-lease` allowlist.
- Does the cost tracker handle missing lock file gracefully?
- `npm test && npm run typecheck && npm run lint`

### Wave 2 — Core Features (3 parallel agents)

| Agent | Scope | Files | Tests |
|---|---|---|---|
| **4** | PostCompact hook | `hooks/clancy-post-compact.js` (NEW) | `clancy-post-compact.test.ts` |
| **5** | Time guard (extend context monitor) | `hooks/clancy-context-monitor.js` (add time guard logic, separate debounce) | `clancy-context-monitor.test.ts` (extend existing) |
| **6** | Verification gate agent prompt | `src/agents/verification-gate.md` (NEW) | — (agent prompt, no unit test) |

### Wave 2 Review

- Does PostCompact hook read lock.json correctly? Handle missing file? Truncate long descriptions?
- Does time guard use a separate debounce counter from context warnings? Does it read `startedAt` from lock.json?
- Does the verification gate prompt include auto-detection logic, retry escalation hints, and the fail-open fallback?
- `npm test && npm run typecheck && npm run lint`

### Wave 3 — Orchestrator Integration (2 agents)

| Agent | Scope | Files | Tests |
|---|---|---|---|
| **7** | once.ts integration — lock file, resume detection, CLANCY_ONCE_ACTIVE | `src/scripts/once/once.ts` (add lock write/delete, startup check, resume detection, set `CLANCY_ONCE_ACTIVE` env var), `src/scripts/once/resume/resume.ts` (NEW — `detectResume`, `executeResume`) | `once.test.ts`, `resume.test.ts` |
| **8** | afk.ts integration — session report, cost summary | `src/scripts/afk/afk.ts` (add session report generation after loop), `src/scripts/afk/report/report.ts` (NEW — `generateSessionReport`) | `afk.test.ts`, `report.test.ts` |

### Wave 3 Review

- Does once.ts write the lock file AFTER branch creation (not before — the branch name must be known)?
- Does once.ts delete the lock file in ALL exit paths (success, error, early return)?
- Does resume detection handle: (a) branch with uncommitted changes, (b) branch with unpushed commits, (c) already-delivered ticket?
- Does `CLANCY_ONCE_ACTIVE` get set before Claude invocation and unset after?
- Does the session report handle zero completed tickets?
- Does the AFK session report include token estimates from costs.log?
- `npm test && npm run typecheck && npm run lint`

### Wave 4 — Integration (3 parallel agents)

| Agent | Scope | Files | Tests |
|---|---|---|---|
| **9** | Installer + settings + scaffold | `src/installer/install.ts` (install new hooks, configure Stop hook in settings.json), `src/roles/setup/workflows/init.md` (add new env vars to init prompts), `src/roles/setup/workflows/settings.md` (add new env vars to settings), `src/roles/setup/workflows/scaffold.md` (add new env vars to .env.example) | — |
| **10** | PR body integration — verification warnings | `src/scripts/shared/pull-request/pr-body/pr-body.ts` (add optional verification warning section), `src/scripts/once/deliver/deliver.ts` (pass verification result to PR body builder) | `pr-body.test.ts` |
| **11** | Documentation | `docs/roles/IMPLEMENTER.md`, `docs/guides/CONFIGURATION.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `CHANGELOG.md`, `README.md`, `package.json`, `package-lock.json` | — |

### Wave 4 Review — Final

- Are all new hooks installed by the installer?
- Is the Stop hook configured in settings.json with the correct condition?
- Are all new env vars in init, settings, scaffold, and the configuration guide?
- Does the PR body show verification warnings correctly?
- Are all new files documented in ARCHITECTURE.md and CLAUDE.md?
- Test count badge updated in README?
- Version bump + CHANGELOG entry present?
- `npm test && npm run typecheck && npm run lint`

---

## Risks (ordered by severity)

1. **Stop hook agent reliability** — The `type: "agent"` hook is a new Claude Code feature. If the agent fails to run commands correctly (e.g., cannot invoke `npm test`), verification is ineffective. Mitigation: fail-open design + thorough testing of the agent prompt. The `CLANCY_VERIFY_COMMANDS` override gives users an escape hatch.

2. **Self-healing loop burns tokens** — Each fix retry is a full agent cycle. With slow tests and 2 retries, a single ticket could consume 3x the normal token budget. Mitigation: time guard provides an outer bound; `CLANCY_FIX_RETRIES=0` disables retries; cost tracker gives visibility.

3. **PostCompact event availability** — `PostCompact` is a newer Claude Code hook event. If a user's Claude Code version does not support it, the hook silently does nothing. Mitigation: the hook is purely additive — Clancy worked without it before v0.7.0.

4. **Lock file not deleted on crash** — The entire point of the lock file is crash detection, but if the process is killed between writing the lock and starting work, the lock exists but no branch was created. Mitigation: resume detection checks for the branch — if it does not exist, the lock is cleaned up without resume.

5. **Branch guard false positives** — Regex-based command parsing cannot handle all shell edge cases (variables, subshells, heredocs). A legitimate command might be blocked, or a destructive command might slip through. Mitigation: fail-open on parse errors; `CLANCY_BRANCH_GUARD=false` escape hatch.

6. **Time guard relies on Claude cooperation** — The time guard injects a warning but cannot force Claude to stop. If Claude ignores the warning, the session continues. Mitigation: context exhaustion (existing context monitor) provides a hard stop eventually; the AFK runner's iteration count provides an outer bound.

7. **Duration-based cost estimates are coarse** — The token-per-minute rate is a rough average. Actual usage varies widely by task complexity (research-heavy tickets use more tokens per minute than simple fixes). Mitigation: the rate is configurable via `CLANCY_TOKEN_RATE`; detailed tracking deferred to when Claude Code exposes actual token data.

8. **Session report accuracy** — The report relies on progress.txt timestamps to identify entries from the current session. If the system clock changes during a run, entries may be missed or duplicated. Mitigation: use a session ID (from lock file) rather than timestamps if available.

---

## Resolved Questions (from Claude Code API research + DA review)

1. **Stop hook `condition` syntax** — **No native condition syntax.** The agent hook must check context internally by reading `.clancy/lock.json`. If no lock file exists, the hook approves the stop immediately (not in a Clancy run). The `stop_hook_active` field in hook input prevents infinite loops.

2. **Notification event payload** — **Does NOT contain token usage data.** Notification events fire for `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` only. Cost tracker needs an alternative approach: read Claude Code's `~/.claude/projects/*/session.jsonl` files, or use the `ccusage` CLI tool, or track estimated tokens from tool call input/output sizes. **Decision: defer detailed cost tracking to a post-v0.7.0 patch. For v0.7.0, implement a simple duration-based cost estimate (tokens ≈ duration × rate) using the lock file's `startedAt` timestamp. Still log to costs.log for visibility.**

3. **Agent hook retry state** — **No built-in retry counter.** Use `.clancy/verify-attempt.txt` (simple integer file) to track attempts. The verification agent reads it, increments, and writes it back. Lock file cleanup (once.ts) also deletes this file. Added to file system artifacts table.

4. **Agent hook environment** — **Yes, verified.** Agent hooks run in the same working directory (`cwd` field in hook input). They have full tool access: Read, Edit, Write, Glob, Grep, Bash. Default timeout: 60s (configurable). Max 50 tool-use turns. Set timeout to 120s+ for test suites.

5. **Resume in AFK mode** — **Auto-resume with board status check.** Before resuming, the orchestrator checks the ticket's status on the board. If it was reassigned, moved to Done/Cancelled, or is now blocked, skip resume and pick a new ticket. This prevents resuming stale work.

6. **Cost tracker granularity** — **Duration-based for v0.7.0** (see Q2 resolution). Log one entry per ticket completion, not per notification. Format: `timestamp | key | duration_min | estimated_tokens`. Detailed per-call tracking deferred.

7. **Verification gate for non-Node projects** — **Defer to v0.8.0+.** The `CLANCY_VERIFY_COMMANDS` override is sufficient for non-Node projects. Auto-detection for Makefile/Cargo.toml/pyproject.toml adds scope without clear demand.

## Remaining Open Questions

1. **PID reuse threshold** — The 24-hour threshold for stale PID detection is arbitrary. PIDs can be reused in minutes on busy systems. Consider storing a UUID in the lock file and verifying it instead of relying on PID + timestamp heuristics.

2. **Lock file description sensitivity** — The lock file stores the full ticket description, which may contain PII or security details. Consider truncating to title only, or omitting description and re-fetching from the board during resume.

3. **Session report overwriting** — The current design overwrites the report each AFK run. Consider timestamped filenames (`session-report-2026-03-19T14-30.md`) so multiple reports survive.
