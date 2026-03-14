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
} from '~/schemas/github.js';
import { GITHUB_API, githubHeaders } from '~/scripts/shared/http/http.js';
import type { PrCreationResult, PrReviewState } from '~/types/index.js';

import { postPullRequest } from '../post-pr/post-pr.js';
import {
  extractReworkContent,
  isReworkComment,
} from '../rework-comment/rework-comment.js';

/**
 * Check the review state of an open PR for a given branch.
 *
 * Finds the open PR matching the branch, fetches inline and conversation
 * comments. Any inline comment (left on a specific line) triggers rework.
 * Conversation comments only trigger rework when prefixed with `Rework:`.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @param branch - The source branch name.
 * @param owner - The repository owner (used for `head` filter).
 * @param apiBase - The API base URL (defaults to `https://api.github.com`).
 * @param since - ISO 8601 timestamp; only comments created after this time trigger rework.
 * @returns The review state, or `undefined` if no open PR or on error.
 */
export async function checkPrReviewState(
  token: string,
  repo: string,
  branch: string,
  owner: string,
  apiBase = GITHUB_API,
  since?: string,
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

    const sinceParam = since ? `&since=${since}` : '';
    const [inlineRes, convoRes] = await Promise.all([
      fetch(
        `${apiBase}/repos/${repo}/pulls/${pr.number}/comments?per_page=100${sinceParam}`,
        {
          headers,
        },
      ),
      fetch(
        `${apiBase}/repos/${repo}/issues/${pr.number}/comments?per_page=100${sinceParam}`,
        {
          headers,
        },
      ),
    ]);

    if (!inlineRes.ok || !convoRes.ok) return undefined;

    const inlineComments = githubPrCommentsSchema.parse(await inlineRes.json());
    const convoComments = githubCommentsResponseSchema.parse(
      await convoRes.json(),
    );

    const hasInlineComments = inlineComments.length > 0;
    const hasReworkConvo = convoComments.some(
      (c) => c.body && isReworkComment(c.body),
    );
    const hasRework = hasInlineComments || hasReworkConvo;

    return {
      changesRequested: hasRework,
      prNumber: pr.number,
      prUrl: pr.html_url,
    };
  } catch {
    return undefined;
  }
}

/**
 * Fetch feedback comments (inline + conversation) for a PR.
 *
 * Inline comments (left on specific lines) are always included — they
 * inherently represent change requests. Conversation comments are only
 * included when they start with `Rework:` (case-insensitive), with the
 * prefix stripped. Inline comments are prefixed with `[path]` when a
 * file path is available.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @param prNumber - The PR number.
 * @param apiBase - The API base URL (defaults to `https://api.github.com`).
 * @param since - ISO 8601 timestamp; only comments created after this time are returned.
 * @returns An array of feedback descriptions, or `[]` on error.
 */
export async function fetchPrReviewComments(
  token: string,
  repo: string,
  prNumber: number,
  apiBase = GITHUB_API,
  since?: string,
): Promise<string[]> {
  try {
    const headers = githubHeaders(token);

    const sinceParam = since ? `&since=${since}` : '';
    const [inlineRes, convoRes] = await Promise.all([
      fetch(
        `${apiBase}/repos/${repo}/pulls/${prNumber}/comments?per_page=100${sinceParam}`,
        {
          headers,
        },
      ),
      fetch(
        `${apiBase}/repos/${repo}/issues/${prNumber}/comments?per_page=100${sinceParam}`,
        {
          headers,
        },
      ),
    ]);

    if (!inlineRes.ok || !convoRes.ok) return [];

    const inlineComments = githubPrCommentsSchema.parse(await inlineRes.json());
    const convoComments = githubCommentsResponseSchema.parse(
      await convoRes.json(),
    );

    const combined: string[] = [];

    for (const c of inlineComments) {
      if (!c.body) continue;
      const prefix = c.path ? `[${c.path}] ` : '';
      combined.push(`${prefix}${c.body}`);
    }

    for (const c of convoComments) {
      if (c.body && isReworkComment(c.body)) {
        combined.push(extractReworkContent(c.body));
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
