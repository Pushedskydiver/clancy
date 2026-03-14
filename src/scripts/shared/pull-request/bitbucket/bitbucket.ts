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
    const url =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests` +
      `?q=source.branch.name="${branch}"&state=OPEN`;

    const res = await fetch(url, {
      headers: { Authorization: basicAuth(username, token) },
    });
    if (!res.ok) return undefined;

    const parsed = bitbucketPrListSchema.parse(await res.json());
    if (parsed.values.length === 0) return undefined;

    const pr = parsed.values[0];
    const changesRequested = pr.participants.some(
      (p) => p.state === 'changes_requested',
    );
    const prUrl = pr.links.html?.href ?? '';

    return { changesRequested, prNumber: pr.id, prUrl };
  } catch {
    return undefined;
  }
}

/**
 * Fetch review comments on a Bitbucket Cloud PR.
 *
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
    return parsed.values.map((c) => {
      const prefix = c.inline?.path ? `[${c.inline.path}] ` : '';
      return `${prefix}${c.content.raw}`;
    });
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
    const url =
      `${apiBase}/projects/${projectKey}/repos/${repoSlug}/pull-requests` +
      `?state=OPEN&at=refs/heads/${branch}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;

    const parsed = bitbucketServerPrListSchema.parse(await res.json());
    if (parsed.values.length === 0) return undefined;

    const pr = parsed.values[0];
    const changesRequested = pr.reviewers.some(
      (r) => r.status === 'NEEDS_WORK',
    );
    const prUrl = pr.links.self?.[0]?.href ?? '';

    return { changesRequested, prNumber: pr.id, prUrl };
  } catch {
    return undefined;
  }
}

/**
 * Fetch review comments on a Bitbucket Server/DC PR.
 *
 * Comments on specific files are prefixed with `[path]`.
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
    return parsed.values.map((c) => {
      const prefix = c.anchor?.path ? `[${c.anchor.path}] ` : '';
      return `${prefix}${c.text}`;
    });
  } catch {
    return [];
  }
}
