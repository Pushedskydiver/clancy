/**
 * Phase 8: Transition — move ticket to "In Progress" status (best-effort).
 *
 * Reads `ctx.config`, `ctx.ticket`. Returns `true` always (best-effort transition).
 */
import { transitionToStatus } from '../board-ops/board-ops.js';
import type { RunContext } from '../context/context.js';

export async function transition(ctx: RunContext): Promise<boolean> {
  const config = ctx.config!;
  const ticket = ctx.ticket!;

  const statusInProgress = config.env.CLANCY_STATUS_IN_PROGRESS;
  if (statusInProgress) {
    await transitionToStatus(config, ticket, statusInProgress);
  }

  return true;
}
