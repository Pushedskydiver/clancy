/**
 * Phase 3: Rework detection — PR-based rework detection.
 *
 * Sets `ctx.isRework`, `ctx.ticket`, `ctx.prFeedback`, `ctx.reworkPrNumber`,
 * `ctx.reworkDiscussionIds`, `ctx.reworkReviewers`. Always returns `true`.
 */
import { yellow } from '~/utils/ansi/ansi.js';

import type { RunContext } from '../context/context.js';
import { fetchReworkFromPrReview } from '../rework/rework.js';

export async function reworkDetection(ctx: RunContext): Promise<boolean> {
  const config = ctx.config!;

  // PR-based rework (automatic, no config needed)
  try {
    const prRework = await fetchReworkFromPrReview(config);
    if (prRework) {
      ctx.isRework = true;
      ctx.ticket = prRework.ticket;
      ctx.prFeedback = prRework.feedback;
      ctx.reworkPrNumber = prRework.prNumber;
      ctx.reworkDiscussionIds = prRework.discussionIds;
      ctx.reworkReviewers = prRework.reviewers;
      console.log(
        yellow(`  ↻ PR rework: [${ctx.ticket.key}] ${ctx.ticket.title}`),
      );
    }
  } catch {
    // Best-effort — fall through to fresh ticket
  }

  return true;
}
