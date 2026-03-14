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
  createPullRequest as createGitHubPr,
  fetchIssue as fetchGitHubIssue,
  isValidRepo,
  pingGitHub,
  resolveUsername,
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
  pushBranch,
  squashMerge,
} from '~/scripts/shared/git-ops/git-ops.js';
import { sendNotification } from '~/scripts/shared/notify/notify.js';
import { runPreflight } from '~/scripts/shared/preflight/preflight.js';
import { appendProgress } from '~/scripts/shared/progress/progress.js';
import { buildPrompt } from '~/scripts/shared/prompt/prompt.js';
import {
  createPullRequest as createBitbucketPr,
  createServerPullRequest as createBitbucketServerPr,
} from '~/scripts/shared/remote/bitbucket.js';
import { createMergeRequest as createGitLabMr } from '~/scripts/shared/remote/gitlab.js';
import { buildPrBody } from '~/scripts/shared/remote/pr-body.js';
import {
  buildApiBaseUrl,
  detectRemote,
} from '~/scripts/shared/remote/remote.js';
import type { PrCreationResult, RemoteInfo } from '~/types/index.js';
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
      const username = await resolveUsername(env.GITHUB_TOKEN);
      const ticket = await fetchGitHubIssue(
        env.GITHUB_TOKEN,
        env.GITHUB_REPO,
        env.CLANCY_LABEL,
        username,
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

// ─── PR/MR creation ──────────────────────────────────────────────────────────

/**
 * Resolve a git host token from the board config's env.
 *
 * For GitHub boards, `GITHUB_TOKEN` is always present.
 * For Jira/Linear boards, check the shared optional vars.
 */
function resolveGitToken(
  config: BoardConfig,
  remote: RemoteInfo,
): { token: string; username?: string } | undefined {
  const env = config.env as Record<string, string | undefined>;

  switch (remote.host) {
    case 'github':
      if (env.GITHUB_TOKEN) return { token: env.GITHUB_TOKEN };
      break;
    case 'gitlab':
      if (env.GITLAB_TOKEN) return { token: env.GITLAB_TOKEN };
      break;
    case 'bitbucket':
      if (env.BITBUCKET_USER && env.BITBUCKET_TOKEN)
        return { token: env.BITBUCKET_TOKEN, username: env.BITBUCKET_USER };
      break;
    case 'bitbucket-server':
      if (env.BITBUCKET_TOKEN) return { token: env.BITBUCKET_TOKEN };
      break;
  }
  return undefined;
}

/**
 * Attempt to create a PR/MR on the detected remote platform.
 */
async function attemptPrCreation(
  config: BoardConfig,
  remote: RemoteInfo,
  ticketBranch: string,
  targetBranch: string,
  title: string,
  body: string,
): Promise<PrCreationResult | undefined> {
  const creds = resolveGitToken(config, remote);
  if (!creds) return undefined;

  const apiBase = buildApiBaseUrl(
    remote,
    (config.env as Record<string, string | undefined>).CLANCY_GIT_API_URL,
  );
  if (!apiBase) return undefined;

  switch (remote.host) {
    case 'github':
      return createGitHubPr(
        creds.token,
        `${remote.owner}/${remote.repo}`,
        ticketBranch,
        targetBranch,
        title,
        body,
        apiBase,
      );

    case 'gitlab':
      return createGitLabMr(
        creds.token,
        apiBase,
        remote.projectPath,
        ticketBranch,
        targetBranch,
        title,
        body,
      );

    case 'bitbucket':
      return createBitbucketPr(
        creds.username!,
        creds.token,
        remote.workspace,
        remote.repoSlug,
        ticketBranch,
        targetBranch,
        title,
        body,
      );

    case 'bitbucket-server':
      return createBitbucketServerPr(
        creds.token,
        apiBase,
        remote.projectKey,
        remote.repoSlug,
        ticketBranch,
        targetBranch,
        title,
        body,
      );

    default:
      return undefined;
  }
}

/**
 * Build a manual PR/MR URL for the user to click.
 */
function buildManualPrUrl(
  remote: RemoteInfo,
  ticketBranch: string,
  targetBranch: string,
): string | undefined {
  if (remote.host === 'github') {
    return `https://${remote.hostname}/${remote.owner}/${remote.repo}/compare/${targetBranch}...${ticketBranch}`;
  }
  if (remote.host === 'gitlab') {
    return `https://${remote.hostname}/${remote.projectPath}/-/merge_requests/new?merge_request[source_branch]=${ticketBranch}&merge_request[target_branch]=${targetBranch}`;
  }
  if (remote.host === 'bitbucket') {
    return `https://${remote.hostname}/${remote.workspace}/${remote.repoSlug}/pull-requests/new?source=${ticketBranch}&dest=${targetBranch}`;
  }
  return undefined;
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

    // 13. Deliver — epic merge or PR flow
    const hasParent = ticket.parentInfo !== 'none';

    if (hasParent) {
      // ── Epic flow: squash merge locally (unchanged) ──
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

      // 14a. Delete feature branch
      deleteBranch(ticketBranch);

      // 15a. Transition to Done / close issue (best-effort)
      const statusDone = config.env.CLANCY_STATUS_DONE;

      if (config.provider === 'github') {
        const issueNumber = parseInt(ticket.key.replace('#', ''), 10);

        if (!Number.isNaN(issueNumber)) {
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

      // 16a. Log progress
      appendProgress(process.cwd(), ticket.key, ticket.title, 'DONE');
    } else {
      // ── PR flow: push branch + create PR/MR ──

      // 14b. Push feature branch to remote
      const pushed = pushBranch(ticketBranch);

      if (!pushed) {
        console.log(yellow(`⚠ Could not push ${ticketBranch} to origin.`));
        console.log(
          dim('  The branch is still available locally. Push manually:'),
        );
        console.log(dim(`  git push -u origin ${ticketBranch}`));
        appendProgress(process.cwd(), ticket.key, ticket.title, 'PUSH_FAILED');
        checkout(targetBranch);

        // Still log completion time
        const elapsed = formatDuration(Date.now() - startTime);
        console.log('');
        console.log(
          yellow(`⚠ ${ticket.key} implemented but push failed`) +
            dim(` (${elapsed})`),
        );
        return;
      }

      console.log(green(`  ✓ Pushed ${ticketBranch}`));

      // 15b. Attempt PR/MR creation
      const platformOverride = (
        config.env as Record<string, string | undefined>
      ).CLANCY_GIT_PLATFORM;
      const remote = detectRemote(platformOverride);
      const prTitle = `feat(${ticket.key}): ${ticket.title}`;
      const prBody = buildPrBody(config, {
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
        provider: config.provider,
      });

      if (
        remote.host !== 'none' &&
        remote.host !== 'unknown' &&
        remote.host !== 'azure'
      ) {
        const pr = await attemptPrCreation(
          config,
          remote,
          ticketBranch,
          targetBranch,
          prTitle,
          prBody,
        );

        if (pr?.ok) {
          console.log(green(`  ✓ PR created: ${pr.url}`));
          appendProgress(process.cwd(), ticket.key, ticket.title, 'PR_CREATED');
        } else if (pr && !pr.ok && pr.alreadyExists) {
          console.log(
            yellow(
              `  ⚠ A PR/MR already exists for ${ticketBranch}. Branch pushed.`,
            ),
          );
          appendProgress(process.cwd(), ticket.key, ticket.title, 'PUSHED');
        } else if (pr && !pr.ok) {
          console.log(yellow(`  ⚠ PR/MR creation failed: ${pr.error}`));
          const manualUrl = buildManualPrUrl(
            remote,
            ticketBranch,
            targetBranch,
          );
          if (manualUrl) {
            console.log(dim(`  Create one manually: ${manualUrl}`));
          } else {
            console.log(dim('  Branch pushed — create a PR/MR manually.'));
          }
          appendProgress(process.cwd(), ticket.key, ticket.title, 'PUSHED');
        } else {
          // No token available for this platform
          const manualUrl = buildManualPrUrl(
            remote,
            ticketBranch,
            targetBranch,
          );
          if (manualUrl) {
            console.log(dim(`  Create a PR: ${manualUrl}`));
          } else {
            console.log(
              dim('  Branch pushed to remote. Create a PR/MR manually.'),
            );
          }
          appendProgress(process.cwd(), ticket.key, ticket.title, 'PUSHED');
        }
      } else if (remote.host === 'none') {
        console.log(
          yellow(
            `⚠ No git remote configured. Branch available locally: ${ticketBranch}`,
          ),
        );
        appendProgress(process.cwd(), ticket.key, ticket.title, 'LOCAL');
      } else {
        // Unknown or Azure remote — just note the push
        console.log(dim('  Branch pushed to remote. Create a PR/MR manually.'));
        appendProgress(process.cwd(), ticket.key, ticket.title, 'PUSHED');
      }

      // 16b. Transition to In Review (not Done — PR hasn't been merged yet)
      // For GitHub Issues: do NOT close — PR body has "Closes #N" for auto-close on merge
      if (config.provider !== 'github') {
        const statusReview =
          config.env.CLANCY_STATUS_REVIEW ?? config.env.CLANCY_STATUS_DONE;
        if (statusReview) {
          await transitionToStatus(config, ticket, statusReview);
        }
      }

      // Switch back to target branch
      checkout(targetBranch);
    }

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
