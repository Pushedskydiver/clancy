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
  closeIssue,
  fetchIssue as fetchGitHubIssue,
  isValidRepo,
  pingGitHub,
} from '~/scripts/board/github/github.js';
import {
  buildAuthHeader,
  fetchTicket as fetchJiraTicket,
  isSafeJqlValue,
  pingJira,
  transitionIssue as transitionJiraIssue,
} from '~/scripts/board/jira/jira.js';
import {
  fetchIssue as fetchLinearIssue,
  isValidTeamId,
  pingLinear,
  transitionIssue as transitionLinearIssue,
} from '~/scripts/board/linear/linear.js';
import {
  computeTargetBranch,
  computeTicketBranch,
} from '~/scripts/shared/branch/branch.js';
import { invokeClaudeSession } from '~/scripts/shared/claude-cli/claude-cli.js';
import { detectBoard } from '~/scripts/shared/env-schema/env-schema.js';
import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';
import { checkFeasibility } from '~/scripts/shared/feasibility/feasibility.js';
import {
  checkout,
  currentBranch,
  deleteBranch,
  ensureBranch,
  squashMerge,
} from '~/scripts/shared/git-ops/git-ops.js';
import { sendNotification } from '~/scripts/shared/notify/notify.js';
import { runPreflight } from '~/scripts/shared/preflight/preflight.js';
import { appendProgress } from '~/scripts/shared/progress/progress.js';
import { buildPrompt } from '~/scripts/shared/prompt/prompt.js';
import { bold, dim, green, red, yellow } from '~/utils/ansi/ansi.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type FetchedTicket = {
  key: string;
  title: string;
  description: string;
  parentInfo: string;
  blockers: string;
  /** Linear internal issue ID — needed for state transitions. */
  linearIssueId?: string;
};

// ─── Board-specific fetch ────────────────────────────────────────────────────

async function fetchTicket(
  config: BoardConfig,
): Promise<FetchedTicket | undefined> {
  switch (config.provider) {
    case 'jira': {
      const { env } = config;
      const auth = buildAuthHeader(env.JIRA_USER, env.JIRA_API_TOKEN);
      const ticket = await fetchJiraTicket(
        env.JIRA_BASE_URL,
        auth,
        env.JIRA_PROJECT_KEY,
        env.CLANCY_JQL_STATUS ?? 'To Do',
        env.CLANCY_JQL_SPRINT,
        env.CLANCY_LABEL,
      );

      if (!ticket) return undefined;

      const blockerStr = ticket.blockers.length
        ? `Blocked by: ${ticket.blockers.join(', ')}`
        : 'None';

      return {
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
        parentInfo: ticket.epicKey ?? 'none',
        blockers: blockerStr,
      };
    }

    case 'github': {
      const { env } = config;
      const ticket = await fetchGitHubIssue(
        env.GITHUB_TOKEN,
        env.GITHUB_REPO,
        env.CLANCY_LABEL,
      );

      if (!ticket) return undefined;

      return {
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
        parentInfo: ticket.milestone ?? 'none',
        blockers: 'None',
      };
    }

    case 'linear': {
      const { env } = config;
      const ticket = await fetchLinearIssue({
        LINEAR_API_KEY: env.LINEAR_API_KEY,
        LINEAR_TEAM_ID: env.LINEAR_TEAM_ID,
        CLANCY_LABEL: env.CLANCY_LABEL,
      });

      if (!ticket) return undefined;

      return {
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
        parentInfo: ticket.parentIdentifier ?? 'none',
        blockers: 'None',
        linearIssueId: ticket.issueId,
      };
    }
  }
}

// ─── Board-specific ping ─────────────────────────────────────────────────────

async function pingBoard(
  config: BoardConfig,
): Promise<{ ok: boolean; error?: string }> {
  switch (config.provider) {
    case 'jira': {
      const { env } = config;
      const auth = buildAuthHeader(env.JIRA_USER, env.JIRA_API_TOKEN);
      return pingJira(env.JIRA_BASE_URL, env.JIRA_PROJECT_KEY, auth);
    }

    case 'github':
      return pingGitHub(config.env.GITHUB_TOKEN, config.env.GITHUB_REPO);

    case 'linear':
      return pingLinear(config.env.LINEAR_API_KEY);
  }
}

// ─── Board-specific validation ───────────────────────────────────────────────

