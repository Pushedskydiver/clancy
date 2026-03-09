#!/usr/bin/env node
// Clancy Context Monitor — PostToolUse hook.
// Reads context metrics from the bridge file written by clancy-statusline.js
// and injects warnings into Claude's conversation when context runs low.
//
// Thresholds:
//   WARNING  (remaining <= 35%): wrap up analysis, move to implementation
//   CRITICAL (remaining <= 25%): commit current work, log to .clancy/progress.txt, stop
//
// Debounce: 5 tool uses between warnings; severity escalation bypasses debounce.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const WARNING_THRESHOLD  = 35;
const CRITICAL_THRESHOLD = 25;
const STALE_SECONDS      = 60;
const DEBOUNCE_CALLS     = 5;

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

    const bridgePath = path.join(os.tmpdir(), `clancy-ctx-${session}.json`);
    if (!fs.existsSync(bridgePath)) process.exit(0); // no statusline data yet

    const metrics = JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
    const now = Math.floor(Date.now() / 1000);

    // Ignore stale metrics (statusline may not have run this session)
    if (metrics.timestamp && (now - metrics.timestamp) > STALE_SECONDS) process.exit(0);

    const remaining = metrics.remaining_percentage;
    const usedPct   = metrics.used_pct;

    if (remaining > WARNING_THRESHOLD) process.exit(0);

    // Debounce
    const warnPath = path.join(os.tmpdir(), `clancy-ctx-${session}-warned.json`);
    let warnData = { callsSinceWarn: 0, lastLevel: null };
    let firstWarn = true;

    if (fs.existsSync(warnPath)) {
      try { warnData = JSON.parse(fs.readFileSync(warnPath, 'utf8')); firstWarn = false; } catch {}
    }

    warnData.callsSinceWarn = (warnData.callsSinceWarn || 0) + 1;

    const isCritical      = remaining <= CRITICAL_THRESHOLD;
    const currentLevel    = isCritical ? 'critical' : 'warning';
    const severityEscalated = currentLevel === 'critical' && warnData.lastLevel === 'warning';

    if (!firstWarn && warnData.callsSinceWarn < DEBOUNCE_CALLS && !severityEscalated) {
      fs.writeFileSync(warnPath, JSON.stringify(warnData));
      process.exit(0);
    }

    warnData.callsSinceWarn = 0;
    warnData.lastLevel = currentLevel;
    fs.writeFileSync(warnPath, JSON.stringify(warnData));

    let message;
    if (isCritical) {
      message =
        `CONTEXT CRITICAL: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
        'Context is nearly exhausted. Stop reading files and wrap up immediately:\n' +
        '1. Commit whatever work is staged on the current feature branch\n' +
        '2. Append a WIP entry to .clancy/progress.txt: ' +
        'YYYY-MM-DD HH:MM | TICKET-KEY | Summary | WIP — context exhausted\n' +
        '3. Inform the user what was completed and what remains.\n' +
        'Do NOT start any new work.';
    } else {
      message =
        `CONTEXT WARNING: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
        'Context is getting limited. Stop exploring and move to implementation. ' +
        'Avoid reading additional files unless strictly necessary. ' +
        'Commit completed work as soon as it is ready.';
    }

    const output = {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message,
      },
    };

    process.stdout.write(JSON.stringify(output));
  } catch {
    process.exit(0);
  }
});
