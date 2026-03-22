/**
 * E2E ticket factory — creates real tickets on board platforms.
 *
 * Each board has a createTestTicket implementation that calls the real API.
 * Ticket titles include a unique run ID for isolation between concurrent runs.
 */
import { githubHeaders, jiraHeaders } from '~/scripts/shared/http/http.js';

import {
  type E2EBoard,
  getGitHubCredentials,
  getJiraCredentials,
  getLinearCredentials,
  getNotionCredentials,
  getShortcutCredentials,
  getAzdoCredentials,
} from './env.js';
import { fetchWithTimeout } from './fetch-timeout.js';
import { buildAzdoAuth, azdoBaseUrl, azdoPatchHeaders } from './azdo-auth.js';
import { buildJiraAuth } from './jira-auth.js';

export interface CreateTicketOptions {
  /** Override the default ticket title suffix. */
  titleSuffix?: string;
}

export interface CreatedTicket {
  /** Board-specific ticket ID (e.g. issue number for GitHub). */
  id: string;
  /** Board-specific ticket key (e.g. '#42' for GitHub). */
  key: string;
  /** URL to the ticket on the board platform. */
  url: string;
}

/** Generate a unique run ID for test isolation. */
export function generateRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a test ticket on a real board platform.
 *
 * The ticket title includes `[QA]`, the board name, and a unique run ID
 * so orphan GC can identify and clean up test tickets.
 */
export async function createTestTicket(
  board: E2EBoard,
  runId: string,
  options: CreateTicketOptions = {},
): Promise<CreatedTicket> {
  switch (board) {
    case 'github':
      return createGitHubTicket(runId, options);
    case 'jira':
      return createJiraTicket(runId, options);
    case 'linear':
      return createLinearTicket(runId, options);
    case 'shortcut':
      return createShortcutTicket(runId, options);
    case 'notion':
      return createNotionTicket(runId, options);
    case 'azdo':
      return createAzdoTicket(runId, options);
  }
}

// ---------------------------------------------------------------------------
// GitHub Issues
// ---------------------------------------------------------------------------

/** Resolve the authenticated GitHub username via GET /user. */
async function resolveGitHubUsername(token: string): Promise<string> {
  const response = await fetchWithTimeout('https://api.github.com/user', {
    headers: githubHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`Failed to resolve GitHub username: ${response.status}`);
  }

  const data = (await response.json()) as { login: string };
  return data.login;
}

async function createGitHubTicket(
  runId: string,
  options: CreateTicketOptions,
): Promise<CreatedTicket> {
  const creds = getGitHubCredentials();
  if (!creds) throw new Error('GitHub credentials not available');

  // Resolve the authenticated username — Clancy's GitHub board only
  // fetches issues assigned to the authenticated user.
  const username = await resolveGitHubUsername(creds.token);

  const title = `[QA] E2E test — github — ${runId}${options.titleSuffix ? ` — ${options.titleSuffix}` : ''}`;
  const body = [
    '## Summary',
    '',
    'Automated E2E test ticket created by Clancy QA suite.',
    'This ticket will be cleaned up automatically after the test completes.',
    '',
    '## Acceptance Criteria',
    '',
    '- [ ] Simulated implementation passes verification',
    '- [ ] PR is created against the correct branch',
    '- [ ] Progress file is updated with DONE entry',
  ].join('\n');

  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${creds.repo}/issues`,
    {
      method: 'POST',
      headers: {
        ...githubHeaders(creds.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body,
        labels: ['clancy:build'],
        assignees: [username],
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create GitHub issue: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as {
    number: number;
    html_url: string;
  };

  return {
    id: String(data.number),
    key: `#${data.number}`,
    url: data.html_url,
  };
}

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

/** Resolve the authenticated Jira user's account ID via GET /myself. */
async function resolveJiraAccountId(
  baseUrl: string,
  auth: string,
): Promise<string> {
  const response = await fetchWithTimeout(`${baseUrl}/rest/api/3/myself`, {
    headers: jiraHeaders(auth),
  });

  if (!response.ok) {
    throw new Error(`Failed to resolve Jira account ID: ${response.status}`);
  }

  const data = (await response.json()) as { accountId: string };
  return data.accountId;
}

