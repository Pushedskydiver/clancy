/**
 * Phase 12: Cleanup — completion print + notification (best-effort).
 *
 * Reads `ctx.config`, `ctx.ticket`, `ctx.startTime`.
 * Returns `true` always.
 */
import { formatDuration } from '~/scripts/shared/format/format.js';
import { sendNotification } from '~/scripts/shared/notify/notify.js';
import { dim, green } from '~/utils/ansi/ansi.js';

import type { RunContext } from '../context/context.js';

export async function cleanup(ctx: RunContext): Promise<boolean> {
  const config = ctx.config!;
  const ticket = ctx.ticket!;

  const elapsed = formatDuration(Date.now() - ctx.startTime);
  console.log('');
  console.log(green(`🏁 ${ticket.key} complete`) + dim(` (${elapsed})`));
  console.log(dim('  "Bake \'em away, toys."'));

  // Send notification (best-effort)
  const webhook = config.env.CLANCY_NOTIFY_WEBHOOK;

  if (webhook) {
    await sendNotification(
      webhook,
      `✓ Clancy completed [${ticket.key}] ${ticket.title}`,
    );
  }

  return true;
}
