#!/usr/bin/env node
// Clancy Drift Detector — PostToolUse hook (debounced, once per session).
// Compares .clancy/version.json against the installed chief-clancy package
// version. If mismatched, warns that Clancy files are outdated.
//
// Debounce: writes a session flag to os.tmpdir() (same pattern as context-monitor).
// Best-effort — never crashes, exit 0 on any error.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Compare two semver-like version strings.
 * Returns true if they differ.
 */
function versionsDiffer(a, b) {
  if (!a || !b) return false;
  return a.trim() !== b.trim();
}

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

    // Debounce — only check once per session
    const flagPath = path.join(os.tmpdir(), `clancy-drift-${session}`);
    if (fs.existsSync(flagPath)) process.exit(0);

    // Write the flag immediately to prevent future checks this session
    try { fs.writeFileSync(flagPath, '1'); } catch { /* best-effort */ }

    const cwd = data.cwd || process.cwd();

    // Read .clancy/version.json (written by installer)
    const versionJsonPath = path.join(cwd, '.clancy', 'version.json');
    if (!fs.existsSync(versionJsonPath)) process.exit(0);

    let versionData;
    try {
      versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
    } catch {
      process.exit(0);
    }

    const installedVersion = versionData.version;
    if (!installedVersion) process.exit(0);

    // Read the package version from the installed commands' VERSION file
    // Check local then global
    const localVersion = path.join(cwd, '.claude', 'commands', 'clancy', 'VERSION');
    const homeDir = os.homedir();
    const globalVersion = path.join(homeDir, '.claude', 'commands', 'clancy', 'VERSION');

    let packageVersion = null;
    for (const vPath of [localVersion, globalVersion]) {
      if (fs.existsSync(vPath)) {
        try {
          packageVersion = fs.readFileSync(vPath, 'utf8').trim();
          break;
        } catch { /* try next */ }
      }
    }

    if (!packageVersion) process.exit(0);

    if (versionsDiffer(installedVersion, packageVersion)) {
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext:
            `DRIFT WARNING: Clancy runtime files are outdated (runtime: ${installedVersion}, commands: ${packageVersion}). ` +
            'Run /clancy:update to sync your installation.',
        },
      };
      process.stdout.write(JSON.stringify(output));
    }
  } catch {
    process.exit(0);
  }
});

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = { versionsDiffer };
}
