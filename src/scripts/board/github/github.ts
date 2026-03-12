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
import { githubHeaders, pingEndpoint } from '~/scripts/shared/http/http.js';
import type { PingResult } from '~/scripts/shared/http/http.js';
import type { Ticket } from '~/types/index.js';

const SAFE_REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const GITHUB_API = 'https://api.github.com';

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
): Promise<PingResult> {
  return pingEndpoint(
    `${GITHUB_API}/repos/${repo}`,
    githubHeaders(token),
    {
      401: '✗ GitHub auth failed — check GITHUB_TOKEN',
      403: '✗ GitHub permission denied',
      404: `✗ GitHub repo "${repo}" not found`,
    },
    '✗ Could not reach GitHub — check network',
  );
}

/**
 * Fetch the next available issue from GitHub Issues.
 *
 * Requests extra results to account for PR pollution (GitHub Issues endpoint
 * returns PRs too), then filters to real issues only.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @returns The fetched ticket with optional milestone, or `undefined` if none available.
 */
export async function fetchIssue(
  token: string,
  repo: string,
  label?: string,
): Promise<(Ticket & { milestone?: string }) | undefined> {
  let response: Response;

  const params = new URLSearchParams({
    state: 'open',
    assignee: '@me',
    per_page: '10',
  });

  if (label) params.set('labels', label);

  try {
    response = await fetch(`${GITHUB_API}/repos/${repo}/issues?${params}`, {
      headers: githubHeaders(token),
    });
  } catch (err) {
    console.warn(
      `⚠ GitHub API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  if (!response.ok) {
    console.warn(`⚠ GitHub API returned HTTP ${response.status}`);
    return undefined;
  }

  let json: unknown;

  try {
    json = await response.json();
  } catch {
    console.warn('⚠ GitHub API returned invalid JSON');
    return undefined;
  }

  const parsed = githubIssuesResponseSchema.safeParse(json);

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
  if (!isValidRepo(repo)) return false;

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${repo}/issues/${issueNumber}`,
      {
        method: 'PATCH',
        headers: {
          ...githubHeaders(token),
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
