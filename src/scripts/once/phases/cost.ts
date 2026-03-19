/**
 * Phase 11: Cost logging — record duration + estimated tokens (best-effort).
 *
 * Reads lock file for `startedAt`, uses `ctx.config.env.CLANCY_TOKEN_RATE`.
 * Returns `true` always (cost logging failure never blocks completion).
 */
import type { RunContext } from '../context/context.js';
import { appendCostEntry } from '../cost/cost.js';
import { readLock } from '../lock/lock.js';

export function cost(ctx: RunContext): boolean {
  const config = ctx.config!;
  const ticket = ctx.ticket!;

  try {
    const lock = readLock(ctx.cwd);
    if (lock) {
      const tokenRate = Number(config.env.CLANCY_TOKEN_RATE ?? '6600');
      appendCostEntry(
        ctx.cwd,
        ticket.key,
        lock.startedAt,
        Number.isFinite(tokenRate) && tokenRate > 0 ? tokenRate : 6600,
      );
    }
  } catch {
    // Best-effort — cost logging failure shouldn't block completion
  }

  return true;
}
