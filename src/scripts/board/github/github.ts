/**
 * Clancy GitHub Issues board script.
 *
 * Fetches an issue from GitHub Issues REST API, creates branches,
 * invokes Claude, pushes feature branches, and creates PRs.
 *
 * Note: GitHub Issues endpoint returns both issues AND pull requests.
 * This script filters out PRs explicitly.
 */
import { z } from 'zod/mini';

import { githubIssuesResponseSchema } from '~/schemas/github-issues.js';
import {
  GITHUB_API,
  githubHeaders,
  pingEndpoint,
} from '~/scripts/shared/http/http.js';
import type { PingResult } from '~/scripts/shared/http/http.js';
import type { Ticket } from '~/types/index.js';

/** Schema for the `GET /user` response. */
const githubUserSchema = z.object({
  login: z.string(),
});

const SAFE_REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

/** Cached username to avoid repeated /user calls. */
let cachedUsername: string | undefined;

/** Reset the cached username. Exported for testing only. */
export function resetUsernameCache(): void {
  cachedUsername = undefined;
}

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
 * Resolve the authenticated GitHub username from the token.
 *
 * Uses `GET /user` and caches the result for the lifetime of the process.
 * Falls back to `@me` if the API call fails (classic PATs support `@me`).
 *
 * Fine-grained PATs do NOT resolve `@me` in the Issues API `assignee` param,
 * so this function ensures we always have the real username.
 *
 * @param token - The GitHub personal access token.
 * @returns The GitHub username, or `@me` as a fallback.
 */
export async function resolveUsername(
  token: string,
  apiBase?: string,
): Promise<string> {
  if (cachedUsername) return cachedUsername;

  try {
    const response = await fetch(`${apiBase ?? GITHUB_API}/user`, {
      headers: githubHeaders(token),
    });

    if (!response.ok) {
      const hint =
        response.status === 401 || response.status === 403
          ? ' Fine-grained PATs need "Account permissions → read" (or classic PATs need read:user scope).'
          : '';
      console.warn(
        `⚠ GitHub /user returned HTTP ${response.status} — falling back to @me.${hint}`,
      );
      return '@me';
    }

    const json: unknown = await response.json();
    const parsed = githubUserSchema.safeParse(json);

    if (parsed.success) {
      cachedUsername = parsed.data.login;
      return cachedUsername;
    }

    console.warn('⚠ Unexpected GitHub /user response — falling back to @me');
  } catch (err) {
    console.warn(
      `⚠ GitHub /user request failed: ${err instanceof Error ? err.message : String(err)} — falling back to @me`,
    );
  }

  return '@me';
}

/**
 * Fetch the next available issue from GitHub Issues.
 *
 * Requests extra results to account for PR pollution (GitHub Issues endpoint
 * returns PRs too), then filters to real issues only.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @param label - Optional label to filter issues.
 * @param username - The GitHub username for assignee filtering (resolved via {@link resolveUsername}).
 * @returns The fetched ticket with optional milestone, or `undefined` if none available.
 */
export async function fetchIssue(
  token: string,
  repo: string,
  label?: string,
  username?: string,
): Promise<(Ticket & { milestone?: string }) | undefined> {
  let response: Response;

  const params = new URLSearchParams({
    state: 'open',
    assignee: username ?? '@me',
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

/** Result of checking children status for an epic/milestone. */
export type ChildrenStatus = { total: number; incomplete: number };

/**
 * Fetch the children status of a GitHub parent issue.
 *
 * Searches for issues whose body contains `Parent: #{parentNumber}` and
 * counts total vs open. Used to determine if all children are done.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @param parentNumber - The parent issue number.
 * @returns The children status, or `undefined` on failure.
 */
export async function fetchChildrenStatus(
  token: string,
  repo: string,
  parentNumber: number,
): Promise<ChildrenStatus | undefined> {
  if (!isValidRepo(repo)) return undefined;

  try {
    // Fetch all issues (open + closed) and filter for parent reference
    const allParams = new URLSearchParams({
      state: 'all',
      per_page: '100',
    });
    const allResponse = await fetch(
      `${GITHUB_API}/repos/${repo}/issues?${allParams}`,
      { headers: githubHeaders(token) },
    );
    if (!allResponse.ok) return undefined;

    const allIssues = (await allResponse.json()) as Array<{
      body?: string | null;
      pull_request?: unknown;
      state?: string;
    }>;

    const parentRef = `Parent: #${parentNumber}`;
    const children = allIssues.filter(
      (issue) =>
        !issue.pull_request && issue.body && issue.body.includes(parentRef),
    );

    const total = children.length;
    const incomplete = children.filter((c) => c.state === 'open').length;

    return { total, incomplete };
  } catch {
    return undefined;
  }
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
