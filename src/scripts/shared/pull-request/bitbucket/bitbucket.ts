/**
 * Bitbucket pull request creation.
 *
 * Supports both Bitbucket Cloud (api.bitbucket.org/2.0) and
 * Bitbucket Server/Data Center (rest/api/1.0).
 *
 * Auth: Cloud uses HTTP Basic Auth, Server uses Bearer token.
 */
import type { PrCreationResult } from '~/types/index.js';

import { basicAuth, postPullRequest } from '../post-pr/post-pr.js';

/**
 * Create a pull request on Bitbucket Cloud.
 *
 * @param username - The Bitbucket username.
 * @param token - The Bitbucket API token (or app password).
 * @param workspace - The Bitbucket workspace slug.
 * @param repoSlug - The repository slug.
 * @param sourceBranch - The source branch name.
 * @param targetBranch - The target branch name.
 * @param title - The PR title.
 * @param description - The PR body (markdown).
 * @returns A result with the PR URL and ID on success, or an error message.
 */
export async function createPullRequest(
  username: string,
  token: string,
  workspace: string,
  repoSlug: string,
  sourceBranch: string,
  targetBranch: string,
  title: string,
  description: string,
): Promise<PrCreationResult> {
  return postPullRequest(
    `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests`,
    { Authorization: basicAuth(username, token) },
    {
      title,
      description,
      source: { branch: { name: sourceBranch } },
      destination: { branch: { name: targetBranch } },
      close_source_branch: true,
    },
    (json) => {
      const data = json as {
        id?: number;
        links?: { html?: { href?: string } };
      };
      return {
        url: data.links?.html?.href ?? '',
        number: data.id ?? 0,
      };
    },
  );
}

/**
 * Create a pull request on Bitbucket Server / Data Center.
 *
 * @param token - The Bitbucket Server personal access token.
 * @param apiBase - The API base URL (e.g. `https://bitbucket.acme.com/rest/api/1.0`).
 * @param projectKey - The Bitbucket Server project key.
 * @param repoSlug - The repository slug.
 * @param sourceBranch - The source branch name.
 * @param targetBranch - The target branch name.
 * @param title - The PR title.
 * @param description - The PR body.
 * @returns A result with the PR URL and ID on success, or an error message.
 */
export async function createServerPullRequest(
  token: string,
  apiBase: string,
  projectKey: string,
  repoSlug: string,
  sourceBranch: string,
  targetBranch: string,
  title: string,
  description: string,
): Promise<PrCreationResult> {
  return postPullRequest(
    `${apiBase}/projects/${projectKey}/repos/${repoSlug}/pull-requests`,
    { Authorization: `Bearer ${token}` },
    {
      title,
      description,
      fromRef: {
        id: `refs/heads/${sourceBranch}`,
        repository: {
          slug: repoSlug,
          project: { key: projectKey },
        },
      },
      toRef: {
        id: `refs/heads/${targetBranch}`,
        repository: {
          slug: repoSlug,
          project: { key: projectKey },
        },
      },
    },
    (json) => {
      const data = json as {
        id?: number;
        links?: { self?: Array<{ href?: string }> };
      };
      return {
        url: data.links?.self?.[0]?.href ?? '',
        number: data.id ?? 0,
      };
    },
  );
}
