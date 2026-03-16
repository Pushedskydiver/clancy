/**
 * Preflight checks shared across board scripts.
 *
 * Validates the environment before running a ticket:
 * required binaries, .env file, git repository, and working directory state.
 */
import { execFileSync } from 'node:child_process';

import { loadClancyEnv } from '~/scripts/shared/env-parser/env-parser.js';
import { hasUncommittedChanges } from '~/scripts/shared/git-ops/git-ops.js';

type PreflightResult = {
  ok: boolean;
  error?: string;
  warning?: string;
  env?: Record<string, string>;
};

/**
 * Check whether a binary is available on the system PATH.
 *
 * @param name - The binary name to check (e.g., `'git'`, `'curl'`).
 * @returns `true` if the binary is found.
 */
export function binaryExists(name: string): boolean {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the current directory is inside a git repository.
 *
 * @returns `true` if a `.git` directory is found.
 */
export function isGitRepo(): boolean {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run all preflight checks common to every board script.
 *
 * Checks for required binaries (`claude`, `git`), the `.clancy/.env` file,
 * git repository state, and uncommitted changes.
 *
 * @param projectRoot - The root directory of the project.
 * @returns A result object with `ok`, optional `error`/`warning`, and parsed `env`.
 *
 * @example
 * ```ts
 * const result = runPreflight('/path/to/project');
 * if (!result.ok) {
 *   console.error(result.error);
 *   process.exit(0);
 * }
 * ```
 */
export function runPreflight(projectRoot: string): PreflightResult {
  // Check required binaries
  for (const bin of ['claude', 'git']) {
    if (!binaryExists(bin)) {
      return { ok: false, error: `✗ ${bin} is required but not found` };
    }
  }

  // Check .env file
  const env = loadClancyEnv(projectRoot);

  if (!env) {
    return {
      ok: false,
      error: '✗ .clancy/.env not found — run /clancy:init first',
    };
  }

  // Check git repo
  if (!isGitRepo()) {
    return { ok: false, error: '✗ Not inside a git repository' };
  }

  // Check connectivity to remote (warning-only, never blocks)
  let warning: string | undefined;

  try {
    execFileSync('git', ['ls-remote', 'origin', 'HEAD'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    warning =
      '⚠ Could not reach origin. PR creation and rework detection may not work.';
  }

  // Warn about uncommitted changes
  if (hasUncommittedChanges()) {
    const dirtyWarning =
      '⚠ Working directory has uncommitted changes — they will be included in the branch';
    warning = warning ? `${warning}\n${dirtyWarning}` : dirtyWarning;
  }

  return { ok: true, env, warning };
}
