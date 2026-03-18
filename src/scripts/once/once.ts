/**
 * Unified once orchestrator — replaces all three `clancy-once-*.sh` scripts.
 *
 * Full lifecycle: preflight → detect board → fetch ticket → compute branches →
 * [dry-run gate] → feasibility check → create branch → transition In Progress →
 * invoke Claude → squash merge → transition Done → log → notify.
 *
 * All errors exit with code 0 (not 1). This is intentional — the AFK runner
 * detects stop conditions by parsing stdout, not exit codes.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeTargetBranch,
  computeTicketBranch,
} from '~/scripts/shared/branch/branch.js';
import { invokeClaudeSession } from '~/scripts/shared/claude-cli/claude-cli.js';
import { detectBoard } from '~/scripts/shared/env-schema/env-schema.js';
import { checkFeasibility } from '~/scripts/shared/feasibility/feasibility.js';
import { formatDuration } from '~/scripts/shared/format/format.js';
import {
  checkout,
  currentBranch,
  diffAgainstBranch,
  ensureBranch,
  fetchRemoteBranch,
} from '~/scripts/shared/git-ops/git-ops.js';
import { sendNotification } from '~/scripts/shared/notify/notify.js';
import { runPreflight } from '~/scripts/shared/preflight/preflight.js';
import {
  appendProgress,
  countReworkCycles,
} from '~/scripts/shared/progress/progress.js';
import {
  buildPrompt,
  buildReworkPrompt,
} from '~/scripts/shared/prompt/prompt.js';
import { bold, dim, green, red, yellow } from '~/utils/ansi/ansi.js';

import {
  pingBoard,
  sharedEnv,
  transitionToStatus,
  validateInputs,
} from './board-ops/board-ops.js';
import {
  deliverViaEpicMerge,
  deliverViaPullRequest,
} from './deliver/deliver.js';
import { fetchTicket } from './fetch-ticket/fetch-ticket.js';
import { fetchReworkFromPrReview, postReworkActions } from './rework/rework.js';
import type { FetchedTicket } from './types/types.js';

// ─── Main orchestrator ───────────────────────────────────────────────────────

/**
 * Run the once orchestrator — full ticket lifecycle.
 *
 * @param argv - Process arguments (supports `--dry-run` flag).
 *
 * @example
 * ```ts
 * await run(process.argv);
 * ```
 */
