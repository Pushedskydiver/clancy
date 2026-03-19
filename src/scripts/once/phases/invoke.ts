/**
 * Phase 9: Invoke — build prompt and run Claude session.
 *
 * Reads `ctx.config`, `ctx.ticket`, `ctx.isRework`, `ctx.prFeedback`,
 * `ctx.targetBranch`. Derives `tdd` from `ctx.config.env.CLANCY_TDD`.
 * Sets `process.env.CLANCY_ONCE_ACTIVE` during the session.
 * Returns `true` if Claude succeeds, `false` otherwise.
 */
import { invokeClaudeSession } from '~/scripts/shared/claude-cli/claude-cli.js';
import { diffAgainstBranch } from '~/scripts/shared/git-ops/git-ops.js';
import {
  buildPrompt,
  buildReworkPrompt,
} from '~/scripts/shared/prompt/prompt.js';
import { yellow } from '~/utils/ansi/ansi.js';

import type { RunContext } from '../context/context.js';

export function invoke(ctx: RunContext): boolean {
  const config = ctx.config!;
  const ticket = ctx.ticket!;
  const isRework = ctx.isRework ?? false;
  const targetBranch = ctx.targetBranch!;
  const tdd = config.env.CLANCY_TDD === 'true';

  let prompt: string;

  if (isRework) {
    prompt = buildReworkPrompt({
      key: ticket.key,
      title: ticket.title,
      description: ticket.description,
      provider: config.provider,
      feedbackComments: ctx.prFeedback ?? [],
      previousContext: diffAgainstBranch(targetBranch),
      tdd,
    });
  } else {
    prompt = buildPrompt({
      provider: config.provider,
      key: ticket.key,
      title: ticket.title,
      description: ticket.description,
      parentInfo: ticket.parentInfo,
      blockers: config.provider !== 'github' ? ticket.blockers : undefined,
      tdd,
    });
  }

  // Set CLANCY_ONCE_ACTIVE for hooks (verification gate, etc.)
  process.env.CLANCY_ONCE_ACTIVE = '1';
  let claudeOk: boolean;
  try {
    claudeOk = invokeClaudeSession(prompt, config.env.CLANCY_MODEL);
  } finally {
    delete process.env.CLANCY_ONCE_ACTIVE;
  }

  if (!claudeOk) {
    console.log(
      yellow('⚠ Claude session exited with an error. Skipping merge.'),
    );
    return false;
  }

  return true;
}
