import { execFileSync } from 'node:child_process';

import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';
import { formatDuration } from '~/scripts/shared/format/format.js';
import {
  branchExists,
  checkout,
  fetchRemoteBranch,
  pushBranch,
  remoteBranchExists,
} from '~/scripts/shared/git-ops/git-ops.js';
import {
  appendProgress,
  findEntriesWithStatus,
} from '~/scripts/shared/progress/progress.js';
import {
  buildEpicPrBody,
  buildPrBody,
} from '~/scripts/shared/pull-request/pr-body/pr-body.js';
import { detectRemote } from '~/scripts/shared/remote/remote.js';
import { dim, green, red, yellow } from '~/utils/ansi/ansi.js';

import { sharedEnv, transitionToStatus } from '../board-ops/board-ops.js';
import {
  attemptPrCreation,
  buildManualPrUrl,
} from '../pr-creation/pr-creation.js';
import type { FetchedTicket } from '../types/types.js';

// ─── Epic branch management ─────────────────────────────────────────────────

/**
 * Ensure the epic branch exists locally and on the remote.
 *
 * - If it exists on the remote, fetches it locally.
 * - If it only exists locally with unpushed commits, refuses to overwrite
 *   and prints migration instructions (safety guard for mid-upgrade users).
 * - If it doesn't exist at all, creates from `origin/{baseBranch}` and pushes.
 * - Checks staleness: warns if the epic branch is behind the base branch.
 *
 * @param epicBranch - The epic branch name (e.g., `'epic/proj-100'`).
 * @param baseBranch - The base branch name (e.g., `'main'`).
 * @returns `true` if the branch is ready, `false` if creation was blocked.
 */
