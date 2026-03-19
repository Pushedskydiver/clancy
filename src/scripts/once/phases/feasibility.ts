/**
 * Phase 6: Feasibility check — skipped for rework tickets and --skip-feasibility.
 *
 * Returns `true` to continue, `false` for early exit (ticket not feasible).
 */
import { checkFeasibility } from '~/scripts/shared/feasibility/feasibility.js';
import { appendProgress } from '~/scripts/shared/progress/progress.js';
import { dim, green, yellow } from '~/utils/ansi/ansi.js';

import type { RunContext } from '../context/context.js';

export function feasibility(ctx: RunContext): boolean {
  const config = ctx.config!;
  const ticket = ctx.ticket!;

  if (!ctx.isRework && !ctx.skipFeasibility) {
    console.log(dim('  Checking feasibility...'));
    const result = checkFeasibility(
      {
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
      },
      config.env.CLANCY_MODEL,
    );

    if (!result.feasible) {
      const reason = result.reason ?? 'not implementable as code changes';
      console.log(yellow(`⏭️ Ticket skipped [${ticket.key}]: ${reason}`));
      appendProgress(ctx.cwd, ticket.key, ticket.title, 'SKIPPED');
      return false;
    }

    console.log(green('  ✓ Feasibility check passed'));
  }
  console.log('');

  return true;
}