async function createJiraTicket(
  runId: string,
  options: CreateTicketOptions,
): Promise<CreatedTicket> {
  const creds = getJiraCredentials();
  if (!creds) throw new Error('Jira credentials not available');

  const auth = buildJiraAuth(creds.user, creds.apiToken);
  const title = `[QA] E2E test — jira — ${runId}${options.titleSuffix ? ` — ${options.titleSuffix}` : ''}`;

  // Resolve account ID — Clancy's Jira fetch filters by assignee=currentUser()
  const accountId = await resolveJiraAccountId(creds.baseUrl, auth);

  const response = await fetchWithTimeout(
    `${creds.baseUrl}/rest/api/3/issue`,
    {
      method: 'POST',
      headers: {
        ...jiraHeaders(auth),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          project: { key: creds.projectKey },
          summary: title,
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Automated E2E test ticket created by Clancy QA suite.',
                  },
                ],
              },
            ],
          },
          issuetype: { name: 'Task' },
          labels: ['clancy-build'],
          assignee: { accountId },
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create Jira issue: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as {
    id: string;
    key: string;
    self: string;
  };

  return {
    id: data.id,
    key: data.key,
    url: `${creds.baseUrl}/browse/${data.key}`,
  };
}

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

const LINEAR_API_URL = 'https://api.linear.app/graphql';

function linearHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: apiKey,
    'Content-Type': 'application/json',
  };
}

async function linearGraphql<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetchWithTimeout(LINEAR_API_URL, {
    method: 'POST',
    headers: linearHeaders(apiKey),
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Linear GraphQL error: ${response.status} ${text}`);
  }

  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0]!.message}`);
  }

  if (json.data == null) {
    throw new Error(
      `Linear GraphQL error: missing data in response: ${JSON.stringify(json)}`,
    );
  }

  return json.data;
}

/** Resolve the Linear team UUID from a key or UUID.
 * LINEAR_TEAM_ID may be a key (e.g. "clancy-qa") or UUID — resolve to UUID. */
async function resolveLinearTeamUuid(
  apiKey: string,
  teamIdOrKey: string,
): Promise<string> {
  // If it looks like a UUID, use it directly
  if (/^[0-9a-f]{8}-/.test(teamIdOrKey)) return teamIdOrKey;

  // Otherwise look up by key
  const data = await linearGraphql<{
    teams: { nodes: Array<{ id: string; key: string; name: string }> };
  }>(apiKey, `{ teams { nodes { id key name } } }`);

  const needle = teamIdOrKey.toLowerCase();
  const team = data.teams.nodes.find(
    (t) =>
      t.key.toLowerCase() === needle ||
      t.name.toLowerCase() === needle ||
      t.id === teamIdOrKey,
  );
  if (!team) {
    const available = data.teams.nodes
      .map((t) => `${t.key} (${t.name}) [${t.id}]`)
      .join(', ');
    throw new Error(
      `Linear team not found for "${teamIdOrKey}". Available: ${available}`,
    );
  }
  return team.id;
}

/** Look up the first "unstarted" workflow state ID for the team. */
async function resolveLinearUnstartedStateId(
  apiKey: string,
  teamUuid: string,
): Promise<string> {
  const data = await linearGraphql<{
    team: { states: { nodes: Array<{ id: string; name: string; type: string }> } };
  }>(
    apiKey,
    `query($teamId: String!) {
      team(id: $teamId) {
        states { nodes { id name type } }
      }
    }`,
    { teamId: teamUuid },
  );

  const state = data.team.states.nodes.find((s) => s.type === 'unstarted');
  if (!state) throw new Error('No unstarted workflow state found for Linear team');
  return state.id;
}

/** Look up the label ID for a given label name, creating it if needed.
 * Mirrors production pattern: query team labels, then create if missing. */
async function resolveLinearLabelId(
  apiKey: string,
  teamId: string,
  labelName: string,
): Promise<string> {
  // Check team labels (matches production linear-board.ts ensureLabel)
  const data = await linearGraphql<{
    team: { labels: { nodes: Array<{ id: string; name: string }> } };
  }>(
    apiKey,
    `query($teamId: String!) {
      team(id: $teamId) {
        labels { nodes { id name } }
      }
    }`,
    { teamId },
  );

  const existing = data.team.labels.nodes.find((l) => l.name === labelName);
  if (existing) return existing.id;

  // Create it on the team
  const created = await linearGraphql<{
    issueLabelCreate: { issueLabel: { id: string } };
  }>(
    apiKey,
    `mutation($teamId: String!, $name: String!) {
      issueLabelCreate(input: { teamId: $teamId, name: $name, color: "#0075ca" }) {
        issueLabel { id }
      }
    }`,
    { teamId, name: labelName },
  );

  return created.issueLabelCreate.issueLabel.id;
}