export async function run(argv: string[]): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const skipFeasibility = argv.includes('--skip-feasibility');

  const startTime = Date.now();

  console.log(dim('┌──────────────────────────────────────┐'));
  console.log(
    dim('│') + bold('  🤖 Clancy — once mode              ') + dim('│'),
  );
  console.log(
    dim('│') + dim('  "Let\'s roll."                      ') + dim('│'),
  );
  console.log(dim('└──────────────────────────────────────┘'));
  console.log('');

  let originalBranch: string | undefined;

  try {
    // 1. Preflight
    const preflight = runPreflight(process.cwd());

    if (!preflight.ok) {
      console.log(preflight.error);
      return;
    }

    if (preflight.warning) {
      console.log(preflight.warning);
    }

    // 2. Detect board
    const boardResult = detectBoard(preflight.env!);

    if (typeof boardResult === 'string') {
      console.log(boardResult);
      return;
    }

    const config = boardResult;

    // 3. Validate board-specific inputs
    const validationError = validateInputs(config);

    if (validationError) {
      console.log(validationError);
      return;
    }

    // 4. Ping board
    const ping = await pingBoard(config);

    if (!ping.ok) {
      console.log(ping.error);
      return;
    }

    console.log(green('✅ Preflight passed'));

    // 5. Check rework — PR-based detection, then fresh ticket
    let isRework = false;
    let prFeedback: string[] | undefined;
    let reworkPrNumber: number | undefined;
    let reworkDiscussionIds: string[] | undefined;
    let reworkReviewers: string[] | undefined;
    let ticket: FetchedTicket | undefined;

    // PR-based rework (automatic, no config needed)
    try {
      const prRework = await fetchReworkFromPrReview(config);
      if (prRework) {
        isRework = true;
        ticket = prRework.ticket;
        prFeedback = prRework.feedback;
        reworkPrNumber = prRework.prNumber;
        reworkDiscussionIds = prRework.discussionIds;
        reworkReviewers = prRework.reviewers;
        console.log(yellow(`  ↻ PR rework: [${ticket.key}] ${ticket.title}`));
      }
    } catch {
      // Best-effort — fall through to fresh ticket
    }

    if (!ticket) {
      // Fresh ticket
      ticket = await fetchTicket(config);
    }

    if (!ticket) {
      console.log(dim('No tickets found. All done!'));
      return;
    }

    // 5a. Max rework guard
    if (isRework) {
      const parsed = parseInt(sharedEnv(config).CLANCY_MAX_REWORK ?? '3', 10);
      const maxRework = Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
      const cycles = countReworkCycles(process.cwd(), ticket.key);

      if (cycles >= maxRework) {
        console.log(
          yellow(
            `⚠ ${ticket.key} has reached max rework cycles (${maxRework}) — needs human intervention`,
          ),
        );
        appendProgress(process.cwd(), ticket.key, ticket.title, 'SKIPPED');
        return;
      }
    }

    // 6. Compute branches
    const baseBranch = config.env.CLANCY_BASE_BRANCH ?? 'main';
    const parent = ticket.parentInfo !== 'none' ? ticket.parentInfo : undefined;
    const ticketBranch = computeTicketBranch(config.provider, ticket.key);
    const targetBranch = computeTargetBranch(
      config.provider,
      baseBranch,
      parent,
    );

    // 7. Dry-run gate
    if (dryRun) {
      const parentLabel = config.provider === 'github' ? 'Milestone' : 'Epic';
      console.log('');
      console.log(yellow('── Dry Run ──────────────────────────────────────'));
      console.log(
        `  Ticket:         ${bold(`[${ticket.key}]`)} ${ticket.title}`,
      );
      if (isRework) {
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
      return;
    }

    // 8. Print ticket info
    const parentLabel = config.provider === 'github' ? 'Milestone' : 'Epic';
    console.log('');
    console.log(`🎫 ${bold(`[${ticket.key}]`)} ${ticket.title}`);
    console.log(
      dim(
        `  ${parentLabel}: ${ticket.parentInfo} | Branch: ${ticketBranch} → ${targetBranch}`,
      ),
    );
    if (config.provider !== 'github' && ticket.blockers !== 'None') {
      console.log(yellow(`  Blockers: ${ticket.blockers}`));
    }
    console.log('');

    // 9. Feasibility check (skipped for rework tickets and --skip-feasibility)
    if (!isRework && !skipFeasibility) {
      console.log(dim('  Checking feasibility...'));
      const feasibility = checkFeasibility(
        {
          key: ticket.key,
          title: ticket.title,
          description: ticket.description,
        },
        config.env.CLANCY_MODEL,
      );

      if (!feasibility.feasible) {
        const reason =
          feasibility.reason ?? 'not implementable as code changes';
        console.log(yellow(`⏭️ Ticket skipped [${ticket.key}]: ${reason}`));
        appendProgress(process.cwd(), ticket.key, ticket.title, 'SKIPPED');
        return;
      }

      console.log(green('  ✓ Feasibility check passed'));
    }
    console.log('');

    // 10. Git: set up branches
    originalBranch = currentBranch();

    if (isRework) {
      // PR-flow rework: try to fetch the existing feature branch from remote
      ensureBranch(targetBranch, baseBranch);
      const fetched = fetchRemoteBranch(ticketBranch);

      if (fetched) {
        checkout(ticketBranch);
      } else {
        // Branch missing from remote — create fresh branch from target
        checkout(targetBranch);
        checkout(ticketBranch, true);
      }
    } else {
      // Normal flow
      ensureBranch(targetBranch, baseBranch);
      checkout(targetBranch);
      checkout(ticketBranch, true);
    }

    // 11. Transition to In Progress (best-effort)
    const statusInProgress = config.env.CLANCY_STATUS_IN_PROGRESS;
    if (statusInProgress) {
      await transitionToStatus(config, ticket, statusInProgress);
    }

    // 12. Build prompt and invoke Claude
    let prompt: string;

    const tdd = config.env.CLANCY_TDD === 'true';

    if (isRework) {
      prompt = buildReworkPrompt({
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
        provider: config.provider,
        feedbackComments: prFeedback ?? [],
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

    const claudeOk = invokeClaudeSession(prompt, config.env.CLANCY_MODEL);

    if (!claudeOk) {
      console.log(
        yellow('⚠ Claude session exited with an error. Skipping merge.'),
      );
      return;
    }

    // 13. Deliver — epic merge or PR flow
    const hasParent = ticket.parentInfo !== 'none';

    if (isRework) {
      // PR-flow rework: push to existing branch, PR updates automatically
      const delivered = await deliverViaPullRequest(
        config,
        ticket,
        ticketBranch,
        targetBranch,
        startTime,
        true,
      );
      if (!delivered) {
        appendProgress(process.cwd(), ticket.key, ticket.title, 'PUSH_FAILED');
        return;
      }

      // Log single REWORK entry (skipLog prevents deliverViaPullRequest from double-logging)
      appendProgress(
        process.cwd(),
        ticket.key,
        ticket.title,
        'REWORK',
        reworkPrNumber,
      );

      // Post-rework actions (all best-effort)
      if (reworkPrNumber != null) {
        await postReworkActions(
          config,
          reworkPrNumber,
          prFeedback ?? [],
          reworkDiscussionIds,
          reworkReviewers,
        );
      }
    } else if (hasParent) {
      await deliverViaEpicMerge(config, ticket, ticketBranch, targetBranch);
    } else {
      const delivered = await deliverViaPullRequest(
        config,
        ticket,
        ticketBranch,
        targetBranch,
        startTime,
      );
      if (!delivered) return;
    }

    const elapsed = formatDuration(Date.now() - startTime);
    console.log('');
    console.log(green(`🏁 ${ticket.key} complete`) + dim(` (${elapsed})`));
    console.log(dim('  "Bake \'em away, toys."'));

    // 14. Send notification (best-effort)
    const webhook = config.env.CLANCY_NOTIFY_WEBHOOK;

    if (webhook) {
      await sendNotification(
        webhook,
        `✓ Clancy completed [${ticket.key}] ${ticket.title}`,
      );
    }
  } catch (error) {
    // Unexpected errors — print and exit cleanly (exit 0 for AFK loop compat)
    const msg = error instanceof Error ? error.message : String(error);
    const elapsed = formatDuration(Date.now() - startTime);
    console.error('');
    console.error(red(`❌ Clancy stopped`) + dim(` (${elapsed})`));
    console.error(red(`   ${msg}`));
    console.error(dim('  "I\'d rather let Herman go."'));

    // Best-effort: restore the branch the user was on before Clancy started
    if (originalBranch) {
      try {
        checkout(originalBranch);
      } catch {
        // Ignore — branch restore is best-effort
      }
    }
  }
}

// Main guard — self-execute when run directly (e.g. node .clancy/clancy-once.js)
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  run(process.argv);
}
