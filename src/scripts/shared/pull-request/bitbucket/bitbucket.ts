/**
 * Bitbucket pull request creation and review state checking.
 *
 * Supports both Bitbucket Cloud (api.bitbucket.org/2.0) and
 * Bitbucket Server/Data Center (rest/api/1.0).
 *
 * Auth: Cloud uses HTTP Basic Auth, Server uses Bearer token.
 */
import {
  bitbucketCommentsSchema,
  bitbucketPrListSchema,
  bitbucketServerCommentsSchema,
  bitbucketServerPrListSchema,
} from '~/schemas/bitbucket-pr.js';
import type { PrCreationResult, PrReviewState } from '~/types/index.js';

import { basicAuth, postPullRequest } from '../post-pr/post-pr.js';
import {
  extractReworkContent,
  isReworkComment,
} from '../rework-comment/rework-comment.js';

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
    (status, text) => status === 409 && text.includes('already exists'),
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
    (status, text) => status === 409 && text.includes('already exists'),
  );
}

// ---------------------------------------------------------------------------
// Cloud — review state & comments
// ---------------------------------------------------------------------------

/**
 * Check the review state of an open PR on Bitbucket Cloud for a given branch.
 *
 * Finds the open PR, fetches all comments. Inline comments (with `inline`
 * property) always trigger rework. General conversation comments only
 * trigger rework when prefixed with `Rework:`.
 *
 * @returns The review state, or `undefined` if no open PR exists.
 */
export async function checkPrReviewState(
  username: string,
  token: string,
  workspace: string,
  repoSlug: string,
  branch: string,
): Promise<PrReviewState | undefined> {
  try {
    const prUrl =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests` +
      `?q=source.branch.name="${branch}"&state=OPEN`;

    const prRes = await fetch(prUrl, {
      headers: { Authorization: basicAuth(username, token) },
    });
    if (!prRes.ok) return undefined;

    const parsed = bitbucketPrListSchema.parse(await prRes.json());
    if (parsed.values.length === 0) return undefined;

    const pr = parsed.values[0];
    const htmlUrl = pr.links.html?.href ?? '';

    const commentsUrl =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests/${pr.id}/comments` +
      `?pagelen=100`;

    const commentsRes = await fetch(commentsUrl, {
      headers: { Authorization: basicAuth(username, token) },
    });

    if (!commentsRes.ok) return undefined;

    const comments = bitbucketCommentsSchema.parse(await commentsRes.json());
    const hasInline = comments.values.some((c) => c.inline != null);
    const hasReworkConvo = comments.values.some(
      (c) => c.inline == null && isReworkComment(c.content.raw),
    );
    const changesRequested = hasInline || hasReworkConvo;

    return { changesRequested, prNumber: pr.id, prUrl: htmlUrl };
  } catch {
    return undefined;
  }
}

/**
 * Fetch feedback comments on a Bitbucket Cloud PR.
 *
 * Inline comments (with `inline` property) are always included — they
 * inherently represent change requests. General conversation comments are
 * only included when prefixed with `Rework:` (prefix stripped).
 * Inline comments are prefixed with `[path]`.
 */
export async function fetchPrReviewComments(
  username: string,
  token: string,
  workspace: string,
  repoSlug: string,
  prId: number,
): Promise<string[]> {
  try {
    const url =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments` +
      `?pagelen=100`;

    const res = await fetch(url, {
      headers: { Authorization: basicAuth(username, token) },
    });
    if (!res.ok) return [];

    const parsed = bitbucketCommentsSchema.parse(await res.json());
    const comments: string[] = [];

    for (const c of parsed.values) {
      if (c.inline != null) {
        const prefix = c.inline.path ? `[${c.inline.path}] ` : '';
        comments.push(`${prefix}${c.content.raw}`);
      } else if (isReworkComment(c.content.raw)) {
        comments.push(extractReworkContent(c.content.raw));
      }
    }

    return comments;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Server/DC — review state & comments
// ---------------------------------------------------------------------------

/**
 * Check the review state of an open PR on Bitbucket Server/DC for a given branch.
 *
 * Finds the open PR, fetches all comments. Inline comments (with `anchor`
 * property) always trigger rework. General conversation comments only
 * trigger rework when prefixed with `Rework:`.
 *
 * @returns The review state, or `undefined` if no open PR exists.
 */
export async function checkServerPrReviewState(
  token: string,
  apiBase: string,
  projectKey: string,
  repoSlug: string,
  branch: string,
): Promise<PrReviewState | undefined> {
  try {
    const prUrl =
      `${apiBase}/projects/${projectKey}/repos/${repoSlug}/pull-requests` +
      `?state=OPEN&at=refs/heads/${branch}`;

    const prRes = await fetch(prUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!prRes.ok) return undefined;

    const parsed = bitbucketServerPrListSchema.parse(await prRes.json());
    if (parsed.values.length === 0) return undefined;

    const pr = parsed.values[0];
    const htmlUrl = pr.links.self?.[0]?.href ?? '';

    const commentsUrl =
      `${apiBase}/projects/${projectKey}/repos/${repoSlug}/pull-requests/${pr.id}/comments` +
      `?limit=100`;

    const commentsRes = await fetch(commentsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!commentsRes.ok) return undefined;

    const comments = bitbucketServerCommentsSchema.parse(
      await commentsRes.json(),
    );
    const hasInline = comments.values.some((c) => c.anchor != null);
    const hasReworkConvo = comments.values.some(
      (c) => c.anchor == null && isReworkComment(c.text),
    );
    const changesRequested = hasInline || hasReworkConvo;

    return { changesRequested, prNumber: pr.id, prUrl: htmlUrl };
  } catch {
    return undefined;
  }
}

/**
 * Fetch feedback comments on a Bitbucket Server/DC PR.
 *
 * Inline comments (with `anchor` property) are always included — they
 * inherently represent change requests. General conversation comments are
 * only included when prefixed with `Rework:` (prefix stripped).
 * Inline comments are prefixed with `[path]`.
 */
export async function fetchServerPrReviewComments(
  token: string,
  apiBase: string,
  projectKey: string,
  repoSlug: string,
  prId: number,
): Promise<string[]> {
  try {
    const url =
      `${apiBase}/projects/${projectKey}/repos/${repoSlug}/pull-requests/${prId}/comments` +
      `?limit=100`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];

    const parsed = bitbucketServerCommentsSchema.parse(await res.json());
    const comments: string[] = [];

    for (const c of parsed.values) {
      if (c.anchor != null) {
        const prefix = c.anchor.path ? `[${c.anchor.path}] ` : '';
        comments.push(`${prefix}${c.text}`);
      } else if (isReworkComment(c.text)) {
        comments.push(extractReworkContent(c.text));
      }
    }

    return comments;
  } catch {
    return [];
  }
}