/** Resolve the authenticated Linear user's ID via viewer query. */
async function resolveLinearViewerId(apiKey: string): Promise<string> {
  const data = await linearGraphql<{ viewer: { id: string } }>(
    apiKey,
    `query { viewer { id } }`,
  );
  return data.viewer.id;
}

async function createLinearTicket(
  runId: string,
  options: CreateTicketOptions,
): Promise<CreatedTicket> {
  const creds = getLinearCredentials();
  if (!creds) throw new Error('Linear credentials not available');

  const title = `[QA] E2E test — linear — ${runId}${options.titleSuffix ? ` — ${options.titleSuffix}` : ''}`;

  // LINEAR_TEAM_ID may be a key (e.g. "clancy-qa") or UUID — resolve to UUID
  const teamUuid = await resolveLinearTeamUuid(creds.apiKey, creds.teamId);

  // Resolve state, label, and viewer IDs
  // Clancy's Linear fetch uses viewer.assignedIssues — ticket must be assigned
  const [stateId, labelId, viewerId] = await Promise.all([
    resolveLinearUnstartedStateId(creds.apiKey, teamUuid),
    resolveLinearLabelId(creds.apiKey, teamUuid, 'clancy:build'),
    resolveLinearViewerId(creds.apiKey),
  ]);

  const data = await linearGraphql<{
    issueCreate: {
      issue: { id: string; identifier: string; url: string };
    };
  }>(
    creds.apiKey,
    `mutation($teamId: String!, $title: String!, $stateId: String!, $labelIds: [String!], $assigneeId: String!) {
      issueCreate(input: {
        teamId: $teamId,
        title: $title,
        description: "Automated E2E test ticket created by Clancy QA suite.",
        stateId: $stateId,
        labelIds: $labelIds,
        assigneeId: $assigneeId,
      }) {
        issue { id identifier url }
      }
    }`,
    { teamId: teamUuid, title, stateId, labelIds: [labelId], assigneeId: viewerId },
  );

  const issue = data.issueCreate.issue;

  return {
    id: issue.id,
    key: issue.identifier,
    url: issue.url,
  };
}

// ---------------------------------------------------------------------------
// Shortcut
// ---------------------------------------------------------------------------

const SHORTCUT_API = 'https://api.app.shortcut.com/api/v3';

function shortcutHeaders(token: string): Record<string, string> {
  return {
    'Shortcut-Token': token,
    'Content-Type': 'application/json',
  };
}

