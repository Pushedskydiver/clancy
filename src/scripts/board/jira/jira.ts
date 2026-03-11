/**
 * Clancy Jira board script.
 *
 * Fetches a ticket from Jira Cloud, creates branches, invokes Claude,
 * squash merges, transitions status, and sends notifications.
 *
 * Uses the new POST `/rest/api/3/search/jql` endpoint (old GET `/search`
 * was removed by Atlassian in August 2025).
 */
import {
  jiraSearchResponseSchema,
  jiraTransitionsResponseSchema,
} from '~/schemas/jira.js';
import type { Ticket } from '~/types/index.js';

const SAFE_VALUE_PATTERN = /^[a-zA-Z0-9 _\-"'.]+$/;

type JiraEnv = {
  JIRA_BASE_URL: string;
  JIRA_USER: string;
  JIRA_API_TOKEN: string;
  JIRA_PROJECT_KEY: string;
  CLANCY_JQL_STATUS?: string;
  CLANCY_JQL_SPRINT?: string;
  CLANCY_LABEL?: string;
  CLANCY_BASE_BRANCH?: string;
  CLANCY_STATUS_IN_PROGRESS?: string;
  CLANCY_STATUS_DONE?: string;
  CLANCY_MODEL?: string;
  CLANCY_NOTIFY_WEBHOOK?: string;
};

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
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${baseUrl}/rest/api/3/project/${projectKey}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      },
    );

    if (response.ok) return { ok: true };

    if (response.status === 401)
      return { ok: false, error: '✗ Jira auth failed — check credentials' };
    if (response.status === 403)
      return { ok: false, error: '✗ Jira permission denied for this project' };
    if (response.status === 404)
      return {
        ok: false,
        error: `✗ Jira project "${projectKey}" not found`,
      };

    return {
      ok: false,
      error: `✗ Jira returned HTTP ${response.status}`,
    };
  } catch {
    return { ok: false, error: '✗ Could not reach Jira — check network' };
  }
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
  const parts = [`project=${projectKey}`];

  if (sprint) parts.push('sprint in openSprints()');
  if (label) parts.push(`labels = "${label}"`);

  parts.push(`assignee=currentUser()`);
  parts.push(`status="${status}"`);
  parts.push('ORDER BY priority ASC');

  return parts.join(' AND ');
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
 * @param env - The Jira environment variables.
 * @returns The fetched ticket, or `undefined` if no tickets are available.
 */
export async function fetchTicket(env: JiraEnv): Promise<
  | (Ticket & {
      epicKey?: string;
      blockers: string[];
    })
  | undefined
> {
  const status = env.CLANCY_JQL_STATUS ?? 'To Do';
  const auth = buildAuthHeader(env.JIRA_USER, env.JIRA_API_TOKEN);
  const jql = buildJql(
    env.JIRA_PROJECT_KEY,
    status,
    env.CLANCY_JQL_SPRINT,
    env.CLANCY_LABEL,
  );

  const response = await fetch(`${env.JIRA_BASE_URL}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
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

  if (!response.ok) return undefined;

  const parsed = jiraSearchResponseSchema.safeParse(await response.json());

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
    .map((link) => link.inwardIssue!.key!);

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
    // Fetch available transitions
    const transResponse = await fetch(
      `${baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      },
    );

    if (!transResponse.ok) return false;

    const parsed = jiraTransitionsResponseSchema.safeParse(
      await transResponse.json(),
    );

    if (!parsed.success) {
      console.warn(
        `⚠ Unexpected Jira transitions response: ${parsed.error.message}`,
      );
      return false;
    }

    const transition = parsed.data.transitions.find(
      (t) => t.name === statusName,
    );

    if (!transition) {
      console.warn(
        `⚠ Jira transition "${statusName}" not found for ${issueKey}`,
      );
      return false;
    }

    // Execute transition
    const execResponse = await fetch(
      `${baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transition: { id: transition.id } }),
      },
    );

    return execResponse.ok;
  } catch {
    return false;
  }
}
