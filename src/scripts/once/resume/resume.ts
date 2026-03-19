/**
 * Resume detection and execution for crash recovery.
 *
 * After a stale lock is cleaned up, checks if the ticket branch exists
 * locally with uncommitted or unpushed work. If so, offers to resume
 * (automatic in AFK mode, interactive otherwise).
 */
import { execFileSync } from 'node:child_process';

import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';
import {
  branchExists,
  checkout,
  hasUncommittedChanges,
  pushBranch,
} from '~/scripts/shared/git-ops/git-ops.js';
import { appendProgress } from '~/scripts/shared/progress/progress.js';
import { buildPrBody } from '~/scripts/shared/pull-request/pr-body/pr-body.js';
import { detectRemote } from '~/scripts/shared/remote/remote.js';
import { dim, green, yellow } from '~/utils/ansi/ansi.js';

import { sharedEnv } from '../board-ops/board-ops.js';
import type { LockData } from '../lock/lock.js';
import { attemptPrCreation } from '../pr-creation/pr-creation.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ResumeInfo = {
  branch: string;
  hasUncommitted: boolean;
  hasUnpushed: boolean;
};

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Check if the ticket branch from a stale lock has recoverable work.
 *
 * @param lock - The stale lock data.
 * @returns Resume info if the branch has work to recover, undefined otherwise.
 */
export function detectResume(lock: LockData): ResumeInfo | undefined {
  const branch = lock.ticketBranch;

  if (!branchExists(branch)) {
    return undefined;
  }

  // Save current branch, switch to the ticket branch to inspect it
  let previousBranch: string;
  try {
    previousBranch = execFileSync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      {
        encoding: 'utf8',
      },
    ).trim();
  } catch {
    return undefined;
  }

  try {
    checkout(branch);
  } catch {
    return undefined;
  }

  let uncommitted = false;
  let unpushed = false;

  try {
    uncommitted = hasUncommittedChanges();
  } catch {
    // Ignore — treat as no uncommitted changes
  }

  try {
    // Check for unpushed commits (commits on branch not on remote)
    const log = execFileSync(
      'git',
      ['log', `origin/${branch}..${branch}`, '--oneline'],
      { encoding: 'utf8' },
    ).trim();
    unpushed = log.length > 0;
  } catch {
    // Remote branch may not exist — check if there are any commits ahead of target
    try {
      const log = execFileSync(
        'git',
        ['log', `origin/${lock.targetBranch}..${branch}`, '--oneline'],
        { encoding: 'utf8' },
      ).trim();
      unpushed = log.length > 0;
    } catch {
      // Ignore — treat as no unpushed commits
    }
  }

  // Restore original branch
  try {
    checkout(previousBranch);
  } catch {
    // Best-effort
  }

  if (!uncommitted && !unpushed) {
    return undefined;
  }

  return { branch, hasUncommitted: uncommitted, hasUnpushed: unpushed };
}

// ─── Execution ───────────────────────────────────────────────────────────────

/**
 * Resume a crashed session: commit uncommitted changes, push, and create a PR.
 *
 * @param config - Board configuration.
 * @param lock - The stale lock data.
 * @param resumeInfo - The resume detection result.
 * @returns `true` if resume succeeded.
 */
export async function executeResume(
  config: BoardConfig,
  lock: LockData,
  resumeInfo: ResumeInfo,
): Promise<boolean> {
  try {
    checkout(resumeInfo.branch);

    // Commit uncommitted changes
    if (resumeInfo.hasUncommitted) {
      try {
        execFileSync('git', ['add', '-A'], { encoding: 'utf8' });
        execFileSync(
          'git',
          ['commit', '-m', `fix(${lock.ticketKey}): resume after crash`],
          { encoding: 'utf8' },
        );
        console.log(
          green(`  ✓ Committed in-progress work for ${lock.ticketKey}`),
        );
      } catch {
        console.log(
          yellow(`  ⚠ Could not commit changes on ${resumeInfo.branch}`),
        );
        return false;
      }
    }

    // Push
    const pushed = pushBranch(resumeInfo.branch);
    if (!pushed) {
      console.log(yellow(`  ⚠ Could not push ${resumeInfo.branch} to origin`));
      return false;
    }

    console.log(green(`  ✓ Pushed ${resumeInfo.branch}`));

    // Attempt PR creation
    const platformOverride = sharedEnv(config).CLANCY_GIT_PLATFORM;
    const remote = detectRemote(platformOverride);
    const prTitle = `feat(${lock.ticketKey}): ${lock.ticketTitle}`;
    const prBody = buildPrBody(
      config,
      {
        key: lock.ticketKey,
        title: lock.ticketTitle,
        description: '',
        provider: config.provider,
      },
      lock.targetBranch,
    );

    if (
      remote.host !== 'none' &&
      remote.host !== 'unknown' &&
      remote.host !== 'azure'
    ) {
      const pr = await attemptPrCreation(
        config,
        remote,
        resumeInfo.branch,
        lock.targetBranch,
        prTitle,
        prBody,
      );

      if (pr?.ok) {
        console.log(green(`  ✓ PR created: ${pr.url}`));
        appendProgress(
          process.cwd(),
          lock.ticketKey,
          lock.ticketTitle,
          'RESUMED',
          pr.number,
          lock.parentKey || undefined,
        );
      } else {
        console.log(dim('  Branch pushed — create a PR manually.'));
        appendProgress(
          process.cwd(),
          lock.ticketKey,
          lock.ticketTitle,
          'RESUMED',
          undefined,
          lock.parentKey || undefined,
        );
      }
    } else {
      appendProgress(
        process.cwd(),
        lock.ticketKey,
        lock.ticketTitle,
        'RESUMED',
        undefined,
        lock.parentKey || undefined,
      );
    }

    // Switch back to target branch
    try {
      checkout(lock.targetBranch);
    } catch {
      // Best-effort
    }

    return true;
  } catch (err) {
    console.log(
      yellow(
        `  ⚠ Resume failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return false;
  }
}
