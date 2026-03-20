/**
 * Phase 10: Deliver — PR creation and delivery (rework and fresh paths).
 *
 * Reads `ctx.config`, `ctx.ticket`, `ctx.isRework`, `ctx.ticketBranch`,
 * `ctx.effectiveTarget`, `ctx.startTime`, `ctx.hasParent`, `ctx.skipEpicBranch`,
 * `ctx.prFeedback`, `ctx.reworkPrNumber`, `ctx.reworkDiscussionIds`,
 * `ctx.reworkReviewers`. Returns `true` if delivery succeeds, `false` otherwise.
 */
import { appendProgress } from '~/scripts/shared/progress/progress.js';

import type { RunContext } from '../context/context.js';
import { deliverViaPullRequest } from '../deliver/deliver.js';
import { recordDelivery, recordRework } from '../quality/quality.js';
import { postReworkActions } from '../rework/rework.js';

export async function deliver(ctx: RunContext): Promise<boolean> {
  const config = ctx.config!;
  const ticket = ctx.ticket!;
  const ticketBranch = ctx.ticketBranch!;
  const effectiveTarget = ctx.effectiveTarget!;
  const hasParent = ctx.hasParent!;
  const skipEpicBranch = ctx.skipEpicBranch ?? false;
  const isRework = ctx.isRework ?? false;

  const parentKey =
    hasParent && !skipEpicBranch ? ticket.parentInfo : undefined;
  // When single-child skip is active, pass the parent key separately
  // so the PR body can include Closes for the parent issue too.
  // For GitHub: only use if parentInfo is a valid issue ref (#N).
  // Milestone titles would produce invalid "Closes Sprint 3" lines.
  const rawParent = hasParent && skipEpicBranch ? ticket.parentInfo : undefined;
  // GitHub: validate parentInfo is a valid issue ref (#N, digits only)
  const isValidGitHubRef = rawParent && /^#\d+$/.test(rawParent);
  const singleChildParent =
    rawParent && config.provider === 'github' && !isValidGitHubRef
      ? undefined
      : rawParent;

  if (isRework) {
    // PR-flow rework: push to existing branch, PR updates automatically
    const delivered = await deliverViaPullRequest(
      config,
      ticket,
      ticketBranch,
      effectiveTarget,
      ctx.startTime,
      true,
      parentKey,
      ctx.board,
    );
    if (!delivered) {
      appendProgress(
        ctx.cwd,
        ticket.key,
        ticket.title,
        'PUSH_FAILED',
        undefined,
        parentKey,
      );
      return false;
    }

    // Log single REWORK entry (skipLog prevents deliverViaPullRequest from double-logging)
    appendProgress(
      ctx.cwd,
      ticket.key,
      ticket.title,
      'REWORK',
      ctx.reworkPrNumber,
      parentKey,
    );

    // Quality tracking (best-effort)
    recordRework(ctx.cwd, ticket.key);

    // Post-rework actions (all best-effort)
    if (ctx.reworkPrNumber != null) {
      await postReworkActions(
        config,
        ctx.reworkPrNumber,
        ctx.prFeedback ?? [],
        ctx.reworkDiscussionIds,
        ctx.reworkReviewers,
      );
    }
  } else {
    // Fresh ticket: deliver via PR (to epic branch or base branch)
    const delivered = await deliverViaPullRequest(
      config,
      ticket,
      ticketBranch,
      effectiveTarget,
      ctx.startTime,
      false,
      parentKey,
      ctx.board,
      singleChildParent,
    );
    if (!delivered) return false;

    // Quality tracking (best-effort)
    recordDelivery(ctx.cwd, ticket.key, Date.now() - ctx.startTime);
  }

  return true;
}
