/**
 * GitLab merge request creation.
 *
 * Uses the GitLab REST API v4 to create merge requests.
 * Supports both gitlab.com and self-hosted instances.
 *
 * Auth: `PRIVATE-TOKEN` header (personal access token with `api` scope).
 */
import type { PrCreationResult } from '~/types/index.js';

import { postPullRequest } from '../post-pr/post-pr.js';

/**
 * Create a merge request on GitLab.
 *
 * @param token - The GitLab personal access token.
 * @param apiBase - The API base URL (e.g. `https://gitlab.com/api/v4`).
 * @param projectPath - The URL-encoded project path (e.g. `group%2Fproject`).
 * @param sourceBranch - The source branch name.
 * @param targetBranch - The target branch name.
 * @param title - The MR title.
 * @param description - The MR body (markdown).
 * @returns A result with the MR URL and IID on success, or an error message.
 */
export async function createMergeRequest(
  token: string,
  apiBase: string,
  projectPath: string,
  sourceBranch: string,
  targetBranch: string,
  title: string,
  description: string,
): Promise<PrCreationResult> {
  const encodedPath = encodeURIComponent(projectPath);

  return postPullRequest(
    `${apiBase}/projects/${encodedPath}/merge_requests`,
    { 'PRIVATE-TOKEN': token },
    {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      description,
      remove_source_branch: true,
    },
    (json) => {
      const data = json as { web_url?: string; iid?: number };
      return { url: data.web_url ?? '', number: data.iid ?? 0 };
    },
    (status, text) => status === 409 && text.includes('already exists'),
  );
}
