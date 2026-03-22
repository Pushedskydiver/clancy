/**
 * Shared Azure DevOps auth helpers for E2E tests.
 *
 * Returns the Base64-encoded payload only (no "Basic " prefix).
 * Callers pass the result to azdoHeaders/azdoPatchHeaders which add the prefix.
 */

/** Build the Base64-encoded `:<PAT>` payload for Azure DevOps Basic auth. */
export function buildAzdoAuth(pat: string): string {
  return Buffer.from(`:${pat}`).toString('base64');
}

/** Standard JSON headers for Azure DevOps API requests. */
export function azdoHeaders(auth: string): Record<string, string> {
  return {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
  };
}

/** JSON Patch headers for Azure DevOps work item updates. */
export function azdoPatchHeaders(auth: string): Record<string, string> {
  return {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json-patch+json',
  };
}

/** Build the Azure DevOps API base URL. */
export function azdoBaseUrl(org: string, project: string): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis`;
}
