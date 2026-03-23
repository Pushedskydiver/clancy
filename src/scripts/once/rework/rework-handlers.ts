/**
 * Platform-specific rework handlers.
 *
 * Replaces the dual/triple switch statements in rework.ts with a single
 * factory function that resolves the platform once, returning a handler
 * object with uniform method signatures. The main rework functions call
 * `handlers.checkReviewState(...)` instead of switching on `remote.host`.
 */
import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';
import { sharedEnv } from '~/scripts/shared/env-schema/env-schema.js';
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
import type { PrReviewState } from '~/types/index.js';

import { resolveGitToken } from '../git-token/git-token.js';

/** Uniform interface for platform-specific rework operations. */
export type PlatformReworkHandlers = {
  checkReviewState(
    branch: string,
    since?: string,
  ): Promise<PrReviewState | undefined>;

  fetchComments(
    prNumber: number,
    since?: string,
  ): Promise<{ comments: string[]; discussionIds?: string[] }>;

  postComment(prNumber: number, comment: string): Promise<boolean>;

  /** GitLab-only: resolve discussion threads. No-op on other platforms. */
  resolveThreads(prNumber: number, discussionIds: string[]): Promise<number>;

  /** GitHub-only: re-request review. No-op on other platforms. */
  reRequestReview(prNumber: number, reviewers: string[]): Promise<boolean>;
};

/**
 * Resolve platform handlers for the current remote.
 *
 * Returns `undefined` if the platform is unsupported (none, unknown, azure)
 * or credentials/API base are missing.
 */
export function resolvePlatformHandlers(
  config: BoardConfig,
): PlatformReworkHandlers | undefined {
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

  const noopResolve = async () => 0;
  const noopReRequest = async () => false;

  switch (remote.host) {
    case 'github': {
      const repo = `${remote.owner}/${remote.repo}`;
      return {
        checkReviewState: (branch, since) =>
          checkGitHubPrReviewState(
            creds.token,
            repo,
            branch,
            remote.owner,
            apiBase,
            since,
          ),
        fetchComments: async (prNumber, since) => ({
          comments: await fetchGitHubPrReviewComments(
            creds.token,
            repo,
            prNumber,
            apiBase,
            since,
          ),
        }),
        postComment: (prNumber, comment) =>
          postGitHubPrComment(creds.token, repo, prNumber, comment, apiBase),
        resolveThreads: noopResolve,
        reRequestReview: (prNumber, reviewers) =>
          requestGitHubReview(creds.token, repo, prNumber, reviewers, apiBase),
      };
    }

    case 'gitlab':
      return {
        checkReviewState: (branch, since) =>
          checkGitLabMrReviewState(
            creds.token,
            apiBase,
            remote.projectPath,
            branch,
            since,
          ),
        fetchComments: (prNumber, since) =>
          fetchGitLabMrReviewComments(
            creds.token,
            apiBase,
            remote.projectPath,
            prNumber,
            since,
          ),
        postComment: (prNumber, comment) =>
          postMrNote(
            creds.token,
            apiBase,
            remote.projectPath,
            prNumber,
            comment,
          ),
        resolveThreads: (prNumber, discussionIds) =>
          resolveDiscussions(
            creds.token,
            apiBase,
            remote.projectPath,
            prNumber,
            discussionIds,
          ),
        reRequestReview: noopReRequest,
      };

    case 'bitbucket':
      return {
        checkReviewState: (branch, since) =>
          checkBitbucketPrReviewState(
            creds.username!,
            creds.token,
            remote.workspace,
            remote.repoSlug,
            branch,
            since,
          ),
        fetchComments: async (prNumber, since) => ({
          comments: await fetchBitbucketPrReviewComments(
            creds.username!,
            creds.token,
            remote.workspace,
            remote.repoSlug,
            prNumber,
            since,
          ),
        }),
        postComment: (prNumber, comment) =>
          postCloudPrComment(
            creds.username!,
            creds.token,
            remote.workspace,
            remote.repoSlug,
            prNumber,
            comment,
          ),
        resolveThreads: noopResolve,
        reRequestReview: noopReRequest,
      };

    case 'bitbucket-server':
      return {
        checkReviewState: (branch, since) =>
          checkBitbucketServerPrReviewState(
            creds.token,
            apiBase,
            remote.projectKey,
            remote.repoSlug,
            branch,
            since,
          ),
        fetchComments: async (prNumber, since) => ({
          comments: await fetchBitbucketServerPrReviewComments(
            creds.token,
            apiBase,
            remote.projectKey,
            remote.repoSlug,
            prNumber,
            since,
          ),
        }),
        postComment: (prNumber, comment) =>
          postServerPrComment(
            creds.token,
            apiBase,
            remote.projectKey,
            remote.repoSlug,
            prNumber,
            comment,
          ),
        resolveThreads: noopResolve,
        reRequestReview: noopReRequest,
      };
  }
}