export function ensureEpicBranch(
  epicBranch: string,
  baseBranch: string,
): boolean {
  const existsOnRemote = remoteBranchExists(epicBranch);
  const existsLocally = branchExists(epicBranch);

  if (existsOnRemote) {
    // Fetch latest from remote
    fetchRemoteBranch(epicBranch);
    return true;
  }

  if (existsLocally) {
    // Local branch exists but not on remote — may have unpushed squash merges
    // from the old deliverViaEpicMerge flow. Refuse to overwrite.
    console.log(
      red(`✗ Epic branch ${epicBranch} exists locally but not on remote.`),
    );
    console.log(
      yellow(
        '  This may contain work from a previous Clancy version that squash-merged locally.',
      ),
    );
    console.log(dim('  To preserve this work, push it manually:'));
    console.log(dim(`    git push -u origin ${epicBranch}`));
    console.log(dim('  Then re-run /clancy:once to continue.'));
    return false;
  }

  // Create fresh epic branch from latest remote base
  try {
    execFileSync('git', ['fetch', 'origin', baseBranch], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    execFileSync(
      'git',
      ['checkout', '-b', epicBranch, `origin/${baseBranch}`],
      { encoding: 'utf8' },
    );
    const pushed = pushBranch(epicBranch);
    if (!pushed) {
      console.log(
        yellow(`⚠ Created ${epicBranch} locally but could not push to origin.`),
      );
      return false;
    } else {
      console.log(green(`  ✓ Created epic branch ${epicBranch}`));
    }
    return true;
  } catch (err) {
    console.log(
      red(
        `✗ Could not create epic branch: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return false;
  }
}

// ─── Delivery paths ──────────────────────────────────────────────────────────

/**
 * PR flow: push branch to remote, create PR/MR, transition to In Review.
 *
 * @param parent - Optional parent key for progress logging (epic branch flow).
 * @returns `false` if the push failed (caller should handle early return).
 */
export async function deliverViaPullRequest(
  config: BoardConfig,
  ticket: FetchedTicket,
  ticketBranch: string,
  targetBranch: string,
  startTime: number,
  skipLog = false,
  parent?: string,
): Promise<boolean> {
  const pushed = pushBranch(ticketBranch);

  if (!pushed) {
    console.log(yellow(`⚠ Could not push ${ticketBranch} to origin.`));
    console.log(dim('  The branch is still available locally. Push manually:'));
    console.log(dim(`  git push -u origin ${ticketBranch}`));
    if (!skipLog)
      appendProgress(
        process.cwd(),
        ticket.key,
        ticket.title,
        'PUSH_FAILED',
        undefined,
        parent,
      );
    checkout(targetBranch);

    const elapsed = formatDuration(Date.now() - startTime);
    console.log('');
    console.log(
      yellow(`⚠ ${ticket.key} implemented but push failed`) +
        dim(` (${elapsed})`),
    );
    return false;
  }

  console.log(green(`  ✓ Pushed ${ticketBranch}`));

  // Attempt PR/MR creation
  const platformOverride = sharedEnv(config).CLANCY_GIT_PLATFORM;
  const remote = detectRemote(platformOverride);
  const prTitle = `feat(${ticket.key}): ${ticket.title}`;
  const prBody = buildPrBody(
    config,
    {
      key: ticket.key,
      title: ticket.title,
      description: ticket.description,
      provider: config.provider,
    },
    targetBranch,
  );

  if (
    remote.host !== 'none' &&
    remote.host !== 'unknown' &&
    remote.host !== 'azure'
  ) {
    const pr = await attemptPrCreation(
      config,
      remote,
      ticketBranch,
      targetBranch,
      prTitle,
      prBody,
    );

    if (pr?.ok) {
      console.log(green(`  ✓ PR created: ${pr.url}`));
      if (!skipLog)
        appendProgress(
          process.cwd(),
          ticket.key,
          ticket.title,
          'PR_CREATED',
          pr.number,
          parent,
        );
    } else if (pr && !pr.ok && pr.alreadyExists) {
      console.log(
        yellow(
          `  ⚠ A PR/MR already exists for ${ticketBranch}. Branch pushed.`,
        ),
      );
      if (!skipLog)
        appendProgress(
          process.cwd(),
          ticket.key,
          ticket.title,
          'PUSHED',
          undefined,
          parent,
        );
    } else if (pr && !pr.ok) {
      console.log(yellow(`  ⚠ PR/MR creation failed: ${pr.error}`));
      const manualUrl = buildManualPrUrl(remote, ticketBranch, targetBranch);
      if (manualUrl) {
        console.log(dim(`  Create one manually: ${manualUrl}`));
      } else {
        console.log(dim('  Branch pushed — create a PR/MR manually.'));
      }
      if (!skipLog)
        appendProgress(
          process.cwd(),
          ticket.key,
          ticket.title,
          'PUSHED',
          undefined,
          parent,
        );
    } else {
      // No token available for this platform
      const manualUrl = buildManualPrUrl(remote, ticketBranch, targetBranch);
      if (manualUrl) {
        console.log(dim(`  Create a PR: ${manualUrl}`));
      } else {
        console.log(dim('  Branch pushed to remote. Create a PR/MR manually.'));
      }
      if (!skipLog)
        appendProgress(
          process.cwd(),
          ticket.key,
          ticket.title,
          'PUSHED',
          undefined,
          parent,
        );
    }
  } else if (remote.host === 'none') {
    console.log(
      yellow(
        `⚠ No git remote configured. Branch available locally: ${ticketBranch}`,
      ),
    );
    if (!skipLog)
      appendProgress(
        process.cwd(),
        ticket.key,
        ticket.title,
        'LOCAL',
        undefined,
        parent,
      );
  } else {
    // Unknown or Azure remote — just note the push
    console.log(dim('  Branch pushed to remote. Create a PR/MR manually.'));
    if (!skipLog)
      appendProgress(
        process.cwd(),
        ticket.key,
        ticket.title,
        'PUSHED',
        undefined,
        parent,
      );
  }

  // Transition to In Review (not Done — PR hasn't been merged yet)
  // For GitHub Issues: do NOT close — PR body has "Closes #N" (or "Part of") for auto-close on merge
  if (config.provider !== 'github') {
    const statusReview =
      config.env.CLANCY_STATUS_REVIEW ?? config.env.CLANCY_STATUS_DONE;
    if (statusReview) {
      await transitionToStatus(config, ticket, statusReview);
    }
  }

  // Switch back to target branch
  checkout(targetBranch);
  return true;
}

// ─── Epic completion ──────────────────────────────────────────────────────────

/**
 * Create the final PR from the epic branch to the base branch.
 *
 * Called when all children of an epic are done. Builds a PR body listing
 * all child tickets, creates the PR, and logs EPIC_PR_CREATED.
 *
 * @param config - The board configuration.
 * @param epicKey - The epic ticket key (e.g., `'PROJ-100'`).
 * @param epicTitle - The epic ticket title.
 * @param epicBranch - The epic branch name (e.g., `'epic/proj-100'`).
 * @param baseBranch - The base branch name (e.g., `'main'`).
 * @returns `true` if the PR was created successfully.
 */
export async function deliverEpicToBase(
  config: BoardConfig,
  epicKey: string,
  epicTitle: string,
  epicBranch: string,
  baseBranch: string,
): Promise<boolean> {
  console.log('');
  console.log(green(`🎉 All children of ${epicKey} are done!`));
  console.log(dim(`  Creating epic PR: ${epicBranch} → ${baseBranch}`));

  // Gather child entries from progress.txt
  const allPrCreated = findEntriesWithStatus(process.cwd(), 'PR_CREATED');
  const allDone = findEntriesWithStatus(process.cwd(), 'DONE');
  const allReworked = findEntriesWithStatus(process.cwd(), 'REWORK');
  const childEntries = [...allPrCreated, ...allDone, ...allReworked].filter(
    (e) => e.parent === epicKey,
  );

  const platformOverride = sharedEnv(config).CLANCY_GIT_PLATFORM;
  const remote = detectRemote(platformOverride);
  const prTitle = `feat(${epicKey}): ${epicTitle}`;
  const prBody = buildEpicPrBody(epicKey, epicTitle, childEntries);

  if (
    remote.host === 'none' ||
    remote.host === 'unknown' ||
    remote.host === 'azure'
  ) {
    console.log(
      yellow(`⚠ Cannot create epic PR — no supported git remote detected.`),
    );
    console.log(dim(`  Push manually: git push origin ${epicBranch}`));
    console.log(dim(`  Then create a PR targeting ${baseBranch}`));
    return false;
  }

  const pr = await attemptPrCreation(
    config,
    remote,
    epicBranch,
    baseBranch,
    prTitle,
    prBody,
  );

  if (pr?.ok) {
    console.log(green(`  ✓ Epic PR created: ${pr.url}`));
    appendProgress(
      process.cwd(),
      epicKey,
      epicTitle,
      'EPIC_PR_CREATED',
      pr.number,
    );

    // Transition epic ticket to Review
    if (config.provider !== 'github') {
      const statusReview =
        config.env.CLANCY_STATUS_REVIEW ?? config.env.CLANCY_STATUS_DONE;
      if (statusReview) {
        await transitionToStatus(
          config,
          {
            key: epicKey,
            title: epicTitle,
            description: '',
            parentInfo: 'none',
            blockers: 'None',
          },
          statusReview,
        );
      }
    }

    return true;
  }

  if (pr && !pr.ok && pr.alreadyExists) {
    console.log(yellow(`  ⚠ An epic PR already exists for ${epicBranch}.`));
    return true;
  }

  console.log(
    yellow(`⚠ Epic PR creation failed: ${pr?.error ?? 'unknown error'}`),
  );
  console.log(dim(`  Create it manually:`));
  console.log(dim(`    Branch: ${epicBranch} → ${baseBranch}`));
  const manualUrl = buildManualPrUrl(remote, epicBranch, baseBranch);
  if (manualUrl) {
    console.log(dim(`    ${manualUrl}`));
  }

  return false;
}
