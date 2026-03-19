/**
 * Phase 1: Preflight — banner, preflight checks, board detection, validation, and ping.
 *
 * Sets `ctx.config`. Returns `true` to continue, `false` for early exit.
 */
import { createBoard } from '~/scripts/board/factory/factory.js';
import { detectBoard } from '~/scripts/shared/env-schema/env-schema.js';
import { runPreflight } from '~/scripts/shared/preflight/preflight.js';
import { bold, dim, green } from '~/utils/ansi/ansi.js';

import type { RunContext } from '../context/context.js';

export async function preflight(ctx: RunContext): Promise<boolean> {
  // Banner
  console.log(dim('┌──────────────────────────────────────┐'));
  console.log(
    dim('│') + bold('  🤖 Clancy — once mode              ') + dim('│'),
  );
  console.log(
    dim('│') + dim('  "Let\'s roll."                      ') + dim('│'),
  );
  console.log(dim('└──────────────────────────────────────┘'));
  console.log('');

  // 1. Preflight
  const preflightResult = runPreflight(ctx.cwd);

  if (!preflightResult.ok) {
    console.log(preflightResult.error);
    return false;
  }

  if (preflightResult.warning) {
    console.log(preflightResult.warning);
  }

  // 2. Detect board
  const boardResult = detectBoard(preflightResult.env!);

  if (typeof boardResult === 'string') {
    console.log(boardResult);
    return false;
  }

  const config = boardResult;
  const board = createBoard(config);

  // 3. Validate board-specific inputs
  const validationError = board.validateInputs();

  if (validationError) {
    console.log(validationError);
    return false;
  }

  // 4. Ping board
  const ping = await board.ping();

  if (!ping.ok) {
    console.log(ping.error);
    return false;
  }

  console.log(green('✅ Preflight passed'));

  ctx.config = config;
  ctx.board = board;
  return true;
}
