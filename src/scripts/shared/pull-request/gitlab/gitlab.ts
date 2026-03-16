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
import {
  extractReworkContent,
  isReworkComment,
} from '../rework-comment/rework-comment.js';

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
 * Post a note (comment) on a GitLab merge request.
 *
 * Best-effort — never throws. Returns `true` on success, `false` on error.
 *
 * @param token - The GitLab personal access token.
 * @param apiBase - The API base URL (e.g. `https://gitlab.com/api/v4`).
 * @param projectPath - The raw project path. URL-encoded internally.
 * @param mrIid - The MR internal ID (iid).
 * @param body - The note body (markdown).
 */
export async function postMrNote(
  token: string,
  apiBase: string,
  projectPath: string,
  mrIid: number,
  body: string,
): Promise<boolean> {
  try {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(
      `${apiBase}/projects/${encoded}/merge_requests/${mrIid}/notes`,
      {
        method: 'POST',
        headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve MR discussion threads on GitLab.
 *
 * Best-effort per discussion — failures are silently skipped.
 * Returns the number of successfully resolved discussions.
 *
 * @param token - The GitLab personal access token.
 * @param apiBase - The API base URL (e.g. `https://gitlab.com/api/v4`).
 * @param projectPath - The raw project path. URL-encoded internally.
 * @param mrIid - The MR internal ID (iid).
 * @param discussionIds - Array of discussion IDs to resolve.
 */
export async function resolveDiscussions(
  token: string,
  apiBase: string,
  projectPath: string,
  mrIid: number,
  discussionIds: string[],
): Promise<number> {
  const encoded = encodeURIComponent(projectPath);
  let resolved = 0;

  for (const id of discussionIds) {
    try {
      const res = await fetch(
        `${apiBase}/projects/${encoded}/merge_requests/${mrIid}/discussions/${id}`,
        {
          method: 'PUT',
          headers: {
            'PRIVATE-TOKEN': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ resolved: true }),
        },
      );
      if (res.ok) resolved++;
    } catch {
      // Best-effort per discussion
    }
  }

  return resolved;
}

/**
 * Check the review state of an open MR for a given branch.
 *
 * Finds the open MR matching the source branch, fetches all discussions.
 * Inline notes (type `DiffNote`) always trigger rework. General conversation
 * notes only trigger rework when prefixed with `Rework:`.
 *
 * @param token - The GitLab personal access token.
 * @param apiBase - The API base URL (e.g. `https://gitlab.com/api/v4`).
 * @param projectPath - The raw project path (e.g. `group/subgroup/project`). URL-encoded internally.
 * @param branch - The source branch to look up.
 * @param since - ISO 8601 timestamp; only notes created after this time trigger rework.
 * @returns The review state if an open MR exists, otherwise `undefined`.
 */
export async function checkMrReviewState(
  token: string,
  apiBase: string,
  projectPath: string,
  branch: string,
  since?: string,
): Promise<PrReviewState | undefined> {
  try {
    const encodedPath = encodeURIComponent(projectPath);
    const mrUrl = `${apiBase}/projects/${encodedPath}/merge_requests?source_branch=${branch}&state=opened`;

    const mrRes = await fetch(mrUrl, {
      headers: { 'PRIVATE-TOKEN': token },
    });

    if (!mrRes.ok) return undefined;

    const data = gitlabMrListSchema.parse(await mrRes.json());
    if (data.length === 0) return undefined;

    const mr = data[0];

    const discussionsUrl = `${apiBase}/projects/${encodedPath}/merge_requests/${mr.iid}/discussions?per_page=100`;
    const discussionsRes = await fetch(discussionsUrl, {
      headers: { 'PRIVATE-TOKEN': token },
    });

    if (!discussionsRes.ok) return undefined;

    const discussions = gitlabDiscussionsSchema.parse(
      await discussionsRes.json(),
    );

    let hasRework = false;

    for (const discussion of discussions) {
      for (const note of discussion.notes) {
        if (note.system) continue;
        if (since && note.created_at && note.created_at <= since) continue;
        if (
          note.type === 'DiffNote' &&
          note.resolvable !== false &&
          note.resolved !== true
        ) {
          hasRework = true;
          break;
        }
        if (isReworkComment(note.body)) {
          hasRework = true;
          break;
        }
      }
      if (hasRework) break;
    }

    return {
      changesRequested: hasRework,
      prNumber: mr.iid,
      prUrl: mr.web_url,
    };
  } catch {
    return undefined;
  }
}

/**
 * Fetch feedback comments from an MR's discussions.
 *
 * Inline notes (type `DiffNote`) are always included — they inherently
 * represent change requests. General conversation notes are only included
 * when they start with `Rework:` (case-insensitive), with the prefix
 * stripped. Inline notes are prefixed with `[new_path]` when available.
 *
 * @param token - The GitLab personal access token.
 * @param apiBase - The API base URL (e.g. `https://gitlab.com/api/v4`).
 * @param projectPath - The raw project path. URL-encoded internally.
 * @param mrIid - The MR internal ID (iid).
 * @param since - ISO 8601 timestamp; only notes created after this time are returned.
 * @returns An object with feedback descriptions and discussion IDs.
 */
export async function fetchMrReviewComments(
  token: string,
  apiBase: string,
  projectPath: string,
  mrIid: number,
  since?: string,
): Promise<{ comments: string[]; discussionIds: string[] }> {
  try {
    const encodedPath = encodeURIComponent(projectPath);
    const url = `${apiBase}/projects/${encodedPath}/merge_requests/${mrIid}/discussions?per_page=100`;

    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': token },
    });

    if (!res.ok) return { comments: [], discussionIds: [] };

    const discussions = gitlabDiscussionsSchema.parse(await res.json());
    const comments: string[] = [];
    const discussionIds: string[] = [];

    for (const discussion of discussions) {
      let discussionHasFeedback = false;

      for (const note of discussion.notes) {
        if (note.system) continue;
        if (since && note.created_at && note.created_at <= since) continue;

        if (
          note.type === 'DiffNote' &&
          note.resolvable !== false &&
          note.resolved !== true
        ) {
          const prefix = note.position?.new_path
            ? `[${note.position.new_path}] `
            : '';
          comments.push(`${prefix}${note.body}`);
          discussionHasFeedback = true;
        } else if (isReworkComment(note.body)) {
          comments.push(extractReworkContent(note.body));
          discussionHasFeedback = true;
        }
      }

      if (discussionHasFeedback && discussion.id) {
        discussionIds.push(discussion.id);
      }
    }

    return { comments, discussionIds };
  } catch {
    return { comments: [], discussionIds: [] };
  }
}
