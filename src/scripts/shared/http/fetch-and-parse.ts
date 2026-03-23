/**
 * Generic fetch → parse → validate utility.
 *
 * Eliminates the repeated try/fetch/check-ok/parse-json/validate-zod
 * boilerplate across board modules. Scoped to single HTTP requests with
 * JSON responses validated by a Zod schema.
 *
 * Boards with pagination (Notion), multi-step fetches (Azure DevOps),
 * or deep response unwrapping (Linear) keep their own wrappers that
 * call this function internally.
 */
import type { ZodMiniType } from 'zod/mini';

/** Options for {@link fetchAndParse}. */
export type FetchAndParseOptions<T> = {
  /** Zod schema to validate the response body against. */
  schema: ZodMiniType<T>;
  /** Human-readable label for error messages (e.g., `'Jira API'`). */
  label: string;
  /** Custom fetch function (e.g., `retryFetch` for Notion rate limits). Defaults to global `fetch`. */
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
};

/**
 * Fetch a URL, parse the JSON response, and validate it against a Zod schema.
 *
 * Returns the parsed data on success, or `undefined` on any failure
 * (network error, non-OK status, invalid JSON, schema mismatch).
 * All failures are logged to `console.warn` with the provided label.
 *
 * @param url - The URL to fetch.
 * @param init - Standard `fetch` RequestInit options.
 * @param opts - Schema and label for validation and error messages.
 * @returns The parsed and validated data, or `undefined` on failure.
 */
export async function fetchAndParse<T>(
  url: string,
  init: RequestInit | undefined,
  opts: FetchAndParseOptions<T>,
): Promise<T | undefined> {
  const { schema, label, fetcher = fetch } = opts;

  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch (err) {
    console.warn(
      `⚠ ${label} request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.text();
      if (body) detail = ` — ${body.slice(0, 200)}`;
    } catch {
      // ignore body read failure
    }
    console.warn(`⚠ ${label} returned HTTP ${response.status}${detail}`);
    return undefined;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    console.warn(`⚠ ${label} returned invalid JSON`);
    return undefined;
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.warn(
      `⚠ ${label} unexpected response shape: ${parsed.error.message}`,
    );
    return undefined;
  }

  return parsed.data;
}
