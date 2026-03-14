/**
 * Git operations shared across board scripts.
 *
 * Wraps common git commands used during the ticket lifecycle:
 * branch creation, checkout, squash merge, and cleanup.
 */
import { execFileSync } from 'node:child_process';

/**
 * Run a git command and return trimmed stdout.
 *
 * @param args - The git sub-command and its arguments.
 * @returns The trimmed stdout output.
 */
function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/**
 * Get the name of the currently checked-out branch.
 *
 * @returns The current branch name.
 */
export function currentBranch(): string {
  return git('rev-parse', '--abbrev-ref', 'HEAD');
}

/**
 * Check whether the working directory has uncommitted changes.
 *
 * @returns `true` if there are staged or unstaged changes.
 */
export function hasUncommittedChanges(): boolean {
  try {
    execFileSync('git', ['diff', '--quiet'], { stdio: 'ignore' });
    execFileSync('git', ['diff', '--cached', '--quiet'], { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

/**
 * Check whether a local branch exists.
 *
 * @param branch - The branch name to check.
 * @returns `true` if the branch exists locally.
 */
export function branchExists(branch: string): boolean {
  try {
    execFileSync(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      {
        stdio: 'ignore',
      },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a branch from a base branch if it doesn't already exist.
 *
 * @param branch - The branch name to create.
 * @param baseBranch - The base branch to create from.
 */
export function ensureBranch(branch: string, baseBranch: string): void {
  if (!branchExists(branch)) {
    git('checkout', '-b', branch, baseBranch);
  }
}

/**
 * Check out a branch. Uses `-B` flag to force-create if needed.
 *
 * @param branch - The branch name to check out.
 * @param force - If `true`, uses `-B` to force-create/reset the branch.
 */
export function checkout(branch: string, force = false): void {
  git('checkout', ...(force ? ['-B'] : []), branch);
}

/**
 * Squash merge a source branch into the currently checked-out branch
 * and commit with the given message.
 *
 * @param sourceBranch - The branch to squash merge from.
 * @param commitMessage - The commit message for the squash merge.
 * @returns `true` if changes were committed, `false` if there was nothing to commit.
 */
export function squashMerge(
  sourceBranch: string,
  commitMessage: string,
): boolean {
  git('merge', '--squash', sourceBranch);

  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], { stdio: 'ignore' });
    return false; // nothing staged
  } catch {
    execFileSync('git', ['commit', '-m', commitMessage], { encoding: 'utf8' });
    return true;
  }
}

/**
 * Delete a local branch (force).
 *
 * Uses `-D` because squash merges leave the branch in an "unmerged" state
 * from git's perspective, causing `-d` to fail.
 *
 * @param branch - The branch name to delete.
 */
export function deleteBranch(branch: string): void {
  git('branch', '-D', branch);
}

/**
 * Push a branch to the remote origin.
 *
 * Uses `-u` to set up upstream tracking.
 *
 * @param branch - The branch name to push.
 * @returns `true` if the push succeeded, `false` on failure.
 */
export function pushBranch(branch: string): boolean {
  try {
    execFileSync('git', ['push', '-u', 'origin', branch], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}
