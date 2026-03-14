/**
 * GitLab merge request creation.
 *
 * Uses the GitLab REST API v4 to create merge requests.
 * Supports both gitlab.com and self-hosted instances.
 *
 * Auth: `PRIVATE-TOKEN` header (personal access token with `api` scope).
 */
import type { PrCreationResult } from '~/types/index.js';

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

  try {
    const response = await fetch(
      `${apiBase}/projects/${encodedPath}/merge_requests`,
      {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_branch: sourceBranch,
          target_branch: targetBranch,
          title,
          description,
          remove_source_branch: true,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const alreadyExists =
        response.status === 409 && text.includes('already exists');
      return {
        ok: false,
        error: `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
        alreadyExists,
      };
    }

    const json = (await response.json()) as {
      web_url?: string;
      iid?: number;
    };

    return {
      ok: true,
      url: json.web_url ?? '',
      number: json.iid ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
