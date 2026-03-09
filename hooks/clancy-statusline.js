#!/usr/bin/env node
// Clancy Statusline hook — registered as the Claude Code statusline.
// Two jobs:
//   1. Write context metrics to a bridge file so the PostToolUse context
//      monitor can read them (the statusline is the only hook that receives
//      context_window data directly).
//   2. Output a statusline string showing context usage and update status.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = os.homedir();

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const session = data.session_id || '';
    const remaining = data.context_window?.remaining_percentage;

    // Write bridge file for the context monitor PostToolUse hook
    if (session && remaining != null) {
      try {
        const bridgePath = path.join(os.tmpdir(), `clancy-ctx-${session}.json`);
        // Claude Code reserves ~16.5% for autocompact buffer.
        // Normalise to show 100% at the usable limit (same as GSD).
        const AUTO_COMPACT_BUFFER_PCT = 16.5;
        const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
        const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
        fs.writeFileSync(bridgePath, JSON.stringify({
          session_id: session,
          remaining_percentage: remaining,
          used_pct: used,
          timestamp: Math.floor(Date.now() / 1000),
        }));
      } catch { /* bridge is best-effort */ }
    }

    // Build statusline output
    const parts = [];

    // Update available?
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
    const cacheFile = path.join(claudeDir, 'cache', 'clancy-update-check.json');
    try {
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cache.update_available) {
        parts.push('\x1b[33m⬆ /clancy:update\x1b[0m');
      }
    } catch { /* cache missing is normal */ }

    // Context bar
    if (remaining != null) {
      const AUTO_COMPACT_BUFFER_PCT = 16.5;
      const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
      const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
      const filled = Math.floor(used / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      let coloredBar;
      if (used < 50)      coloredBar = `\x1b[32m${bar} ${used}%\x1b[0m`;
      else if (used < 65) coloredBar = `\x1b[33m${bar} ${used}%\x1b[0m`;
      else if (used < 80) coloredBar = `\x1b[38;5;208m${bar} ${used}%\x1b[0m`;
      else                coloredBar = `\x1b[5;31m💀 ${bar} ${used}%\x1b[0m`;

      parts.push(`\x1b[2mClancy\x1b[0m ${coloredBar}`);
    } else {
      parts.push('\x1b[2mClancy\x1b[0m');
    }

    process.stdout.write(parts.join(' │ '));
  } catch {
    process.exit(0);
  }
});
