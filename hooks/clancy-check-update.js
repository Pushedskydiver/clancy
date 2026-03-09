#!/usr/bin/env node
// SessionStart hook: check for Clancy updates in the background.
// Spawns a detached child process to hit npm, writes result to cache.
// Claude reads the cache via CLAUDE.md instruction — no output from this script.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const homeDir = os.homedir();
const cwd = process.cwd();

// Resolve the Clancy install dir (local takes priority over global).
function findInstallDir() {
  const localVersion = path.join(cwd, '.claude', 'commands', 'clancy', 'VERSION');
  const globalVersion = path.join(homeDir, '.claude', 'commands', 'clancy', 'VERSION');
  if (fs.existsSync(localVersion)) return path.dirname(localVersion);
  if (fs.existsSync(globalVersion)) return path.dirname(globalVersion);
  return null;
}

const installDir = findInstallDir();
if (!installDir) process.exit(0); // Clancy not installed — nothing to check

const cacheDir = path.join(homeDir, '.claude', 'cache');
const cacheFile = path.join(cacheDir, 'clancy-update-check.json');
const versionFile = path.join(installDir, 'VERSION');

if (!fs.existsSync(cacheDir)) {
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch { process.exit(0); }
}

// Spawn a detached background process to do the actual npm check.
// This script returns immediately so it never delays session start.
const child = spawn(process.execPath, ['-e', `
  const fs = require('fs');
  const { execSync } = require('child_process');

  const cacheFile = ${JSON.stringify(cacheFile)};
  const versionFile = ${JSON.stringify(versionFile)};

  let installed = '0.0.0';
  try { installed = fs.readFileSync(versionFile, 'utf8').trim(); } catch {}

  let latest = null;
  try {
    latest = execSync('npm view chief-clancy version', {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    }).trim();
  } catch {}

  const result = {
    update_available: Boolean(latest && installed !== latest),
    installed,
    latest: latest || 'unknown',
    checked: Math.floor(Date.now() / 1000),
  };

  try { fs.writeFileSync(cacheFile, JSON.stringify(result)); } catch {}
`], {
  stdio: 'ignore',
  windowsHide: true,
  detached: true,
});

child.unref();
