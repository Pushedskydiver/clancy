/**
 * Git operations shared across board scripts.
 *
 * Wraps common git commands used during the ticket lifecycle:
 * branch creation, checkout, squash merge, and cleanup.
 */
import { execSync } from 'node:child_process';

/**
 * Run a git command and return trimmed stdout.
 *
 * @param args - The git command arguments (e.g., `'status --short'`).
 * @returns The trimmed stdout output.
 */
function git(args: string): string {
  return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

/**
 * Check whether the working directory has uncommitted changes.
 *
 * @returns `true` if there are staged or unstaged changes.
 */
export function hasUncommittedChanges(): boolean {
  try {
    execSync('git diff --quiet', { stdio: 'ignore' });
    execSync('git diff --cached --quiet', { stdio: 'ignore' });
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
    execSync(`git show-ref --verify --quiet refs/heads/${branch}`, {
      stdio: 'ignore',
    });
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
    git(`checkout -b ${branch} ${baseBranch}`);
  }
}

/**
 * Check out a branch. Uses `-B` flag to force-create if needed.
 *
 * @param branch - The branch name to check out.
 * @param force - If `true`, uses `-B` to force-create/reset the branch.
 */
export function checkout(branch: string, force = false): void {
  git(`checkout ${force ? '-B' : ''} ${branch}`);
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
  git(`merge --squash ${sourceBranch}`);

  try {
    execSync('git diff --cached --quiet', { stdio: 'ignore' });
    return false; // nothing staged
  } catch {
    git(`commit -m "${commitMessage}"`);
    return true;
  }
}

/**
 * Delete a local branch.
 *
 * @param branch - The branch name to delete.
 */
export function deleteBranch(branch: string): void {
  git(`branch -d ${branch}`);
}
