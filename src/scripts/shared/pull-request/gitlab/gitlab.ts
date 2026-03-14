/**
 * GitLab merge request creation and review state checking.
 *
 * Uses the GitLab REST API v4 to create merge requests, check review state,
 * and fetch review comments.
 * Supports both gitlab.com and self-hosted instances.
 *
 * Auth: `PRIVATE-TOKEN` header (personal access token with `api` scope).
 */
import {
  gitlabDiscussionsSchema,
  gitlabMrListSchema,
} from '~/schemas/gitlab-mr.js';
import type { PrCreationResult, PrReviewState } from '~/types/index.js';

import { postPullRequest } from '../post-pr/post-pr.js';

/**
 * Create a merge request on GitLab.
 *
 * @param token - The GitLab personal access token.
 * @param apiBase - The API base URL (e.g. `https://gitlab.com/api/v4`).
 * @param projectPath - The raw project path (e.g. `group/subgroup/project`). URL-encoded internally.
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

/**
 * Check the review state of an open MR for a given branch.
 *
 * @param token - The GitLab personal access token.
 * @param apiBase - The API base URL (e.g. `https://gitlab.com/api/v4`).
 * @param projectPath - The raw project path (e.g. `group/subgroup/project`). URL-encoded internally.
 * @param branch - The source branch to look up.
 * @returns The review state if an open MR exists, otherwise `undefined`.
 */
export async function checkMrReviewState(
  token: string,
  apiBase: string,
  projectPath: string,
  branch: string,
): Promise<PrReviewState | undefined> {
  try {
    const encodedPath = encodeURIComponent(projectPath);
    const url = `${apiBase}/projects/${encodedPath}/merge_requests?source_branch=${branch}&state=opened`;

    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': token },
    });

    if (!res.ok) return undefined;

    const data = gitlabMrListSchema.parse(await res.json());
    if (data.length === 0) return undefined;

    const mr = data[0];
    const changesRequested =
      mr.detailed_merge_status === 'requested_changes' ||
      mr.detailed_merge_status === 'discussions_not_resolved';

    return {
      changesRequested,
      prNumber: mr.iid,
      prUrl: mr.web_url,
    };
  } catch {
    return undefined;
  }
}

/**
 * Fetch unresolved review comments from an MR's discussions.
 *
 * @param token - The GitLab personal access token.
 * @param apiBase - The API base URL (e.g. `https://gitlab.com/api/v4`).
 * @param projectPath - The raw project path. URL-encoded internally.
 * @param mrIid - The MR internal ID (iid).
 * @returns An array of unresolved comment bodies.
 */
export async function fetchMrReviewComments(
  token: string,
  apiBase: string,
  projectPath: string,
  mrIid: number,
): Promise<string[]> {
  try {
    const encodedPath = encodeURIComponent(projectPath);
    const url = `${apiBase}/projects/${encodedPath}/merge_requests/${mrIid}/discussions`;

    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': token },
    });

    if (!res.ok) return [];

    const discussions = gitlabDiscussionsSchema.parse(await res.json());
    const comments: string[] = [];

    for (const discussion of discussions) {
      const note = discussion.notes[0];
      if (!note) continue;
      if (!note.resolvable || note.resolved !== false || note.system) continue;

      const prefix = note.position?.new_path
        ? `[${note.position.new_path}] `
        : '';
      comments.push(`${prefix}${note.body}`);
    }

    return comments;
  } catch {
    return [];
  }
}
