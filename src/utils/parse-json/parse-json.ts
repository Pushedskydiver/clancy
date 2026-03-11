/**
 * Safely parse a JSON string, returning `undefined` on failure.
 *
 * Hooks and scripts receive JSON from external sources — this helper
 * avoids try/catch boilerplate and never throws.
 */
export function parseJson<T = unknown>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
