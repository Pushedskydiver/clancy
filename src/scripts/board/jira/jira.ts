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
  jiraSearchResponseSchema,
  jiraTransitionsResponseSchema,
} from '~/schemas/jira.js';
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
): string {
  const parts = [`project="${projectKey}"`];

  if (sprint) parts.push('sprint in openSprints()');
  if (label) parts.push(`labels = "${label}"`);

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
  const jql = buildJql(projectKey, status, sprint, label);

  let response: Response;

  try {
    response = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        ...jiraHeaders(auth),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jql,
        maxResults: 1,
        fields: [
          'summary',
          'description',
          'issuelinks',
          'parent',
          'customfield_10014',
        ],
      }),
    });
  } catch (err) {
    console.warn(
      `⚠ Jira API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  if (!response.ok) {
    console.warn(`⚠ Jira API returned HTTP ${response.status}`);
    return undefined;
  }

  let json: unknown;

  try {
    json = await response.json();
  } catch {
    console.warn('⚠ Jira API returned invalid JSON');
    return undefined;
  }

  const parsed = jiraSearchResponseSchema.safeParse(json);

  if (!parsed.success) {
    console.warn(`⚠ Unexpected Jira response shape: ${parsed.error.message}`);
    return undefined;
  }

  if (!parsed.data.issues.length) return undefined;

  const issue = parsed.data.issues[0];
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
    provider: 'jira',
    epicKey,
    blockers,
  };
}

/** Result of checking children status for an epic. */
export type ChildrenStatus = { total: number; incomplete: number };

/**
 * Fetch the children status of a Jira epic.
 *
 * Returns the total number of children and how many are incomplete
 * (statusCategory != 'done'). Used to determine if an epic is complete.
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
    // Fetch all children
    const totalResponse = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        ...jiraHeaders(auth),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jql: `parent = ${parentKey}`,
        maxResults: 0,
      }),
    });

    if (!totalResponse.ok) return undefined;

    const totalJson = (await totalResponse.json()) as { total?: number };
    const total = totalJson.total ?? 0;

    if (total === 0) return { total: 0, incomplete: 0 };

    // Fetch incomplete children
    const incompleteResponse = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        ...jiraHeaders(auth),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jql: `parent = ${parentKey} AND statusCategory != "done"`,
        maxResults: 0,
      }),
    });

    if (!incompleteResponse.ok) return undefined;

    const incompleteJson = (await incompleteResponse.json()) as {
      total?: number;
    };
    const incomplete = incompleteJson.total ?? 0;

    return { total, incomplete };
  } catch {
    return undefined;
  }
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

  let response: Response;

  try {
    response = await fetch(
      `${baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
      { headers: jiraHeaders(auth) },
    );
  } catch (err) {
    console.warn(
      `⚠ Jira transitions request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  if (!response.ok) return undefined;

  let json: unknown;

  try {
    json = await response.json();
  } catch {
    console.warn('⚠ Jira transitions returned invalid JSON');
    return undefined;
  }

  const parsed = jiraTransitionsResponseSchema.safeParse(json);

  if (!parsed.success) {
    console.warn(
      `⚠ Unexpected Jira transitions response: ${parsed.error.message}`,
    );
    return undefined;
  }

  const transition = parsed.data.transitions.find((t) => t.name === statusName);

  return transition?.id;
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