function validateInputs(config: BoardConfig): string | undefined {
  switch (config.provider) {
    case 'jira': {
      const { env } = config;
      if (!isSafeJqlValue(env.JIRA_PROJECT_KEY)) {
        return '✗ JIRA_PROJECT_KEY contains invalid characters';
      }
      if (env.CLANCY_LABEL && !isSafeJqlValue(env.CLANCY_LABEL)) {
        return '✗ CLANCY_LABEL contains invalid characters';
      }
      if (env.CLANCY_JQL_STATUS && !isSafeJqlValue(env.CLANCY_JQL_STATUS)) {
        return '✗ CLANCY_JQL_STATUS contains invalid characters';
      }
      return undefined;
    }

    case 'github': {
      if (!isValidRepo(config.env.GITHUB_REPO)) {
        return '✗ GITHUB_REPO format is invalid — expected owner/repo';
      }
      return undefined;
    }

    case 'linear': {
      if (!isValidTeamId(config.env.LINEAR_TEAM_ID)) {
        return '✗ LINEAR_TEAM_ID contains invalid characters';
      }
      return undefined;
    }
  }
}

// ─── Board-specific transitions ──────────────────────────────────────────────

async function transitionToStatus(
  config: BoardConfig,
  ticket: FetchedTicket,
  statusName: string,
): Promise<void> {
  switch (config.provider) {
    case 'jira': {
      const { env } = config;
      const auth = buildAuthHeader(env.JIRA_USER, env.JIRA_API_TOKEN);
      const issueKey = ticket.key;
      const ok = await transitionJiraIssue(
        env.JIRA_BASE_URL,
        auth,
        issueKey,
        statusName,
      );
      if (ok) console.log(`  → Transitioned to ${statusName}`);
      break;
    }

    case 'github': {
      // GitHub Issues only has open/closed — status transitions not applicable
      // closeIssue is called separately after merge
      break;
    }

    case 'linear': {
      const { env } = config;
      if (!ticket.linearIssueId) break;
      const ok = await transitionLinearIssue(
        env.LINEAR_API_KEY,
        env.LINEAR_TEAM_ID,
        ticket.linearIssueId,
        statusName,
      );
      if (ok) console.log(`  → Transitioned to ${statusName}`);
      break;
    }
  }
}

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

    // 5. Fetch ticket
    const ticket = await fetchTicket(config);

    if (!ticket) {
      console.log(dim('No tickets found. All done!'));
      return;
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

    // 9. Feasibility check (skipped when --skip-feasibility is passed;
    //    the workflow handles feasibility evaluation directly in that case)
    if (!skipFeasibility) {
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
    ensureBranch(targetBranch, baseBranch);
    checkout(targetBranch);
    checkout(ticketBranch, true);

    // 11. Transition to In Progress (best-effort)
    const statusInProgress = config.env.CLANCY_STATUS_IN_PROGRESS;
    if (statusInProgress) {
      await transitionToStatus(config, ticket, statusInProgress);
    }

    // 12. Build prompt and invoke Claude
    const prompt = buildPrompt({
      provider: config.provider,
      key: ticket.key,
      title: ticket.title,
      description: ticket.description,
      parentInfo: ticket.parentInfo,
      blockers: config.provider !== 'github' ? ticket.blockers : undefined,
    });

    const claudeOk = invokeClaudeSession(prompt, config.env.CLANCY_MODEL);

    if (!claudeOk) {
      console.log(
        yellow('⚠ Claude session exited with an error. Skipping merge.'),
      );
      return;
    }

    // 13. Squash merge
    checkout(targetBranch);
    const commitMsg = `feat(${ticket.key}): ${ticket.title}`;
    const hadChanges = squashMerge(ticketBranch, commitMsg);

    if (!hadChanges) {
      console.log(
        yellow(
          '⚠ No changes staged after squash merge. Claude may not have committed any work.',
        ),
      );
    }

    // 14. Delete feature branch
    deleteBranch(ticketBranch);

    // 15. Transition to Done / close issue (best-effort)
    const statusDone = config.env.CLANCY_STATUS_DONE;

    if (config.provider === 'github') {
      const issueNumber = parseInt(ticket.key.replace('#', ''), 10);

      if (Number.isNaN(issueNumber)) {
        console.log(
          `⚠ Could not parse issue number from ${ticket.key}. Close it manually on GitHub.`,
        );
      } else {
        const closed = await closeIssue(
          config.env.GITHUB_TOKEN,
          config.env.GITHUB_REPO,
          issueNumber,
        );
        if (!closed) {
          console.log(
            `⚠ Could not close issue ${ticket.key}. Close it manually on GitHub.`,
          );
        }
      }
    } else if (statusDone) {
      await transitionToStatus(config, ticket, statusDone);
    }

    // 16. Log progress
    appendProgress(process.cwd(), ticket.key, ticket.title, 'DONE');

    const elapsed = formatDuration(Date.now() - startTime);
    console.log('');
    console.log(green(`🏁 ${ticket.key} complete`) + dim(` (${elapsed})`));
    console.log(dim('  "Bake \'em away, toys."'));

    // 17. Send notification (best-effort)
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
