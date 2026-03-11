/**
 * Preflight checks shared across board scripts.
 *
 * Validates the environment before running a ticket:
 * required binaries, .env file, git repository, and working directory state.
 */
import { execSync } from 'node:child_process';

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
    execSync(`command -v ${name}`, { stdio: 'ignore' });
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
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run all preflight checks common to every board script.
 *
 * Checks for required binaries (`claude`, `jq`, `curl`), the `.clancy/.env` file,
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
  for (const bin of ['claude', 'jq', 'curl']) {
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

  // Warn about uncommitted changes
  let warning: string | undefined;

  if (hasUncommittedChanges()) {
    warning =
      '⚠ Working directory has uncommitted changes — they will be included in the branch';
  }

  return { ok: true, env, warning };
}
