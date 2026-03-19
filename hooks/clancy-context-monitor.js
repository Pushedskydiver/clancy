#!/usr/bin/env node
// Clancy Context Monitor — PostToolUse hook.
// Reads context metrics from the bridge file written by clancy-statusline.js
// and injects warnings into Claude's conversation when context runs low.
//
// Context thresholds:
//   WARNING  (remaining <= 35%): wrap up analysis, move to implementation
//   CRITICAL (remaining <= 25%): commit current work, log to .clancy/progress.txt, stop
//
// Time guard:
//   Reads .clancy/lock.json for startedAt timestamp.
//   WARNING  (elapsed >= 80% of CLANCY_TIME_LIMIT): wrap up implementation
//   CRITICAL (elapsed >= 100% of CLANCY_TIME_LIMIT): stop and deliver
//
// Debounce: 5 tool uses between warnings; severity escalation bypasses debounce.
// Context and time guards use independent debounce counters.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const WARNING_THRESHOLD  = 35;
const CRITICAL_THRESHOLD = 25;
const STALE_SECONDS      = 60;
const DEBOUNCE_CALLS     = 5;
const DEFAULT_TIME_LIMIT = 30; // minutes

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const session = data.session_id;
    if (!session) process.exit(0);

    const messages = [];

    // ── Warn file (shared by context + time debounce) ───────────
    const warnPath = path.join(os.tmpdir(), `clancy-ctx-${session}-warned.json`);
    let warnData = {
      callsSinceWarn: 0,
      lastLevel: null,
      timeCallsSinceWarn: 0,
      timeLastLevel: null,
    };
    let firstContextWarn = true;
    let firstTimeWarn = true;

    if (fs.existsSync(warnPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(warnPath, 'utf8'));
        warnData = { ...warnData, ...existing };
        firstContextWarn = !existing.lastLevel;
        firstTimeWarn = !existing.timeLastLevel;
      } catch {}
    }

    // ── Context guard ───────────────────────────────────────────
    const bridgePath = path.join(os.tmpdir(), `clancy-ctx-${session}.json`);
    let contextFired = false;

    if (fs.existsSync(bridgePath)) {
      const metrics = JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
      const now = Math.floor(Date.now() / 1000);

      const isStale = metrics.timestamp && (now - metrics.timestamp) > STALE_SECONDS;
      if (!isStale) {
        const remaining = metrics.remaining_percentage;
        const usedPct   = metrics.used_pct;

        if (remaining <= WARNING_THRESHOLD) {
          warnData.callsSinceWarn = (warnData.callsSinceWarn || 0) + 1;

          const isCritical      = remaining <= CRITICAL_THRESHOLD;
          const currentLevel    = isCritical ? 'critical' : 'warning';
          const severityEscalated = currentLevel === 'critical' && warnData.lastLevel === 'warning';

          const shouldFire = firstContextWarn ||
            warnData.callsSinceWarn >= DEBOUNCE_CALLS ||
            severityEscalated;

          if (shouldFire) {
            warnData.callsSinceWarn = 0;
            warnData.lastLevel = currentLevel;
            contextFired = true;

            if (isCritical) {
              messages.push(
                `CONTEXT CRITICAL: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
                'Context is nearly exhausted. Stop reading files and wrap up immediately:\n' +
                '1. Commit whatever work is staged on the current feature branch\n' +
                '2. Append a WIP entry to .clancy/progress.txt: ' +
                'YYYY-MM-DD HH:MM | TICKET-KEY | Summary | WIP — context exhausted\n' +
                '3. Inform the user what was completed and what remains.\n' +
                'Do NOT start any new work.'
              );
            } else {
              messages.push(
                `CONTEXT WARNING: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
                'Context is getting limited. Stop exploring and move to implementation. ' +
                'Avoid reading additional files unless strictly necessary. ' +
                'Commit completed work as soon as it is ready.'
              );
            }
          }
        }
      }
    }

    // ── Time guard ──────────────────────────────────────────────
    const timeLimitEnv = process.env.CLANCY_TIME_LIMIT;
    const timeLimit = timeLimitEnv !== undefined ? Number(timeLimitEnv) : DEFAULT_TIME_LIMIT;

    if (timeLimit > 0) {
      // Look for lock.json in the working directory's .clancy/
      const cwd = data.cwd || process.cwd();
      const lockPath = path.join(cwd, '.clancy', 'lock.json');

      if (fs.existsSync(lockPath)) {
        try {
          const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
          const startedAt = new Date(lock.startedAt);

          if (!isNaN(startedAt.getTime())) {
            const elapsedMs = Date.now() - startedAt.getTime();
            const elapsedMin = Math.floor(elapsedMs / 60000);
            const limitMs = timeLimit * 60000;
            const pct = Math.floor((elapsedMs / limitMs) * 100);

            if (pct >= 80) {
              warnData.timeCallsSinceWarn = (warnData.timeCallsSinceWarn || 0) + 1;

              const isTimeCritical = pct >= 100;
              const currentTimeLevel = isTimeCritical ? 'critical' : 'warning';
              const timeSeverityEscalated =
                currentTimeLevel === 'critical' && warnData.timeLastLevel === 'warning';

              const shouldFireTime = firstTimeWarn ||
                warnData.timeCallsSinceWarn >= DEBOUNCE_CALLS ||
                timeSeverityEscalated;

              if (shouldFireTime) {
                warnData.timeCallsSinceWarn = 0;
                warnData.timeLastLevel = currentTimeLevel;

                if (isTimeCritical) {
                  messages.push(
                    `TIME CRITICAL: Time limit reached (${elapsedMin}min of ${timeLimit}min).\n` +
                    'STOP implementation immediately. Commit current work, push the branch,\n' +
                    'and create the PR with whatever is ready. Log a WIP entry if incomplete.'
                  );
                } else {
                  messages.push(
                    `TIME WARNING: Ticket implementation at ${elapsedMin}min of ${timeLimit}min limit (${pct}%).\n` +
                    'Wrap up implementation and prepare for delivery. Avoid starting new approaches.'
                  );
                }
              }
            }
          }
        } catch {}
      }
    }

    // ── Persist debounce state (only when a threshold was reached) ──
    if (messages.length > 0 || contextFired || warnData.callsSinceWarn > 0 || warnData.timeCallsSinceWarn > 0) {
      fs.writeFileSync(warnPath, JSON.stringify(warnData));
    }

    // ── Output ──────────────────────────────────────────────────
    if (messages.length === 0) process.exit(0);

    const output = {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: messages.join('\n'),
      },
    };

    process.stdout.write(JSON.stringify(output));
  } catch {
    process.exit(0);
  }
});
