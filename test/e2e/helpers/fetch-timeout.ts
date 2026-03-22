/**
 * Fetch wrapper with AbortController timeout for E2E helpers.
 *
 * Prevents cleanup, GC, and factory calls from hanging indefinitely
 * on network stalls or unresponsive APIs.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Fetch with a timeout. Aborts the request if it doesn't complete
 * within the given duration.
 *
 * @param url - The URL to fetch.
 * @param init - Standard fetch RequestInit options.
 * @param timeoutMs - Timeout in milliseconds (default 15s).
 * @returns The fetch Response.
 * @throws On network error or timeout.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`E2E fetch timeout after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
