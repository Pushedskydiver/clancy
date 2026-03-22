import { computeTicketBranch } from '~/scripts/shared/branch/branch.js';
import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';
import { sharedEnv } from '~/scripts/shared/env-schema/env-schema.js';
import { findEntriesWithStatus } from '~/scripts/shared/progress/progress.js';
import {
  checkPrReviewState as checkBitbucketPrReviewState,
  checkServerPrReviewState as checkBitbucketServerPrReviewState,
  fetchPrReviewComments as fetchBitbucketPrReviewComments,
  fetchServerPrReviewComments as fetchBitbucketServerPrReviewComments,
  postCloudPrComment,
  postServerPrComment,
} from '~/scripts/shared/pull-request/bitbucket/bitbucket.js';
import {
  checkPrReviewState as checkGitHubPrReviewState,
  fetchPrReviewComments as fetchGitHubPrReviewComments,
  postPrComment as postGitHubPrComment,
  requestReview as requestGitHubReview,
} from '~/scripts/shared/pull-request/github/github.js';
import {
  checkMrReviewState as checkGitLabMrReviewState,
  fetchMrReviewComments as fetchGitLabMrReviewComments,
  postMrNote,
  resolveDiscussions,
} from '~/scripts/shared/pull-request/gitlab/gitlab.js';
import {
  buildApiBaseUrl,
  detectRemote,
} from '~/scripts/shared/remote/remote.js';
import type { FetchedTicket } from '~/types/board.js';
import { dim } from '~/utils/ansi/ansi.js';

import { resolveGitToken } from '../git-token/git-token.js';

// ─── PR-based rework detection ────────────────────────────────────────────────

/**
 * Check open PRs for review feedback requesting changes.
 *
 * Scans progress.txt for tickets with status PR_CREATED, then checks
 * the corresponding PR's review state on the detected remote platform.
 * If a reviewer has requested changes, returns the ticket and feedback.
 *
 * This is best-effort — errors are swallowed so the orchestrator
 * can fall through to fresh ticket fetch.
 */
export async function fetchReworkFromPrReview(config: BoardConfig): Promise<
  | {
      ticket: FetchedTicket;
      feedback: string[];
      prNumber: number;
      discussionIds?: string[];
      reviewers: string[];
    }
  | undefined
> {
  const prCreated = findEntriesWithStatus(process.cwd(), 'PR_CREATED');
  const reworked = findEntriesWithStatus(process.cwd(), 'REWORK');
  const pushed = findEntriesWithStatus(process.cwd(), 'PUSHED');
  const pushFailed = findEntriesWithStatus(process.cwd(), 'PUSH_FAILED');
  const candidates = [...prCreated, ...reworked, ...pushed, ...pushFailed];
  if (candidates.length === 0) return undefined;

  const platformOverride = sharedEnv(config).CLANCY_GIT_PLATFORM;
  const remote = detectRemote(platformOverride);

  if (
    remote.host === 'none' ||
    remote.host === 'unknown' ||
    remote.host === 'azure'
  ) {
    return undefined;
  }

  const creds = resolveGitToken(config, remote);
  if (!creds) return undefined;

  const apiBase = buildApiBaseUrl(remote, sharedEnv(config).CLANCY_GIT_API_URL);
  if (!apiBase) return undefined;

  // Limit to first 5 candidates to avoid rate limits
  const toCheck = candidates.slice(0, 5);

  for (const entry of toCheck) {
    const branch = computeTicketBranch(config.provider, entry.key);

    // Convert progress timestamp (YYYY-MM-DD HH:MM) to ISO 8601 for API filtering.
    // Only comments created AFTER this timestamp should trigger rework,
    // preventing stale inline comments from causing infinite rework loops.
    // Parse UTC timestamp (YYYY-MM-DD HH:MM) to ISO 8601.
    // Falls back to undefined if timestamp is invalid (skips filtering).
    let since: string | undefined;
    if (entry.timestamp) {
      const date = new Date(entry.timestamp.replace(' ', 'T') + 'Z');
      since = Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }

    let reviewState:
      | {
          changesRequested: boolean;
          prNumber: number;
          prUrl: string;
          reviewers?: string[];
        }
      | undefined;

    switch (remote.host) {
      case 'github':
        reviewState = await checkGitHubPrReviewState(
          creds.token,
          `${remote.owner}/${remote.repo}`,
          branch,
          remote.owner,
          apiBase,
          since,
        );
        break;
      case 'gitlab':
        reviewState = await checkGitLabMrReviewState(
          creds.token,
          apiBase,
          remote.projectPath,
          branch,
          since,
        );
        break;
      case 'bitbucket':
        reviewState = await checkBitbucketPrReviewState(
          creds.username!,
          creds.token,
          remote.workspace,
          remote.repoSlug,
          branch,
          since,
        );
        break;
      case 'bitbucket-server':
        reviewState = await checkBitbucketServerPrReviewState(
          creds.token,
          apiBase,
          remote.projectKey,
          remote.repoSlug,
          branch,
          since,
        );
        break;
    }

    if (reviewState?.changesRequested) {
      // Fetch review comments for the PR
      let feedback: string[] = [];

      let discussionIds: string[] | undefined;

      switch (remote.host) {
        case 'github':
          feedback = await fetchGitHubPrReviewComments(
            creds.token,
            `${remote.owner}/${remote.repo}`,
            reviewState.prNumber,
            apiBase,
            since,
          );
          break;
        case 'gitlab': {
          const mrResult = await fetchGitLabMrReviewComments(
            creds.token,
            apiBase,
            remote.projectPath,
            reviewState.prNumber,
            since,
          );
          feedback = mrResult.comments;
          discussionIds = mrResult.discussionIds;
          break;
        }
        case 'bitbucket':
          feedback = await fetchBitbucketPrReviewComments(
            creds.username!,
            creds.token,
            remote.workspace,
            remote.repoSlug,
            reviewState.prNumber,
            since,
          );
          break;
        case 'bitbucket-server':
          feedback = await fetchBitbucketServerPrReviewComments(
            creds.token,
            apiBase,
            remote.projectKey,
            remote.repoSlug,
            reviewState.prNumber,
            since,
          );
          break;
      }

      const ticket: FetchedTicket = {
        key: entry.key,
        title: entry.summary,
        description: entry.summary,
        parentInfo: entry.parent ?? 'none',
        blockers: 'None',
      };

      return {
        ticket,
        feedback,
        prNumber: reviewState.prNumber,
        discussionIds,
        reviewers: reviewState.reviewers ?? [],
      };
    }
  }

  return undefined;
}

