/**
 * Safely parse a JSON string, returning `undefined` on failure.
 *
 * Hooks and scripts receive JSON from external sources — this helper
 * avoids try/catch boilerplate and never throws.
 *
 * @param raw - The JSON string to parse.
 * @returns The parsed value cast to `T`, or `undefined` if parsing fails.
 *
 * @example
 * ```ts
 * const data = parseJson<{ name: string }>('{"name":"clancy"}');
 * // data?.name === 'clancy'
 *
 * const bad = parseJson('not json');
 * // bad === undefined
 * ```
 */
export function parseJson<T = unknown>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
