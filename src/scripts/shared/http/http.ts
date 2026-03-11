/**
 * Shared HTTP helpers for board scripts.
 *
 * Provides a generic ping function and header builders to reduce
 * boilerplate across Jira, GitHub, and Linear integrations.
 */

/** Standard error messages mapped to HTTP status codes. */
type StatusErrorMap = Record<number, string>;

/** Result from a ping or connectivity check. */
export type PingResult = { ok: boolean; error?: string };

/**
 * Ping an API endpoint and map common HTTP error codes to messages.
 *
 * Returns `{ ok: true }` on success, or `{ ok: false, error }` with
 * a human-readable message on failure.
 *
 * @param url - The URL to ping.
 * @param headers - HTTP headers to send.
 * @param statusErrors - Map of HTTP status codes to error messages.
 * @param networkError - Error message for network failures.
 * @returns A ping result with `ok` and optional `error`.
 *
 * @example
 * ```ts
 * const result = await pingEndpoint(
 *   'https://api.github.com/repos/owner/repo',
 *   { Authorization: 'Bearer tok_xxx' },
 *   { 401: '✗ Auth failed', 404: '✗ Not found' },
 *   '✗ Could not reach GitHub',
 * );
 * ```
 */
export async function pingEndpoint(
  url: string,
  headers: Record<string, string>,
  statusErrors: StatusErrorMap,
  networkError: string,
): Promise<PingResult> {
  try {
    const response = await fetch(url, { headers });

    if (response.ok) return { ok: true };

    const mapped = statusErrors[response.status];
    if (mapped) return { ok: false, error: mapped };

    return { ok: false, error: `✗ HTTP ${response.status}` };
  } catch {
    return { ok: false, error: networkError };
  }
}

/**
 * Build standard GitHub API request headers.
 *
 * @param token - The GitHub personal access token.
 * @returns Headers object for GitHub REST API requests.
 */
export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Build standard Jira API request headers.
 *
 * @param auth - The Base64-encoded Basic auth string.
 * @returns Headers object for Jira REST API requests.
 */
export function jiraHeaders(auth: string): Record<string, string> {
  return {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
  };
}
