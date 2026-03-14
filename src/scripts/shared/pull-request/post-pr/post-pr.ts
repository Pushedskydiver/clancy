/**
 * Shared pull request creation utility.
 *
 * Wraps the common POST + error-handling pattern used by all three
 * git host PR creation functions (GitHub, GitLab, Bitbucket).
 */
import type { PrCreationResult } from '~/types/index.js';

/**
 * POST a pull request / merge request and return a typed result.
 *
 * Handles the common try/catch, response parsing, error formatting,
 * and "already exists" detection shared by all git host implementations.
 *
 * @param url - The API endpoint to POST to.
 * @param headers - HTTP headers (including auth).
 * @param body - The request body (JSON-serialised).
 * @param parseSuccess - Extract `{ url, number }` from the success response JSON.
 * @param isAlreadyExists - Optional check for duplicate PR detection.
 * @returns A typed `PrCreationResult`.
 */
export async function postPullRequest(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  parseSuccess: (json: unknown) => { url: string; number: number },
  isAlreadyExists?: (status: number, text: string) => boolean,
): Promise<PrCreationResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const alreadyExists = isAlreadyExists?.(response.status, text) ?? false;

      return {
        ok: false,
        error: `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
        alreadyExists,
      };
    }

    const json: unknown = await response.json();
    const { url: prUrl, number } = parseSuccess(json);

    return { ok: true, url: prUrl, number };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Build a Basic Auth header value from username and token.
 *
 * Used by Bitbucket Cloud which requires HTTP Basic Auth.
 */
export function basicAuth(username: string, token: string): string {
  return `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
}
