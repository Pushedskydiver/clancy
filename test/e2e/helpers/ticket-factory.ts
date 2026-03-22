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
  getShortcutCredentials,
} from './env.js';

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
    case 'azdo':
      throw new Error(`createTestTicket not implemented for board: ${board}`);
  }
}

// ---------------------------------------------------------------------------
// GitHub Issues
// ---------------------------------------------------------------------------

/** Resolve the authenticated GitHub username via GET /user. */
async function resolveGitHubUsername(token: string): Promise<string> {
  const response = await fetch('https://api.github.com/user', {
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

  const response = await fetch(
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

function buildJiraAuth(user: string, apiToken: string): string {
  return Buffer.from(`${user}:${apiToken}`).toString('base64');
}

/** Resolve the authenticated Jira user's account ID via GET /myself. */
async function resolveJiraAccountId(
  baseUrl: string,
  auth: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/rest/api/3/myself`, {
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

  const response = await fetch(
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
          labels: ['clancy:build'],
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
  const response = await fetch(LINEAR_API_URL, {
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

/** Look up the first "unstarted" workflow state ID for the team. */
async function resolveLinearUnstartedStateId(
  apiKey: string,
  teamId: string,
): Promise<string> {
  const data = await linearGraphql<{
    workflowStates: { nodes: Array<{ id: string; name: string }> };
  }>(
    apiKey,
    `query($teamId: String!) {
      workflowStates(filter: { team: { id: { eq: $teamId } }, type: { eq: "unstarted" } }) {
        nodes { id name }
      }
    }`,
    { teamId },
  );

  const state = data.workflowStates.nodes[0];
  if (!state) throw new Error('No unstarted workflow state found for Linear team');
  return state.id;
}

/** Look up the label ID for a given label name, creating it if needed. */
async function resolveLinearLabelId(
  apiKey: string,
  teamId: string,
  labelName: string,
): Promise<string> {
  // Try to find existing label
  const data = await linearGraphql<{
    issueLabels: { nodes: Array<{ id: string; name: string }> };
  }>(
    apiKey,
    `query($teamId: String!, $name: String!) {
      issueLabels(filter: { team: { id: { eq: $teamId } }, name: { eq: $name } }) {
        nodes { id name }
      }
    }`,
    { teamId, name: labelName },
  );

  const existing = data.issueLabels.nodes.find((l) => l.name === labelName);
  if (existing) return existing.id;

  // Create it
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

  // Resolve state, label, and viewer IDs
  // Clancy's Linear fetch uses viewer.assignedIssues — ticket must be assigned
  const [stateId, labelId, viewerId] = await Promise.all([
    resolveLinearUnstartedStateId(creds.apiKey, creds.teamId),
    resolveLinearLabelId(creds.apiKey, creds.teamId, 'clancy:build'),
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
    { teamId: creds.teamId, title, stateId, labelIds: [labelId], assigneeId: viewerId },
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
  const response = await fetch(`${SHORTCUT_API}/workflows`, {
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
  const response = await fetch(`${SHORTCUT_API}/member`, {
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

  const response = await fetch(`${SHORTCUT_API}/stories`, {
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
