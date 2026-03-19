/**
 * Unified once orchestrator — replaces all three `clancy-once-*.sh` scripts.
 *
 * Full lifecycle: lock check → preflight → detect board → [epic completion check] →
 * fetch ticket → compute branches → [dry-run gate] → feasibility check →
 * create branch → write lock → transition In Progress → invoke Claude → push + PR →
 * cost log → delete lock → notify.
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
  findEntriesWithStatus,
} from '~/scripts/shared/progress/progress.js';
import {
  buildPrompt,
  buildReworkPrompt,
} from '~/scripts/shared/prompt/prompt.js';
import { bold, dim, green, red, yellow } from '~/utils/ansi/ansi.js';

import {
  fetchEpicChildrenStatus,
  pingBoard,
  sharedEnv,
  transitionToStatus,
  validateInputs,
} from './board-ops/board-ops.js';
import { appendCostEntry } from './cost/cost.js';
import {
  deliverEpicToBase,
  deliverViaPullRequest,
  ensureEpicBranch,
} from './deliver/deliver.js';
import { fetchTicket } from './fetch-ticket/fetch-ticket.js';
import {
  deleteLock,
  deleteVerifyAttempt,
  isLockStale,
  readLock,
  writeLock,
} from './lock/lock.js';
import { detectResume, executeResume } from './resume/resume.js';
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

  // ── 0. Startup lock check ──────────────────────────────────────────────
  // If a lock file exists from a previous run, check if it's still active
  // or stale (crashed session). Only proceed if we can claim the lock.
  let lockOwner = false;

  const existingLock = readLock(process.cwd());
  if (existingLock) {
    if (!isLockStale(existingLock)) {
      // Another active session — abort
      console.log(
        yellow(
          `⚠ Another Clancy session is running (PID ${existingLock.pid}, ticket ${existingLock.ticketKey}). Aborting.`,
        ),
      );
      return;
    }

    // Stale lock — clean up and check for resume
    console.log(
      dim(
        `  Stale lock found (PID ${existingLock.pid}, ticket ${existingLock.ticketKey}). Cleaning up...`,
      ),
    );
    deleteLock(process.cwd());
    deleteVerifyAttempt(process.cwd());

    // Resume detection — check if the ticket branch has recoverable work
    try {
      const resumeInfo = detectResume(existingLock);
      if (resumeInfo) {
        const isAfk = process.env.CLANCY_AFK_MODE === '1';
        if (isAfk) {
          console.log(
            yellow(
              `  ↻ Resuming crashed session: ${existingLock.ticketKey} on ${resumeInfo.branch}`,
            ),
          );

          // Need board config for PR creation — run preflight + detect board
          const preflight = runPreflight(process.cwd());
          if (preflight.ok) {
            const boardResult = detectBoard(preflight.env!);
            if (typeof boardResult !== 'string') {
              const resumed = await executeResume(
                boardResult,
                existingLock,
                resumeInfo,
              );
              if (resumed) {
                console.log(
                  green(
                    `  ✓ Resumed ${existingLock.ticketKey} — continuing to next ticket`,
                  ),
                );
              }
            }
          }
        } else {
          console.log(
            yellow(
              `  Found in-progress work on ${resumeInfo.branch}.` +
                (resumeInfo.hasUncommitted ? ' Has uncommitted changes.' : '') +
                (resumeInfo.hasUnpushed ? ' Has unpushed commits.' : ''),
            ),
          );
          console.log(
            dim(
              '  Run in AFK mode (CLANCY_AFK_MODE=1) to auto-resume, or handle manually.',
            ),
          );
        }
      }
    } catch {
      // Best-effort — resume detection failure shouldn't block the run
    }
  }

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

    // 4a. Epic completion check — scan for epics whose children are all done
    // This runs at the START of each iteration to catch epics where child PRs
    // were merged since the last run. The check cannot run after child delivery
    // because the just-delivered child is still "In Review", not "Done".
    // Best-effort — errors are swallowed so the run continues.
    try {
      const prEntries = findEntriesWithStatus(process.cwd(), 'PR_CREATED');
      const reworkEntries = findEntriesWithStatus(process.cwd(), 'REWORK');
      const pushedEntries = findEntriesWithStatus(process.cwd(), 'PUSHED');
      const allEntries = [...prEntries, ...reworkEntries, ...pushedEntries];

      // Skip epics that already have an EPIC_PR_CREATED entry
      const epicDone = new Set(
        findEntriesWithStatus(process.cwd(), 'EPIC_PR_CREATED').map(
          (e) => e.key,
        ),
      );

      const parentKeys = new Set(
        allEntries
          .map((e) => e.parent)
          .filter((p): p is string => Boolean(p))
          .filter((p) => !epicDone.has(p)),
      );
      const baseBranch = config.env.CLANCY_BASE_BRANCH ?? 'main';

      for (const parentKey of parentKeys) {
        const status = await fetchEpicChildrenStatus(config, parentKey);
        if (status && status.incomplete === 0 && status.total > 0) {
          const epicBranch = computeTargetBranch(
            config.provider,
            baseBranch,
            parentKey,
          );

          const epicOk = await deliverEpicToBase(
            config,
            parentKey,
            parentKey, // title fallback — see WARNING #4 in review
            epicBranch,
            baseBranch,
          );

          if (epicOk) {
            console.log(green(`  ✓ Epic ${parentKey} complete — PR created`));
          } else {
            console.log(
              yellow(
                `⚠ Epic PR creation failed for ${parentKey}. Create manually:\n` +
                  `  git push origin ${epicBranch}\n` +
                  `  Then create a PR targeting ${baseBranch}`,
              ),
            );
          }
        }
      }
    } catch {
      // Best-effort — epic completion check failure shouldn't block the run
    }

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
    const hasParent = ticket.parentInfo !== 'none';

    // Single-child skip: if epic has exactly 1 child and this is it,
    // skip the epic branch and deliver directly to base.
    let skipEpicBranch = false;
    if (hasParent && !isRework) {
      const childrenStatus = await fetchEpicChildrenStatus(
        config,
        ticket.parentInfo,
        ticket.linearIssueId,
      );
      if (childrenStatus && childrenStatus.total === 1) {
        skipEpicBranch = true;
      }
    }

    // Effective target: epic branch (parented) or base branch (standalone/single-child)
    const effectiveTarget =
      hasParent && !skipEpicBranch ? targetBranch : baseBranch;

    if (isRework) {
      // PR-flow rework: try to fetch the existing feature branch from remote
      if (hasParent && !skipEpicBranch) {
        // Ensure epic branch exists for rework targeting it
        const epicReady = ensureEpicBranch(targetBranch, baseBranch);
        if (!epicReady) {
          if (originalBranch) checkout(originalBranch);
          return;
        }
      } else {
        ensureBranch(effectiveTarget, baseBranch);
      }
      const fetched = fetchRemoteBranch(ticketBranch);

      if (fetched) {
        checkout(ticketBranch);
      } else {
        checkout(effectiveTarget);
        checkout(ticketBranch, true);
      }
    } else if (hasParent && !skipEpicBranch) {
      // Epic branch flow: ensure epic branch, create feature from it
      const epicReady = ensureEpicBranch(targetBranch, baseBranch);
      if (!epicReady) {
        if (originalBranch) checkout(originalBranch);
        return;
      }
      checkout(targetBranch);
      checkout(ticketBranch, true);
    } else {
      // Standalone or single-child: branch from base
      ensureBranch(baseBranch, baseBranch);
      checkout(baseBranch);
      checkout(ticketBranch, true);
    }

    // 10a. Write lock file — branch is now known
    try {
      writeLock(process.cwd(), {
        pid: process.pid,
        ticketKey: ticket.key,
        ticketTitle: ticket.title,
        ticketBranch: ticketBranch,
        targetBranch: effectiveTarget,
        parentKey: ticket.parentInfo,
        startedAt: new Date().toISOString(),
      });
      lockOwner = true;
    } catch {
      // Best-effort — continue without crash protection
      console.log(
        dim('  (warning: could not write lock file — crash recovery disabled)'),
      );
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
      return;
    }

    // 13. Deliver — all paths use PR flow (targeting epic branch or base branch)
    const parentKey =
      hasParent && !skipEpicBranch ? ticket.parentInfo : undefined;

    if (isRework) {
      // PR-flow rework: push to existing branch, PR updates automatically
      const delivered = await deliverViaPullRequest(
        config,
        ticket,
        ticketBranch,
        effectiveTarget,
        startTime,
        true,
        parentKey,
      );
      if (!delivered) {
        appendProgress(
          process.cwd(),
          ticket.key,
          ticket.title,
          'PUSH_FAILED',
          undefined,
          parentKey,
        );
        return;
      }

      // Log single REWORK entry (skipLog prevents deliverViaPullRequest from double-logging)
      appendProgress(
        process.cwd(),
        ticket.key,
        ticket.title,
        'REWORK',
        reworkPrNumber,
        parentKey,
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
    } else {
      // Fresh ticket: deliver via PR (to epic branch or base branch)
      const delivered = await deliverViaPullRequest(
        config,
        ticket,
        ticketBranch,
        effectiveTarget,
        startTime,
        false,
        parentKey,
      );
      if (!delivered) return;
    }

    // 13a. Cost logging — record duration + estimated tokens
    try {
      const lock = readLock(process.cwd());
      if (lock) {
        const tokenRate = parseInt(config.env.CLANCY_TOKEN_RATE ?? '6600', 10);
        appendCostEntry(
          process.cwd(),
          ticket.key,
          lock.startedAt,
          Number.isFinite(tokenRate) && tokenRate > 0 ? tokenRate : 6600,
        );
      }
    } catch {
      // Best-effort — cost logging failure shouldn't block completion
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
  } finally {
    // Clean up lock + verify-attempt in ALL exit paths (only if we created them)
    if (lockOwner) {
      deleteLock(process.cwd());
      deleteVerifyAttempt(process.cwd());
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
