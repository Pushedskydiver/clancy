/**
 * Clancy Update Checker — SessionStart hook.
 *
 * Spawns a detached background process to check npm for the latest version.
 * Writes the result to a cache file that the statusline hook reads.
 * Returns immediately so it never delays session start.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Find the Clancy install directory (local takes priority over global).
 *
 * @param cwd - The current working directory to check for a local install.
 * @param home - The user's home directory to check for a global install.
 * @returns The path to the Clancy commands directory, or `null` if not found.
 */
export function findInstallDir(cwd: string, home: string): string | null {
  const localVersion = join(cwd, '.claude', 'commands', 'clancy', 'VERSION');
  const globalVersion = join(home, '.claude', 'commands', 'clancy', 'VERSION');

  if (existsSync(localVersion)) return dirname(localVersion);
  if (existsSync(globalVersion)) return dirname(globalVersion);

  return null;
}

/**
 * Read the installed version from a VERSION file.
 *
 * @param installDir - The Clancy install directory containing the VERSION file.
 * @returns The installed version string, or `'0.0.0'` if the file cannot be read.
 */
export function readInstalledVersion(installDir: string): string {
  try {
    return readFileSync(join(installDir, 'VERSION'), 'utf8').trim();
  } catch {
    return '0.0.0';
  }
}

/**
 * Spawn a detached background process to check npm and write cache.
 *
 * @param cacheFile - The absolute path to write the update check cache JSON.
 * @param versionFile - The absolute path to the installed VERSION file.
 */
export function spawnUpdateCheck(
  cacheFile: string,
  versionFile: string,
): void {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
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
    `,
    ],
    {
      stdio: 'ignore',
      windowsHide: true,
      detached: true,
    },
  );

  child.unref();
}

/**
 * Run the update check.
 *
 * Locates the Clancy install directory, ensures the cache directory exists,
 * and spawns a detached background process to check npm for the latest version.
 */
export function runCheckUpdate(): void {
  const home = homedir();
  const cwd = process.cwd();

  const installDir = findInstallDir(cwd, home);

  if (!installDir) return;

  const cacheDir = join(home, '.claude', 'cache');
  const cacheFile = join(cacheDir, 'clancy-update-check.json');
  const versionFile = join(installDir, 'VERSION');

  if (!existsSync(cacheDir)) {
    try {
      mkdirSync(cacheDir, { recursive: true });
    } catch {
      return;
    }
  }

  spawnUpdateCheck(cacheFile, versionFile);
}

// ── CLI entry point ──────────────────────────────────────────────────────────

const isDirectRun = process.argv[1]?.includes('check-update');

if (isDirectRun) {
  try {
    runCheckUpdate();
  } catch {
    /* best-effort — never delay session start */
  }
}