// ─── Post-rework actions ──────────────────────────────────────────────────

/**
 * Build a rework comment to post on the PR after pushing fixes.
 *
 * Prefixed with `[clancy]` (not `Rework:`) so it does NOT trigger
 * rework detection on the next cycle.
 */
export function buildReworkComment(feedback: string[]): string {
  if (feedback.length === 0) {
    return '[clancy] Rework pushed addressing reviewer feedback.';
  }
  const count = feedback.length;
  const summary = feedback
    .slice(0, 3)
    .map((f) => `- ${f.slice(0, 80)}`)
    .join('\n');
  const suffix = feedback.length > 3 ? '\n- ...' : '';
  return `[clancy] Rework pushed addressing ${count} feedback item${count !== 1 ? 's' : ''}.\n\n${summary}${suffix}`;
}

/**
 * Perform post-rework actions: comment on PR, re-request review (GitHub),
 * resolve threads (GitLab). All best-effort — failures warn but don't block.
 */
export async function postReworkActions(
  config: BoardConfig,
  prNumber: number,
  feedback: string[],
  discussionIds?: string[],
  reviewers?: string[],
): Promise<void> {
  const platformOverride = sharedEnv(config).CLANCY_GIT_PLATFORM;
  const remote = detectRemote(platformOverride);

  if (
    remote.host === 'none' ||
    remote.host === 'unknown' ||
    remote.host === 'azure'
  ) {
    return;
  }

  const creds = resolveGitToken(config, remote);
  if (!creds) return;

  const apiBase = buildApiBaseUrl(remote, sharedEnv(config).CLANCY_GIT_API_URL);
  if (!apiBase) return;

  const comment = buildReworkComment(feedback);

  // 1. Post rework comment
  try {
    let posted = false;

    switch (remote.host) {
      case 'github':
        posted = await postGitHubPrComment(
          creds.token,
          `${remote.owner}/${remote.repo}`,
          prNumber,
          comment,
          apiBase,
        );
        break;
      case 'gitlab':
        posted = await postMrNote(
          creds.token,
          apiBase,
          remote.projectPath,
          prNumber,
          comment,
        );
        break;
      case 'bitbucket':
        posted = await postCloudPrComment(
          creds.username!,
          creds.token,
          remote.workspace,
          remote.repoSlug,
          prNumber,
          comment,
        );
        break;
      case 'bitbucket-server':
        posted = await postServerPrComment(
          creds.token,
          apiBase,
          remote.projectKey,
          remote.repoSlug,
          prNumber,
          comment,
        );
        break;
    }

    if (posted) {
      console.log(dim('  ✓ Posted rework comment'));
    }
  } catch {
    // Best-effort
  }

  // 2. GitLab: resolve addressed discussion threads
  if (remote.host === 'gitlab' && discussionIds && discussionIds.length > 0) {
    try {
      const resolved = await resolveDiscussions(
        creds.token,
        apiBase,
        remote.projectPath,
        prNumber,
        discussionIds,
      );
      if (resolved > 0) {
        console.log(
          dim(
            `  ✓ Resolved ${resolved} discussion thread${resolved !== 1 ? 's' : ''}`,
          ),
        );
      }
    } catch {
      // Best-effort
    }
  }

  // 3. GitHub: re-request review from reviewers who requested changes
  if (remote.host === 'github' && reviewers && reviewers.length > 0) {
    try {
      const ok = await requestGitHubReview(
        creds.token,
        `${remote.owner}/${remote.repo}`,
        prNumber,
        reviewers,
        apiBase,
      );
      if (ok) {
        console.log(
          dim(`  ✓ Re-requested review from ${reviewers.join(', ')}`),
        );
      }
    } catch {
      // Best-effort
    }
  }
}
