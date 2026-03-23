/**
 * Clancy Jira board script.
 *
 * Fetches a ticket from Jira Cloud, creates branches, invokes Claude,
 * pushes feature branches, creates PRs, and transitions status.
 *
 * Uses the new POST `/rest/api/3/search/jql` endpoint (old GET `/search`
 * was removed by Atlassian in August 2025).
 */
import {
  jiraIssueLinksResponseSchema,
  jiraSearchResponseSchema,
  jiraTransitionsResponseSchema,
} from '~/schemas/jira.js';
import { fetchAndParse } from '~/scripts/shared/http/fetch-and-parse.js';
import { jiraHeaders, pingEndpoint } from '~/scripts/shared/http/http.js';
import type { PingResult } from '~/scripts/shared/http/http.js';
import type { Ticket } from '~/types/index.js';

const SAFE_VALUE_PATTERN = /^[a-zA-Z0-9 _\-'.]+$/;
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

/**
 * Build Jira Basic auth header value.
 *
 * @param user - The Jira username (email).
 * @param token - The Jira API token.
 * @returns The Base64-encoded `user:token` string for Basic auth.
 */
export function buildAuthHeader(user: string, token: string): string {
  return Buffer.from(`${user}:${token}`).toString('base64');
}

/**
 * Validate that a user-controlled value is safe for JQL injection.
 *
 * @param value - The value to validate.
 * @returns `true` if the value matches the safe pattern.
 */
export function isSafeJqlValue(value: string): boolean {
  return SAFE_VALUE_PATTERN.test(value);
}

/**
 * Ping the Jira API to verify connectivity and credentials.
 *
 * @param baseUrl - The Jira Cloud base URL.
 * @param projectKey - The Jira project key.
 * @param auth - The Base64-encoded Basic auth string.
 * @returns An object with `ok` and optional `error` message.
 *
 * @example
 * ```ts
 * const result = await pingJira('https://example.atlassian.net', 'PROJ', authHeader);
 * if (!result.ok) console.error(result.error);
 * ```
 */
export async function pingJira(
  baseUrl: string,
  projectKey: string,
  auth: string,
): Promise<PingResult> {
  return pingEndpoint(
    `${baseUrl}/rest/api/3/project/${projectKey}`,
    jiraHeaders(auth),
    {
      401: '✗ Jira auth failed — check credentials',
      403: '✗ Jira permission denied for this project',
      404: `✗ Jira project "${projectKey}" not found`,
    },
    '✗ Could not reach Jira — check network',
  );
}

/**
 * Build the JQL query for fetching the next ticket.
 *
 * @param projectKey - The Jira project key.
 * @param status - The JQL status to filter by (default: `"To Do"`).
 * @param sprint - If set, adds an open sprint filter.
 * @param label - If set, adds a label filter.
 * @returns The JQL query string.
 */
export function buildJql(
  projectKey: string,
  status: string,
  sprint?: string,
  label?: string,
  excludeHitl?: boolean,
): string {
  const parts = [`project="${projectKey}"`];

  if (sprint) parts.push('sprint in openSprints()');
  if (label) parts.push(`labels = "${label}"`);
  if (excludeHitl) parts.push('labels != "clancy:hitl"');

  parts.push(`assignee=currentUser()`);
  parts.push(`status="${status}"`);

  return parts.join(' AND ') + ' ORDER BY priority ASC';
}

/**
 * Extract all text strings from a Jira ADF (Atlassian Document Format) description.
 *
 * Recursively walks the ADF tree and collects all string values.
 *
 * @param adf - The ADF description object (or `undefined`).
 * @returns A single string with all text content joined by spaces.
 */
export function extractAdfText(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return '';

  const strings: string[] = [];

  function walk(node: unknown): void {
    if (typeof node === 'string') {
      strings.push(node);
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (node && typeof node === 'object') {
      for (const value of Object.values(node as Record<string, unknown>)) {
        walk(value);
      }
    }
  }

  walk(adf);

  return strings.join(' ');
}

/**
 * Fetch the next available ticket from Jira.
 *
 * @param baseUrl - The Jira Cloud base URL.
 * @param auth - The Base64-encoded Basic auth string.
 * @param projectKey - The Jira project key.
 * @param status - The JQL status to filter by.
 * @param sprint - Optional sprint filter.
 * @param label - Optional label filter.
 * @returns The fetched ticket, or `undefined` if no tickets are available.
 */
export async function fetchTicket(
  baseUrl: string,
  auth: string,
  projectKey: string,
  status: string,
  sprint?: string,
  label?: string,
): Promise<
  | (Ticket & {
      epicKey?: string;
      blockers: string[];
    })
  | undefined
> {
  const results = await fetchTickets(
    baseUrl,
    auth,
    projectKey,
    status,
    sprint,
    label,
    false,
    1,
  );
  return results[0];
}

/** Jira ticket with epic, blocker, and label info. */
export type JiraTicket = Ticket & {
  epicKey?: string;
  blockers: string[];
  labels?: string[];
};

/**
 * Fetch multiple candidate tickets from Jira.
 *
 * @param baseUrl - The Jira Cloud base URL.
 * @param auth - The Base64-encoded Basic auth string.
 * @param projectKey - The Jira project key.
 * @param status - The JQL status to filter by.
 * @param sprint - Optional sprint filter.
 * @param label - Optional label filter.
 * @param excludeHitl - If `true`, excludes tickets with the `clancy:hitl` label.
 * @param limit - Maximum number of results to return (default: 5).
 * @returns Array of fetched tickets (may be empty).
 */
export async function fetchTickets(
  baseUrl: string,
  auth: string,
  projectKey: string,
  status: string,
  sprint?: string,
  label?: string,
  excludeHitl?: boolean,
  limit = 5,
): Promise<JiraTicket[]> {
  const jql = buildJql(projectKey, status, sprint, label, excludeHitl);

  const data = await fetchAndParse(
    `${baseUrl}/rest/api/3/search/jql`,
    {
      method: 'POST',
      headers: {
        ...jiraHeaders(auth),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jql,
        maxResults: limit,
        fields: [
          'summary',
          'description',
          'issuelinks',
          'parent',
          'customfield_10014',
          'labels',
        ],
      }),
    },
    { schema: jiraSearchResponseSchema, label: 'Jira API' },
  );

  if (!data) return [];

  return data.issues.map((issue) => {
    const fields = issue.fields;

    // Extract blockers
    const blockers = (fields.issuelinks ?? [])
      .filter((link) => link.type?.name === 'Blocks' && link.inwardIssue?.key)
      .map((link) => link.inwardIssue?.key)
      .filter((key): key is string => Boolean(key));

    // Extract epic (next-gen parent OR classic customfield)
    const epicKey = fields.parent?.key ?? fields.customfield_10014 ?? undefined;

    return {
      key: issue.key,
      title: fields.summary,
      description: extractAdfText(fields.description),
      provider: 'jira' as const,
      epicKey,
      blockers,
      labels: fields.labels,
    };
  });
}

/**
 * Check whether a Jira issue is blocked by unresolved blockers.
 *
 * Fetches the issue's links and checks for inward "Blocks" relationships
 * where the blocking issue's statusCategory is not "done".
 *
 * @param baseUrl - The Jira Cloud base URL.
 * @param auth - The Base64-encoded Basic auth string.
 * @param key - The Jira issue key (e.g., `'PROJ-123'`).
 * @returns `true` if any blocker is unresolved, `false` otherwise.
 */
export async function fetchBlockerStatus(
  baseUrl: string,
  auth: string,
  key: string,
): Promise<boolean> {
  if (!ISSUE_KEY_PATTERN.test(key)) return false;

  try {
    const response = await fetch(
      `${baseUrl}/rest/api/3/issue/${key}?fields=issuelinks`,
      { headers: jiraHeaders(auth) },
    );

    if (!response.ok) return false;

    const json: unknown = await response.json();
    const parsed = jiraIssueLinksResponseSchema.safeParse(json);

    if (!parsed.success) return false;

    const links = parsed.data.fields?.issuelinks ?? [];

    // Check for inward "Blocks" links with unresolved status
    return links.some((link) => {
      if (link.type?.name !== 'Blocks') return false;
      if (!link.inwardIssue?.key) return false;

      const categoryKey = link.inwardIssue.fields?.status?.statusCategory?.key;

      // If status info is missing, assume not blocked
      if (!categoryKey) return false;

      return categoryKey !== 'done';
    });
  } catch {
    return false;
  }
}

/** Result of checking children status for an epic. */
export type ChildrenStatus = { total: number; incomplete: number };

/**
 * Fetch the children status of a Jira epic (dual-mode).
 *
 * Tries the `Epic: {key}` text convention first (children with "Epic: PROJ-100"
 * in their description). If no results, falls back to the native `parent = {key}`
 * JQL query for backward compatibility with pre-v0.6.0 children.
 *
 * @param baseUrl - The Jira Cloud base URL.
 * @param auth - The Base64-encoded Basic auth string.
 * @param parentKey - The parent issue key (e.g., `'PROJ-100'`).
 * @returns The children status, or `undefined` on failure.
 */
export async function fetchChildrenStatus(
  baseUrl: string,
  auth: string,
  parentKey: string,
): Promise<ChildrenStatus | undefined> {
  if (!ISSUE_KEY_PATTERN.test(parentKey)) return undefined;

  try {
    // Mode 1: Try Epic: text convention (scoped to project to avoid cross-project matches)
    const projectPrefix = parentKey.split('-')[0];
    const epicTextResult = await fetchChildrenByJql(
      baseUrl,
      auth,
      `project = "${projectPrefix}" AND description ~ "Epic: ${parentKey}"`,
    );

    if (epicTextResult && epicTextResult.total > 0) return epicTextResult;

    // Mode 2: Fall back to native parent API
    return await fetchChildrenByJql(baseUrl, auth, `parent = ${parentKey}`);
  } catch {
    return undefined;
  }
}

/**
 * Fetch children status using a JQL query (total and incomplete counts).
 *
 * @param baseUrl - The Jira Cloud base URL.
 * @param auth - The Base64-encoded Basic auth string.
 * @param jql - The JQL query to find children.
 * @returns The children status, or `undefined` on failure.
 */
async function fetchChildrenByJql(
  baseUrl: string,
  auth: string,
  jql: string,
): Promise<ChildrenStatus | undefined> {
  // Fetch total count
  const totalResponse = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: {
      ...jiraHeaders(auth),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jql, maxResults: 0 }),
  });

  if (!totalResponse.ok) return undefined;

  const totalJson = (await totalResponse.json()) as { total?: number };
  const total = totalJson.total ?? 0;

  if (total === 0) return { total: 0, incomplete: 0 };

  // Fetch incomplete count
  const incompleteResponse = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: {
      ...jiraHeaders(auth),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jql: `${jql} AND statusCategory != "done"`,
      maxResults: 0,
    }),
  });

  if (!incompleteResponse.ok) return undefined;

  const incompleteJson = (await incompleteResponse.json()) as {
    total?: number;
  };
  const incomplete = incompleteJson.total ?? 0;

  return { total, incomplete };
}

