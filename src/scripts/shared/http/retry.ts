/**
 * Fetch with automatic retry for transient failures.
 *
 * Handles 429 (rate limited) with Retry-After header, 5xx with exponential
 * backoff, and network errors. Non-retryable responses (4xx other than 429)
 * are returned immediately.
 */

/** Options for retry behaviour. */
export type RetryOptions = {
  /** Maximum number of retry attempts. Default: 3. */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 1000. */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds. Default: 10000. */
  maxDelayMs?: number;
};

/**
 * Parse a Retry-After header value into milliseconds.
 *
 * Supports both delta-seconds (e.g. "120") and HTTP-date formats.
 * Returns `undefined` if the header is missing or unparseable.
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;

  // Try as integer seconds first
  const seconds = parseInt(header, 10);
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;

  // Try as HTTP-date
  const date = new Date(header);
  if (!Number.isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : 0;
  }

  return undefined;
}

/** Compute exponential backoff delay, capped at maxDelayMs. */
function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const delay = baseDelayMs * 2 ** attempt;
  return Math.min(delay, maxDelayMs);
}

/** Whether an HTTP status code is retryable. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Fetch with automatic retry for transient failures.
 *
 * - On 429 (rate limited): honours `Retry-After` header, then retries.
 * - On 5xx: retries with exponential backoff.
 * - On other errors: returns the response immediately (no retry).
 * - On network error (fetch throws): retries with exponential backoff.
 * - After `maxRetries` exhausted: returns the last response or throws the
 *   last network error.
 *
 * @param url - The URL to fetch.
 * @param init - Optional fetch init (method, headers, body, etc.).
 * @param opts - Retry behaviour options.
 * @returns The fetch Response.
 */
export async function retryFetch(
  url: string,
  init?: RequestInit,
  opts?: RetryOptions,
): Promise<Response> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const maxDelayMs = opts?.maxDelayMs ?? 10_000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      // Non-retryable status — return immediately
      if (!isRetryableStatus(response.status)) return response;

      // Last attempt — return whatever we got
      if (attempt === maxRetries) return response;

      // Compute delay
      let delayMs: number;
      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
        delayMs = retryAfter ?? backoffDelay(attempt, baseDelayMs, maxDelayMs);
      } else {
        delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (err) {
      lastError = err;

      // Last attempt — throw
      if (attempt === maxRetries) throw lastError;

      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Unreachable — but TypeScript needs this
  throw lastError;
}
