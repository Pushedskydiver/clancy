import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';
import {
  createPullRequest as createBitbucketPr,
  createServerPullRequest as createBitbucketServerPr,
} from '~/scripts/shared/pull-request/bitbucket/bitbucket.js';
import { createPullRequest as createGitHubPr } from '~/scripts/shared/pull-request/github/github.js';
import { createMergeRequest as createGitLabMr } from '~/scripts/shared/pull-request/gitlab/gitlab.js';
import { buildApiBaseUrl } from '~/scripts/shared/remote/remote.js';
import type { PrCreationResult, RemoteInfo } from '~/types/index.js';

import { sharedEnv } from '../board-ops/board-ops.js';
import { resolveGitToken } from '../git-token/git-token.js';

/**
 * Attempt to create a PR/MR on the detected remote platform.
 */
export async function attemptPrCreation(
  config: BoardConfig,
  remote: RemoteInfo,
  ticketBranch: string,
  targetBranch: string,
  title: string,
  body: string,
): Promise<PrCreationResult | undefined> {
  const creds = resolveGitToken(config, remote);
  if (!creds) return undefined;

  const apiBase = buildApiBaseUrl(remote, sharedEnv(config).CLANCY_GIT_API_URL);
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
export function buildManualPrUrl(
  remote: RemoteInfo,
  ticketBranch: string,
  targetBranch: string,
): string | undefined {
  const encodedTicket = encodeURIComponent(ticketBranch);
  const encodedTarget = encodeURIComponent(targetBranch);

  if (remote.host === 'github') {
    return `https://${remote.hostname}/${remote.owner}/${remote.repo}/compare/${encodedTarget}...${encodedTicket}`;
  }
  if (remote.host === 'gitlab') {
    return `https://${remote.hostname}/${remote.projectPath}/-/merge_requests/new?merge_request[source_branch]=${encodedTicket}&merge_request[target_branch]=${encodedTarget}`;
  }
  if (remote.host === 'bitbucket') {
    return `https://${remote.hostname}/${remote.workspace}/${remote.repoSlug}/pull-requests/new?source=${encodedTicket}&dest=${encodedTarget}`;
  }
  if (remote.host === 'bitbucket-server') {
    return `https://${remote.hostname}/projects/${remote.projectKey}/repos/${remote.repoSlug}/pull-requests?create&sourceBranch=refs/heads/${encodedTicket}&targetBranch=refs/heads/${encodedTarget}`;
  }
  return undefined;
}
