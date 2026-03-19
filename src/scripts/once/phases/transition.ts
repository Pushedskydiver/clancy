/**
 * Phase 8: Transition — move ticket to "In Progress" status (best-effort).
 *
 * Reads `ctx.config`, `ctx.ticket`. Returns `true` always (best-effort transition).
 */
import type { RunContext } from '../context/context.js';

export async function transition(ctx: RunContext): Promise<boolean> {
  const config = ctx.config!;
  const board = ctx.board!;
  const ticket = ctx.ticket!;

  const statusInProgress = config.env.CLANCY_STATUS_IN_PROGRESS;
  if (statusInProgress) {
    await board.transitionTicket(ticket, statusInProgress);
  }

  return true;
}