/** Resolve the first "Unstarted" workflow state ID. */
async function resolveShortcutUnstartedStateId(
  token: string,
): Promise<number> {
  const response = await fetchWithTimeout(`${SHORTCUT_API}/workflows`, {
    headers: shortcutHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Shortcut workflows: ${response.status}`);
  }

  const workflows = (await response.json()) as Array<{
    states: Array<{ id: number; type: string }>;
  }>;

  for (const wf of workflows) {
    const state = wf.states.find((s) => s.type === 'unstarted');
    if (state) return state.id;
  }

  throw new Error('No unstarted workflow state found in Shortcut');
}

/** Resolve the authenticated member's ID. */
async function resolveShortcutMemberId(token: string): Promise<string> {
  const response = await fetchWithTimeout(`${SHORTCUT_API}/member-info`, {
    headers: shortcutHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`Failed to resolve Shortcut member: ${response.status}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

async function createShortcutTicket(
  runId: string,
  options: CreateTicketOptions,
): Promise<CreatedTicket> {
  const creds = getShortcutCredentials();
  if (!creds) throw new Error('Shortcut credentials not available');

  const title = `[QA] E2E test — shortcut — ${runId}${options.titleSuffix ? ` — ${options.titleSuffix}` : ''}`;

  const [stateId, memberId] = await Promise.all([
    resolveShortcutUnstartedStateId(creds.token),
    resolveShortcutMemberId(creds.token),
  ]);

  const response = await fetchWithTimeout(`${SHORTCUT_API}/stories`, {
    method: 'POST',
    headers: shortcutHeaders(creds.token),
    body: JSON.stringify({
      name: title,
      description: 'Automated E2E test ticket created by Clancy QA suite.',
      workflow_state_id: stateId,
      owner_ids: [memberId],
      labels: [{ name: 'clancy:build' }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create Shortcut story: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as {
    id: number;
    app_url: string;
  };

  return {
    id: String(data.id),
    key: `sc-${data.id}`,
    url: data.app_url,
  };
}

// ---------------------------------------------------------------------------
// Notion
// ---------------------------------------------------------------------------

const NOTION_API = 'https://api.notion.com/v1';

function notionHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };
}

async function createNotionTicket(
  runId: string,
  options: CreateTicketOptions,
): Promise<CreatedTicket> {
  const creds = getNotionCredentials();
  if (!creds) throw new Error('Notion credentials not available');

  const title = `[QA] E2E test — notion — ${runId}${options.titleSuffix ? ` — ${options.titleSuffix}` : ''}`;

  // Create a page in the database. Property names must match the sandbox DB schema.
  // Uses standard Notion property names — configurable via CLANCY_NOTION_* env vars at runtime.
  const response = await fetchWithTimeout(`${NOTION_API}/pages`, {
    method: 'POST',
    headers: notionHeaders(creds.token),
    body: JSON.stringify({
      parent: { database_id: creds.databaseId },
      properties: {
        Name: {
          title: [{ text: { content: title } }],
        },
        Status: {
          status: { name: 'To-do' },
        },
        Tags: {
          multi_select: [{ name: 'clancy:build' }],
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create Notion page: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as {
    id: string;
    url: string;
  };

  // Notion IDs are UUIDs — Clancy uses the short form (first 8 chars) as the key prefix
  const shortId = data.id.replace(/-/g, '').slice(0, 8);

  return {
    id: data.id,
    key: `notion-${shortId}`,
    url: data.url,
  };
}

// ---------------------------------------------------------------------------
// Azure DevOps
// ---------------------------------------------------------------------------

/** Resolve the authenticated Azure DevOps user's unique name via connectionData. */
async function resolveAzdoIdentity(
  org: string,
  auth: string,
): Promise<string> {
  const response = await fetchWithTimeout(
    `https://dev.azure.com/${encodeURIComponent(org)}/_apis/connectionData?api-version=7.1`,
    { headers: { Authorization: `Basic ${auth}` } },
  );

  if (!response.ok) {
    throw new Error(`Failed to resolve AzDo identity: ${response.status}`);
  }

  const data = (await response.json()) as {
    authenticatedUser: { uniqueName?: string; providerDisplayName?: string };
  };

  // uniqueName is the user's email/UPN — used for System.AssignedTo
  return data.authenticatedUser.uniqueName ?? data.authenticatedUser.providerDisplayName ?? '';
}

async function createAzdoTicket(
  runId: string,
  options: CreateTicketOptions,
): Promise<CreatedTicket> {
  const creds = getAzdoCredentials();
  if (!creds) throw new Error('Azure DevOps credentials not available');

  const auth = buildAzdoAuth(creds.pat);
  const base = azdoBaseUrl(creds.org, creds.project);
  const title = `[QA] E2E test — azdo — ${runId}${options.titleSuffix ? ` — ${options.titleSuffix}` : ''}`;

  // Resolve the PAT owner's identity for assignment
  const identity = await resolveAzdoIdentity(creds.org, auth);

  // Create a Task work item using JSON Patch operations
  const response = await fetchWithTimeout(
    `${base}/wit/workitems/$Task?api-version=7.1`,
    {
      method: 'POST',
      headers: azdoPatchHeaders(auth),
      body: JSON.stringify([
        { op: 'add', path: '/fields/System.Title', value: title },
        {
          op: 'add',
          path: '/fields/System.Description',
          value: 'Automated E2E test ticket created by Clancy QA suite.',
        },
        { op: 'add', path: '/fields/System.Tags', value: 'clancy:build' },
        { op: 'add', path: '/fields/System.AssignedTo', value: identity },
      ]),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create Azure DevOps work item: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as {
    id: number;
    _links: { html: { href: string } };
  };

  return {
    id: String(data.id),
    key: `azdo-${data.id}`,
    url: data._links.html.href,
  };
}