/**
 * Look up a Jira transition ID by status name.
 *
 * @param baseUrl - The Jira Cloud base URL.
 * @param auth - The Base64-encoded Basic auth string.
 * @param issueKey - The Jira issue key (e.g., `'PROJ-123'`).
 * @param statusName - The target status name (e.g., `'In Progress'`).
 * @returns The transition ID, or `undefined` if not found.
 */
export async function lookupTransitionId(
  baseUrl: string,
  auth: string,
  issueKey: string,
  statusName: string,
): Promise<string | undefined> {
  if (!ISSUE_KEY_PATTERN.test(issueKey)) return undefined;

  const data = await fetchAndParse(
    `${baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
    { headers: jiraHeaders(auth) },
    { schema: jiraTransitionsResponseSchema, label: 'Jira transitions' },
  );

  return data?.transitions.find((t) => t.name === statusName)?.id;
}

/**
 * Transition a Jira issue to a new status.
 *
 * Fetches available transitions and executes the one matching the target status name.
 * Best-effort — never throws on failure.
 *
 * @param baseUrl - The Jira Cloud base URL.
 * @param auth - The Base64-encoded Basic auth string.
 * @param issueKey - The Jira issue key (e.g., `'PROJ-123'`).
 * @param statusName - The target status name (e.g., `'In Progress'`).
 * @returns `true` if the transition succeeded.
 */
export async function transitionIssue(
  baseUrl: string,
  auth: string,
  issueKey: string,
  statusName: string,
): Promise<boolean> {
  try {
    const transitionId = await lookupTransitionId(
      baseUrl,
      auth,
      issueKey,
      statusName,
    );

    if (!transitionId) {
      console.warn(
        `⚠ Jira transition "${statusName}" not found for ${issueKey}`,
      );
      return false;
    }

    const response = await fetch(
      `${baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
      {
        method: 'POST',
        headers: {
          ...jiraHeaders(auth),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transition: { id: transitionId } }),
      },
    );

    return response.ok;
  } catch {
    return false;
  }
}
