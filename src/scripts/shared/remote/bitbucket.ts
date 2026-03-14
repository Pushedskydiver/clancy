/**
 * Bitbucket pull request creation.
 *
 * Supports both Bitbucket Cloud (api.bitbucket.org/2.0) and
 * Bitbucket Server/Data Center (rest/api/1.0).
 *
 * Auth: HTTP Basic Auth (username:token).
 */
import type { PrCreationResult } from '~/types/index.js';

/**
 * Build the Basic Auth header value from username and token.
 */
function basicAuth(username: string, token: string): string {
  return `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
}

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
  try {
    const response = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests`,
      {
        method: 'POST',
        headers: {
          Authorization: basicAuth(username, token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          description,
          source: { branch: { name: sourceBranch } },
          destination: { branch: { name: targetBranch } },
          close_source_branch: true,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      };
    }

    const json = (await response.json()) as {
      id?: number;
      links?: { html?: { href?: string } };
    };

    return {
      ok: true,
      url: json.links?.html?.href ?? '',
      number: json.id ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
  try {
    const response = await fetch(
      `${apiBase}/projects/${projectKey}/repos/${repoSlug}/pull-requests`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      };
    }

    const json = (await response.json()) as {
      id?: number;
      links?: { self?: Array<{ href?: string }> };
    };

    return {
      ok: true,
      url: json.links?.self?.[0]?.href ?? '',
      number: json.id ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
