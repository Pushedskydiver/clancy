/**
 * GitHub pull request creation.
 *
 * Uses the GitHub REST API to create pull requests.
 * Supports both github.com and GitHub Enterprise (GHE).
 *
 * Auth: `Authorization: Bearer` header (personal access token with `repo` scope).
 */
import { GITHUB_API, githubHeaders } from '~/scripts/shared/http/http.js';
import type { PrCreationResult } from '~/types/index.js';

import { postPullRequest } from '../post-pr/post-pr.js';

/**
 * Create a pull request on GitHub.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @param head - The source branch name.
 * @param base - The target branch name.
 * @param title - The PR title.
 * @param body - The PR body (markdown).
 * @param apiBase - The API base URL (defaults to `https://api.github.com`).
 * @returns A result with the PR URL and number on success, or an error message.
 */
export async function createPullRequest(
  token: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string,
  apiBase = GITHUB_API,
): Promise<PrCreationResult> {
  return postPullRequest(
    `${apiBase}/repos/${repo}/pulls`,
    githubHeaders(token),
    { title, head, base, body },
    (json) => {
      const data = json as { html_url?: string; number?: number };
      return { url: data.html_url ?? '', number: data.number ?? 0 };
    },
    (status, text) => status === 422 && text.includes('already exists'),
  );
}
