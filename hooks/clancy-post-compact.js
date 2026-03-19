#!/usr/bin/env node
// Clancy PostCompact Hook — re-injects ticket context after context compaction.
// Reads .clancy/lock.json for current ticket info. If no lock file exists
// (not in a Clancy run), exits silently.
//
// PostCompact is a non-blocking event — this hook injects additionalContext
// but cannot prevent compaction.

'use strict';

const fs = require('fs');
const path = require('path');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const cwd = data.cwd || process.cwd();

    // Read lock file for ticket context
    const lockPath = path.join(cwd, '.clancy', 'lock.json');
    if (!fs.existsSync(lockPath)) process.exit(0); // Not in a Clancy run

    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

    // Validate minimum required fields — skip if lock is malformed
    if (!lock.ticketKey || !lock.ticketBranch) process.exit(0);

    // Truncate description to 2000 chars to avoid consuming too much fresh context
    const desc = (lock.description || '').slice(0, 2000);

    const context = [
      `CONTEXT RESTORED: You are implementing ticket [${lock.ticketKey}] ${lock.ticketTitle || 'Unknown'}.`,
      `Branch: ${lock.ticketBranch} targeting ${lock.targetBranch || 'main'}.`,
      lock.parentKey && lock.parentKey !== 'none' ? `Parent: ${lock.parentKey}.` : '',
      desc ? `Requirements: ${desc}` : '',
      'Continue your implementation. Do not start over.',
    ].filter(Boolean).join('\n');

    process.stdout.write(JSON.stringify({
      additionalContext: context,
    }));
  } catch {
    process.exit(0); // Best-effort — never crash
  }
});
