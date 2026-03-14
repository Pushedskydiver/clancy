/**
 * GitHub pull request creation and review state checking.
 *
 * Uses the GitHub REST API to create pull requests, check review state,
 * and fetch review comments.
 * Supports both github.com and GitHub Enterprise (GHE).
 *
 * Auth: `Authorization: Bearer` header (personal access token with `repo` scope).
 */
import {
  githubCommentsResponseSchema,
  githubPrCommentsSchema,
  githubPrListSchema,
  githubReviewListSchema,
} from '~/schemas/github.js';
import { GITHUB_API, githubHeaders } from '~/scripts/shared/http/http.js';
import type { PrCreationResult, PrReviewState } from '~/types/index.js';

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
/**
 * Check the review state of an open PR for a given branch.
 *
 * Finds the open PR matching the branch, fetches its reviews, and determines
 * whether changes have been requested by any reviewer.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @param branch - The source branch name.
 * @param owner - The repository owner (used for `head` filter).
 * @param apiBase - The API base URL (defaults to `https://api.github.com`).
 * @returns The review state, or `undefined` if no open PR or on error.
 */
export async function checkPrReviewState(
  token: string,
  repo: string,
  branch: string,
  owner: string,
  apiBase = GITHUB_API,
): Promise<PrReviewState | undefined> {
  try {
    const headers = githubHeaders(token);

    const prRes = await fetch(
      `${apiBase}/repos/${repo}/pulls?head=${owner}:${branch}&state=open`,
      { headers },
    );
    if (!prRes.ok) return undefined;

    const prs = githubPrListSchema.parse(await prRes.json());
    if (prs.length === 0) return undefined;

    const pr = prs[0];

    const reviewRes = await fetch(
      `${apiBase}/repos/${repo}/pulls/${pr.number}/reviews`,
      { headers },
    );
    if (!reviewRes.ok) return undefined;

    const reviews = githubReviewListSchema.parse(await reviewRes.json());

    /* Deduplicate: keep the latest review per user, skip PENDING/DISMISSED. */
    const latestByUser = new Map<string, string>();
    for (const review of reviews) {
      if (review.state === 'PENDING' || review.state === 'DISMISSED') continue;
      latestByUser.set(review.user.login, review.state);
    }

    const changesRequested = [...latestByUser.values()].some(
      (s) => s === 'CHANGES_REQUESTED',
    );

    return {
      changesRequested,
      prNumber: pr.number,
      prUrl: pr.html_url,
    };
  } catch {
    return undefined;
  }
}

/**
 * Fetch all review comments (inline + conversation) for a PR.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @param prNumber - The PR number.
 * @param apiBase - The API base URL (defaults to `https://api.github.com`).
 * @returns An array of comment strings, or `[]` on error.
 */
export async function fetchPrReviewComments(
  token: string,
  repo: string,
  prNumber: number,
  apiBase = GITHUB_API,
): Promise<string[]> {
  try {
    const headers = githubHeaders(token);

    const [inlineRes, convoRes] = await Promise.all([
      fetch(`${apiBase}/repos/${repo}/pulls/${prNumber}/comments`, {
        headers,
      }),
      fetch(`${apiBase}/repos/${repo}/issues/${prNumber}/comments`, {
        headers,
      }),
    ]);

    if (!inlineRes.ok || !convoRes.ok) return [];

    const inlineComments = githubPrCommentsSchema.parse(await inlineRes.json());
    const convoComments = githubCommentsResponseSchema.parse(
      await convoRes.json(),
    );

    const combined: string[] = [];

    for (const c of inlineComments) {
      if (c.body) {
        combined.push(`[${c.path ?? 'unknown'}] ${c.body}`);
      }
    }

    for (const c of convoComments) {
      if (c.body) {
        combined.push(c.body);
      }
    }

    return combined;
  } catch {
    return [];
  }
}

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
