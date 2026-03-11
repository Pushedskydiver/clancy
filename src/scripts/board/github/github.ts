/**
 * Clancy GitHub Issues board script.
 *
 * Fetches an issue from GitHub Issues REST API, creates branches,
 * invokes Claude, squash merges, closes the issue, and sends notifications.
 *
 * Note: GitHub Issues endpoint returns both issues AND pull requests.
 * This script filters out PRs explicitly.
 */
import { githubIssuesResponseSchema } from '~/schemas/github.js';
import type { Ticket } from '~/types/index.js';

const SAFE_REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

type GitHubEnv = {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  CLANCY_BASE_BRANCH?: string;
  CLANCY_MODEL?: string;
  CLANCY_NOTIFY_WEBHOOK?: string;
};

/**
 * Validate that a GitHub repo string is in `owner/repo` format.
 *
 * @param repo - The repository string to validate.
 * @returns `true` if the string matches `owner/repo` with safe characters.
 */
export function isValidRepo(repo: string): boolean {
  return SAFE_REPO_PATTERN.test(repo);
}

/**
 * Ping the GitHub API to verify connectivity and credentials.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @returns An object with `ok` and optional `error` message.
 */
export async function pingGitHub(
  token: string,
  repo: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (response.ok) return { ok: true };

    if (response.status === 401)
      return {
        ok: false,
        error: '✗ GitHub auth failed — check GITHUB_TOKEN',
      };
    if (response.status === 403)
      return { ok: false, error: '✗ GitHub permission denied' };
    if (response.status === 404)
      return { ok: false, error: `✗ GitHub repo "${repo}" not found` };

    return {
      ok: false,
      error: `✗ GitHub returned HTTP ${response.status}`,
    };
  } catch {
    return { ok: false, error: '✗ Could not reach GitHub — check network' };
  }
}

/**
 * Slugify a milestone title for use as a branch name.
 *
 * Converts to lowercase, replaces spaces with hyphens, and strips
 * non-alphanumeric characters.
 *
 * @param title - The milestone title to slugify.
 * @returns The slugified branch-safe string.
 *
 * @example
 * ```ts
 * slugifyMilestone('Sprint 3 - Auth');  // 'sprint-3---auth'
 * slugifyMilestone('v1.0 Release');     // 'v10-release'
 * ```
 */
export function slugifyMilestone(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Fetch the next available issue from GitHub Issues.
 *
 * Requests 3 results to account for PR pollution (GitHub Issues endpoint
 * returns PRs too), then filters to real issues only.
 *
 * @param env - The GitHub environment variables.
 * @returns The fetched ticket with optional milestone, or `undefined` if none available.
 */
export async function fetchIssue(
  env: GitHubEnv,
): Promise<(Ticket & { milestone?: string }) | undefined> {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/issues?state=open&assignee=@me&labels=clancy&per_page=3`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!response.ok) return undefined;

  const parsed = githubIssuesResponseSchema.safeParse(await response.json());

  if (!parsed.success) {
    console.warn(`⚠ Unexpected GitHub response shape: ${parsed.error.message}`);
    return undefined;
  }

  // Filter out pull requests
  const issues = parsed.data.filter((item) => !item.pull_request);

  if (!issues.length) return undefined;

  const issue = issues[0];

  return {
    key: `#${issue.number}`,
    title: issue.title,
    description: issue.body ?? '',
    provider: 'github',
    milestone: issue.milestone?.title,
  };
}

/**
 * Close a GitHub issue.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @param issueNumber - The issue number to close.
 * @returns `true` if the issue was closed successfully.
 */
export async function closeIssue(
  token: string,
  repo: string,
  issueNumber: number,
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state: 'closed' }),
      },
    );

    return response.ok;
  } catch {
    return false;
  }
}
