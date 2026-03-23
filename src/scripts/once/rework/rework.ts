import { computeTicketBranch } from '~/scripts/shared/branch/branch.js';
import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';
import { findEntriesWithStatus } from '~/scripts/shared/progress/progress.js';
import type { FetchedTicket } from '~/types/board.js';
import { dim } from '~/utils/ansi/ansi.js';

import { resolvePlatformHandlers } from './rework-handlers.js';

// ─── PR-based rework detection ────────────────────────────────────────────────

/**
 * Check open PRs for review feedback requesting changes.
 *
 * Scans progress.txt for tickets with status PR_CREATED, then checks
 * the corresponding PR's review state on the detected remote platform.
 * If a reviewer has requested changes, returns the ticket and feedback.
 *
 * This is best-effort — errors are swallowed so the orchestrator
 * can fall through to fresh ticket fetch.
 */
export async function fetchReworkFromPrReview(config: BoardConfig): Promise<
  | {
      ticket: FetchedTicket;
      feedback: string[];
      prNumber: number;
      discussionIds?: string[];
      reviewers: string[];
    }
  | undefined
> {
  const prCreated = findEntriesWithStatus(process.cwd(), 'PR_CREATED');
  const reworked = findEntriesWithStatus(process.cwd(), 'REWORK');
  const pushed = findEntriesWithStatus(process.cwd(), 'PUSHED');
  const pushFailed = findEntriesWithStatus(process.cwd(), 'PUSH_FAILED');
  const candidates = [...prCreated, ...reworked, ...pushed, ...pushFailed];
  if (candidates.length === 0) return undefined;

  const handlers = resolvePlatformHandlers(config);
  if (!handlers) return undefined;

  // Limit to first 5 candidates to avoid rate limits
  const toCheck = candidates.slice(0, 5);

  for (const entry of toCheck) {
    const branch = computeTicketBranch(config.provider, entry.key);

    // Convert progress timestamp (YYYY-MM-DD HH:MM) to ISO 8601 for API filtering.
    // Only comments created AFTER this timestamp should trigger rework,
    // preventing stale inline comments from causing infinite rework loops.
    let since: string | undefined;
    if (entry.timestamp) {
      const date = new Date(entry.timestamp.replace(' ', 'T') + 'Z');
      since = Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }

    const reviewState = await handlers.checkReviewState(branch, since);

    if (reviewState?.changesRequested) {
      const { comments, discussionIds } = await handlers.fetchComments(
        reviewState.prNumber,
        since,
      );

      const ticket: FetchedTicket = {
        key: entry.key,
        title: entry.summary,
        description: entry.summary,
        parentInfo: entry.parent ?? 'none',
        blockers: 'None',
      };

      return {
        ticket,
        feedback: comments,
        prNumber: reviewState.prNumber,
        discussionIds,
        reviewers: reviewState.reviewers ?? [],
      };
    }
  }

  return undefined;
}

// ─── Post-rework actions ──────────────────────────────────────────────────

/**
 * Build a rework comment to post on the PR after pushing fixes.
 *
 * Prefixed with `[clancy]` (not `Rework:`) so it does NOT trigger
 * rework detection on the next cycle.
 */
export function buildReworkComment(feedback: string[]): string {
  if (feedback.length === 0) {
    return '[clancy] Rework pushed addressing reviewer feedback.';
  }
  const count = feedback.length;
  const summary = feedback
    .slice(0, 3)
    .map((f) => `- ${f.slice(0, 80)}`)
    .join('\n');
  const suffix = feedback.length > 3 ? '\n- ...' : '';
  return `[clancy] Rework pushed addressing ${count} feedback item${count !== 1 ? 's' : ''}.\n\n${summary}${suffix}`;
}

/**
 * Perform post-rework actions: comment on PR, re-request review (GitHub),
 * resolve threads (GitLab). All best-effort — failures warn but don't block.
 */
export async function postReworkActions(
  config: BoardConfig,
  prNumber: number,
  feedback: string[],
  discussionIds?: string[],
  reviewers?: string[],
): Promise<void> {
  const handlers = resolvePlatformHandlers(config);
  if (!handlers) return;

  const comment = buildReworkComment(feedback);

  // 1. Post rework comment
  try {
    const posted = await handlers.postComment(prNumber, comment);
    if (posted) {
      console.log(dim('  ✓ Posted rework comment'));
    }
  } catch {
    // Best-effort
  }

  // 2. Resolve addressed discussion threads (GitLab — no-op on others)
  if (discussionIds && discussionIds.length > 0) {
    try {
      const resolved = await handlers.resolveThreads(prNumber, discussionIds);
      if (resolved > 0) {
        console.log(
          dim(
            `  ✓ Resolved ${resolved} discussion thread${resolved !== 1 ? 's' : ''}`,
          ),
        );
      }
    } catch {
      // Best-effort
    }
  }

  // 3. Re-request review from reviewers who requested changes (GitHub — no-op on others)
  if (reviewers && reviewers.length > 0) {
    try {
      const ok = await handlers.reRequestReview(prNumber, reviewers);
      if (ok) {
        console.log(
          dim(`  ✓ Re-requested review from ${reviewers.join(', ')}`),
        );
      }
    } catch {
      // Best-effort
    }
  }
}
