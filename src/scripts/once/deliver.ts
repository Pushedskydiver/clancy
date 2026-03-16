import { closeIssue } from '~/scripts/board/github/github.js';
import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';
import { formatDuration } from '~/scripts/shared/format/format.js';
import {
  checkout,
  deleteBranch,
  pushBranch,
  squashMerge,
} from '~/scripts/shared/git-ops/git-ops.js';
import { appendProgress } from '~/scripts/shared/progress/progress.js';
import { buildPrBody } from '~/scripts/shared/pull-request/pr-body/pr-body.js';
import { detectRemote } from '~/scripts/shared/remote/remote.js';
import { dim, green, yellow } from '~/utils/ansi/ansi.js';

import { sharedEnv, transitionToStatus } from './board-ops.js';
import { attemptPrCreation, buildManualPrUrl } from './pr-creation.js';
import type { FetchedTicket } from './types.js';

// ─── Delivery paths ──────────────────────────────────────────────────────────

/**
 * Epic/parent flow: squash merge locally, delete branch, transition to Done.
 */
export async function deliverViaEpicMerge(
  config: BoardConfig,
  ticket: FetchedTicket,
  ticketBranch: string,
  targetBranch: string,
): Promise<void> {
  checkout(targetBranch);
  const commitMsg = `feat(${ticket.key}): ${ticket.title}`;
  const hadChanges = squashMerge(ticketBranch, commitMsg);

  if (!hadChanges) {
    console.log(
      yellow(
        '⚠ No changes staged after squash merge. Claude may not have committed any work.',
      ),
    );
  }

  deleteBranch(ticketBranch);

  // Transition to Done / close issue (best-effort)
  const statusDone = config.env.CLANCY_STATUS_DONE;

  if (config.provider === 'github') {
    const issueNumber = parseInt(ticket.key.replace('#', ''), 10);

    if (Number.isNaN(issueNumber)) {
      console.log(
        `⚠ Could not parse issue number from ${ticket.key}. Close it manually on GitHub.`,
      );
    } else {
      const closed = await closeIssue(
        config.env.GITHUB_TOKEN,
        config.env.GITHUB_REPO,
        issueNumber,
      );
      if (!closed) {
        console.log(
          `⚠ Could not close issue ${ticket.key}. Close it manually on GitHub.`,
        );
      }
    }
  } else if (statusDone) {
    await transitionToStatus(config, ticket, statusDone);
  }

  appendProgress(process.cwd(), ticket.key, ticket.title, 'DONE');
}

/**
 * PR flow: push branch to remote, create PR/MR, transition to In Review.
 *
 * @returns `false` if the push failed (caller should handle early return).
 */
export async function deliverViaPullRequest(
  config: BoardConfig,
  ticket: FetchedTicket,
  ticketBranch: string,
  targetBranch: string,
  startTime: number,
  skipLog = false,
): Promise<boolean> {
  const pushed = pushBranch(ticketBranch);

  if (!pushed) {
    console.log(yellow(`⚠ Could not push ${ticketBranch} to origin.`));
    console.log(dim('  The branch is still available locally. Push manually:'));
    console.log(dim(`  git push -u origin ${ticketBranch}`));
    if (!skipLog)
      appendProgress(process.cwd(), ticket.key, ticket.title, 'PUSH_FAILED');
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
  const prBody = buildPrBody(config, {
    key: ticket.key,
    title: ticket.title,
    description: ticket.description,
    provider: config.provider,
  });

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
        );
    } else if (pr && !pr.ok && pr.alreadyExists) {
      console.log(
        yellow(
          `  ⚠ A PR/MR already exists for ${ticketBranch}. Branch pushed.`,
        ),
      );
      if (!skipLog)
        appendProgress(process.cwd(), ticket.key, ticket.title, 'PUSHED');
    } else if (pr && !pr.ok) {
      console.log(yellow(`  ⚠ PR/MR creation failed: ${pr.error}`));
      const manualUrl = buildManualPrUrl(remote, ticketBranch, targetBranch);
      if (manualUrl) {
        console.log(dim(`  Create one manually: ${manualUrl}`));
      } else {
        console.log(dim('  Branch pushed — create a PR/MR manually.'));
      }
      if (!skipLog)
        appendProgress(process.cwd(), ticket.key, ticket.title, 'PUSHED');
    } else {
      // No token available for this platform
      const manualUrl = buildManualPrUrl(remote, ticketBranch, targetBranch);
      if (manualUrl) {
        console.log(dim(`  Create a PR: ${manualUrl}`));
      } else {
        console.log(dim('  Branch pushed to remote. Create a PR/MR manually.'));
      }
      if (!skipLog)
        appendProgress(process.cwd(), ticket.key, ticket.title, 'PUSHED');
    }
  } else if (remote.host === 'none') {
    console.log(
      yellow(
        `⚠ No git remote configured. Branch available locally: ${ticketBranch}`,
      ),
    );
    if (!skipLog)
      appendProgress(process.cwd(), ticket.key, ticket.title, 'LOCAL');
  } else {
    // Unknown or Azure remote — just note the push
    console.log(dim('  Branch pushed to remote. Create a PR/MR manually.'));
    if (!skipLog)
      appendProgress(process.cwd(), ticket.key, ticket.title, 'PUSHED');
  }

  // Transition to In Review (not Done — PR hasn't been merged yet)
  // For GitHub Issues: do NOT close — PR body has "Closes #N" for auto-close on merge
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
