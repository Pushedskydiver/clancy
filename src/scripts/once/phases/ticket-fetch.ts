/**
 * Phase 4: Ticket fetch — fresh ticket fetch (if no rework), max rework guard,
 * compute branches, and print ticket info.
 *
 * Sets `ctx.ticket`, `ctx.baseBranch`, `ctx.ticketBranch`, `ctx.targetBranch`, `ctx.hasParent`.
 * Returns `true` to continue, `false` for early exit.
 */
import {
  computeTargetBranch,
  computeTicketBranch,
} from '~/scripts/shared/branch/branch.js';
import { sharedEnv } from '~/scripts/shared/env-schema/env-schema.js';
import {
  appendProgress,
  countReworkCycles,
} from '~/scripts/shared/progress/progress.js';
import { bold, dim, yellow } from '~/utils/ansi/ansi.js';

import type { RunContext } from '../context/context.js';
import { fetchTicket } from '../fetch-ticket/fetch-ticket.js';

export async function ticketFetch(ctx: RunContext): Promise<boolean> {
  const config = ctx.config!;

  if (!ctx.ticket) {
    // Fresh ticket
    ctx.ticket = await fetchTicket(ctx.board!);
  }

  if (!ctx.ticket) {
    console.log(dim('No tickets found. All done!'));
    return false;
  }

  // Max rework guard
  if (ctx.isRework) {
    const parsed = parseInt(sharedEnv(config).CLANCY_MAX_REWORK ?? '3', 10);
    const maxRework = Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
    const cycles = countReworkCycles(ctx.cwd, ctx.ticket.key);

    if (cycles >= maxRework) {
      console.log(
        yellow(
          `⚠ ${ctx.ticket.key} has reached max rework cycles (${maxRework}) — needs human intervention`,
        ),
      );
      appendProgress(ctx.cwd, ctx.ticket.key, ctx.ticket.title, 'SKIPPED');
      return false;
    }
  }

  // Compute branches
  const baseBranch = config.env.CLANCY_BASE_BRANCH ?? 'main';
  const parent =
    ctx.ticket.parentInfo !== 'none' ? ctx.ticket.parentInfo : undefined;
  const ticketBranch = computeTicketBranch(config.provider, ctx.ticket.key);
  const targetBranch = computeTargetBranch(config.provider, baseBranch, parent);

  ctx.baseBranch = baseBranch;
  ctx.ticketBranch = ticketBranch;
  ctx.targetBranch = targetBranch;
  ctx.hasParent = ctx.ticket.parentInfo !== 'none';

  // Print ticket info
  const parentLabel = config.provider === 'github' ? 'Milestone' : 'Epic';
  console.log('');
  console.log(`🎫 ${bold(`[${ctx.ticket.key}]`)} ${ctx.ticket.title}`);
  console.log(
    dim(
      `  ${parentLabel}: ${ctx.ticket.parentInfo} | Branch: ${ticketBranch} → ${targetBranch}`,
    ),
  );
  if (config.provider !== 'github' && ctx.ticket.blockers !== 'None') {
    console.log(yellow(`  Blockers: ${ctx.ticket.blockers}`));
  }
  console.log('');

  return true;
}
