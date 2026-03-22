/**
 * Shared Jira basic auth helper for E2E tests.
 *
 * Mirrors the runtime buildAuthHeader in src/scripts/board/jira/jira.ts.
 */

/** Build a Base64-encoded Basic auth string for Jira API requests. */
export function buildJiraAuth(user: string, apiToken: string): string {
  return Buffer.from(`${user}:${apiToken}`).toString('base64');
}
