/**
 * Phase 5: Dry-run gate — prints ticket info and exits when `--dry-run` is active.
 *
 * Returns `true` to continue, `false` for early exit (dry-run mode).
 */
import { bold, dim, yellow } from '~/utils/ansi/ansi.js';

import type { RunContext } from '../context/context.js';

export function dryRun(ctx: RunContext): boolean {
  if (!ctx.dryRun) return true;

  const config = ctx.config!;
  const ticket = ctx.ticket!;
  const ticketBranch = ctx.ticketBranch!;
  const targetBranch = ctx.targetBranch!;

  const parentLabel = config.provider === 'github' ? 'Milestone' : 'Epic';
  console.log('');
  console.log(yellow('── Dry Run ──────────────────────────────────────'));
  console.log(`  Ticket:         ${bold(`[${ticket.key}]`)} ${ticket.title}`);
  if (ctx.isRework) {
    console.log(`  Mode:           Rework`);
  }
  console.log(
    `  ${parentLabel}:${' '.repeat(14 - parentLabel.length)}${ticket.parentInfo}`,
  );
  if (config.provider !== 'github') {
    console.log(`  Blockers:       ${ticket.blockers}`);
  }
  console.log(`  Target branch:  ${ticketBranch} → ${targetBranch}`);
  if (ticket.description) {
    console.log(`  Description:    ${ticket.description}`);
  }
  console.log(yellow('─────────────────────────────────────────────────'));
  console.log(dim('  No changes made. Remove --dry-run to run for real.'));
  return false;
}
