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
  const results = await fetchIssues(token, repo, label, username, false, 1);
  return results[0];
}

/** GitHub issue with optional milestone and labels. */
export type GitHubTicket = Ticket & { milestone?: string; labels?: string[] };

/**
 * Fetch multiple candidate issues from GitHub Issues.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @param label - Optional label to filter issues.
 * @param username - The GitHub username for assignee filtering.
 * @param excludeHitl - If `true`, excludes issues with the `clancy:hitl` label (client-side).
 * @param limit - Maximum number of results to return (default: 5).
 * @returns Array of fetched tickets (may be empty).
 */
export async function fetchIssues(
  token: string,
  repo: string,
  label?: string,
  username?: string,
  excludeHitl?: boolean,
  limit = 5,
): Promise<GitHubTicket[]> {
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
    return [];
  }

  if (!response.ok) {
    console.warn(`⚠ GitHub API returned HTTP ${response.status}`);
    return [];
  }

  let json: unknown;

  try {
    json = await response.json();
  } catch {
    console.warn('⚠ GitHub API returned invalid JSON');
    return [];
  }

  const parsed = githubIssuesResponseSchema.safeParse(json);

  if (!parsed.success) {
    console.warn(`⚠ Unexpected GitHub response shape: ${parsed.error.message}`);
    return [];
  }

  // Filter out pull requests
  let issues = parsed.data.filter((item) => !item.pull_request);

  // HITL/AFK filtering: exclude issues with clancy:hitl label
  // GitHub Issues API doesn't support label exclusion natively, so filter client-side.
  if (excludeHitl) {
    issues = issues.filter(
      (issue) => !issue.labels?.some((l) => l.name === 'clancy:hitl'),
    );
  }

  return issues.slice(0, limit).map((issue) => ({
    key: `#${issue.number}`,
    title: issue.title,
    description: issue.body ?? '',
    provider: 'github' as const,
    milestone: issue.milestone?.title,
    labels: issue.labels
      ?.map((l) => l.name)
      .filter((n): n is string => Boolean(n)),
  }));
}

/**
 * Check whether a GitHub issue is blocked by unresolved blockers.
 *
 * Parses the issue body for `Blocked by #N` lines and checks if any
 * of those issues are still open.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @param issueNumber - The issue number to check.
 * @param body - The issue body text.
 * @returns `true` if any blocker is unresolved, `false` otherwise.
 */
export async function fetchBlockerStatus(
  token: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<boolean> {
  if (!isValidRepo(repo)) return false;

  // Parse "Blocked by #N" references from the body
  const blockerPattern = /Blocked by #(\d+)/gi;
  const blockerNumbers = new Set<number>();
  let match: RegExpExecArray | null;

  while ((match = blockerPattern.exec(body)) !== null) {
    const num = parseInt(match[1], 10);
    if (!Number.isNaN(num) && num !== issueNumber) {
      blockerNumbers.add(num);
    }
  }

  if (!blockerNumbers.size) return false;

  try {
    for (const blockerNum of blockerNumbers) {
      const response = await fetch(
        `${GITHUB_API}/repos/${repo}/issues/${blockerNum}`,
        { headers: githubHeaders(token) },
      );

      if (!response.ok) continue;

      const json = (await response.json()) as { state?: string };

      // Short-circuit: one unresolved blocker is enough
      if (json.state !== 'closed') return true;
    }

    return false;
  } catch {
    return false;
  }
}

/** Result of checking children status for an epic/milestone. */
export type ChildrenStatus = { total: number; incomplete: number };

/**
 * Fetch the children status of a GitHub parent issue (dual-mode).
 *
 * Tries the `Epic: #{parentNumber}` text convention first. If no results,
 * falls back to the native `Parent: #{parentNumber}` convention for
 * backward compatibility with pre-v0.6.0 children.
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
    // Mode 1: Try Epic: text convention
    const epicTextResult = await fetchChildrenByBodyRef(
      token,
      repo,
      `Epic: #${parentNumber}`,
    );

    if (epicTextResult && epicTextResult.total > 0) return epicTextResult;

    // Mode 2: Fall back to native Parent: convention
    return await fetchChildrenByBodyRef(
      token,
      repo,
      `Parent: #${parentNumber}`,
    );
  } catch {
    return undefined;
  }
}

/**
 * Fetch children status by searching for a body reference string.
 *
 * @param token - The GitHub personal access token.
 * @param repo - The repository in `owner/repo` format.
 * @param bodyRef - The body reference string to search for.
 * @returns The children status, or `undefined` on failure.
 */
async function fetchChildrenByBodyRef(
  token: string,
  repo: string,
  bodyRef: string,
): Promise<ChildrenStatus | undefined> {
  // Use GitHub Search API with total_count for accurate counts.
  // Two queries: one for all children, one for open (incomplete) children.
  const headers = githubHeaders(token);

  const allQuery = `"${bodyRef}" repo:${repo} is:issue`;
  const allParams = new URLSearchParams({ q: allQuery, per_page: '1' });
  const allResponse = await fetch(`${GITHUB_API}/search/issues?${allParams}`, {
    headers,
  });
  if (!allResponse.ok) return undefined;

  const allResult = (await allResponse.json()) as { total_count?: number };
  const total = allResult.total_count ?? 0;

  if (total === 0) return { total: 0, incomplete: 0 };

  const openQuery = `"${bodyRef}" repo:${repo} is:issue is:open`;
  const openParams = new URLSearchParams({ q: openQuery, per_page: '1' });
  const openResponse = await fetch(
    `${GITHUB_API}/search/issues?${openParams}`,
    { headers },
  );
  if (!openResponse.ok) return { total, incomplete: total }; // assume all open on failure

  const openResult = (await openResponse.json()) as { total_count?: number };
  const incomplete = openResult.total_count ?? 0;

  return { total, incomplete };
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
