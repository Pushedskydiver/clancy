/**
 * Clancy Linear board script.
 *
 * Fetches an issue from Linear's GraphQL API, creates branches,
 * invokes Claude, squash merges, transitions status, and sends notifications.
 *
 * Important: Linear personal API keys do NOT use "Bearer" prefix.
 * Only OAuth tokens use "Bearer". This is intentional per Linear docs.
 */
import {
  linearIssueUpdateResponseSchema,
  linearIssuesResponseSchema,
  linearViewerResponseSchema,
  linearWorkflowStatesResponseSchema,
} from '~/schemas/linear.js';
import type { Ticket } from '~/types/index.js';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const LINEAR_API_URL = 'https://api.linear.app/graphql';

type LinearEnv = {
  LINEAR_API_KEY: string;
  LINEAR_TEAM_ID: string;
  CLANCY_LABEL?: string;
  CLANCY_BASE_BRANCH?: string;
  CLANCY_STATUS_IN_PROGRESS?: string;
  CLANCY_STATUS_DONE?: string;
  CLANCY_MODEL?: string;
  CLANCY_NOTIFY_WEBHOOK?: string;
};

/**
 * Validate that a team ID is safe for use in GraphQL variables.
 *
 * @param teamId - The Linear team ID to validate.
 * @returns `true` if the ID matches the safe pattern.
 */
export function isValidTeamId(teamId: string): boolean {
  return SAFE_ID_PATTERN.test(teamId);
}

/**
 * Make a GraphQL request to the Linear API.
 *
 * Personal API keys are passed directly (no "Bearer" prefix).
 *
 * @param apiKey - The Linear personal API key.
 * @param query - The GraphQL query string.
 * @param variables - The GraphQL variables object.
 * @returns The raw JSON response, or `undefined` on failure.
 */
export async function linearGraphql(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  try {
    const response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) return undefined;

    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Ping the Linear API to verify connectivity and credentials.
 *
 * @param apiKey - The Linear personal API key.
 * @returns An object with `ok` and optional `error` message.
 */
export async function pingLinear(
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const raw = await linearGraphql(apiKey, '{ viewer { id } }');
  const parsed = linearViewerResponseSchema.safeParse(raw);

  if (parsed.success && parsed.data.data?.viewer?.id) return { ok: true };

  return { ok: false, error: '✗ Linear auth failed — check LINEAR_API_KEY' };
}

/**
 * Fetch the next available issue from Linear.
 *
 * Filters by `state.type: "unstarted"` (enum, works regardless of team
 * column naming) and optionally by label.
 *
 * @param env - The Linear environment variables.
 * @returns The fetched ticket with optional parent info, or `undefined` if none available.
 */
export async function fetchIssue(env: LinearEnv): Promise<
  | (Ticket & {
      issueId: string;
      parentIdentifier?: string;
    })
  | undefined
> {
  const hasLabel = env.CLANCY_LABEL && SAFE_ID_PATTERN.test(env.CLANCY_LABEL);

  const labelFilter = hasLabel ? 'labels: { name: { eq: $label } }' : '';

  const query = `
    query($teamId: String!${hasLabel ? ', $label: String!' : ''}) {
      viewer {
        assignedIssues(
          filter: {
            state: { type: { eq: "unstarted" } }
            team: { id: { eq: $teamId } }
            ${labelFilter}
          }
          first: 1
          orderBy: priority
        ) {
          nodes {
            id
            identifier
            title
            description
            parent { identifier title }
          }
        }
      }
    }
  `;

  const variables: Record<string, unknown> = {
    teamId: env.LINEAR_TEAM_ID,
  };

  if (hasLabel) variables.label = env.CLANCY_LABEL;

  const raw = await linearGraphql(env.LINEAR_API_KEY, query, variables);
  const parsed = linearIssuesResponseSchema.safeParse(raw);

  if (!parsed.success) {
    console.warn(`⚠ Unexpected Linear response shape: ${parsed.error.message}`);
    return undefined;
  }

  const nodes = parsed.data.data?.viewer?.assignedIssues?.nodes;

  if (!nodes?.length) return undefined;

  const issue = nodes[0];

  return {
    key: issue.identifier,
    title: issue.title,
    description: issue.description ?? '',
    provider: 'linear',
    issueId: issue.id,
    parentIdentifier: issue.parent?.identifier,
  };
}

/**
 * Look up a Linear workflow state ID by name and team.
 *
 * @param apiKey - The Linear personal API key.
 * @param teamId - The Linear team ID.
 * @param stateName - The workflow state name (e.g., `'In Progress'`).
 * @returns The state ID, or `undefined` if not found.
 */
export async function lookupWorkflowStateId(
  apiKey: string,
  teamId: string,
  stateName: string,
): Promise<string | undefined> {
  const query = `
    query($teamId: String!, $name: String!) {
      workflowStates(filter: {
        team: { id: { eq: $teamId } }
        name: { eq: $name }
      }) {
        nodes { id }
      }
    }
  `;

  const raw = await linearGraphql(apiKey, query, { teamId, name: stateName });
  const parsed = linearWorkflowStatesResponseSchema.safeParse(raw);

  if (!parsed.success) {
    console.warn(
      `⚠ Unexpected Linear workflowStates response: ${parsed.error.message}`,
    );
    return undefined;
  }

  return parsed.data.data?.workflowStates?.nodes?.[0]?.id;
}

/**
 * Execute a state transition on a Linear issue.
 *
 * @param apiKey - The Linear personal API key.
 * @param issueId - The Linear issue internal ID.
 * @param stateId - The target workflow state ID.
 * @returns `true` if the mutation succeeded.
 */
export async function executeStateTransition(
  apiKey: string,
  issueId: string,
  stateId: string,
): Promise<boolean> {
  const mutation = `
    mutation($issueId: String!, $stateId: String!) {
      issueUpdate(id: $issueId, input: { stateId: $stateId }) {
        success
      }
    }
  `;

  const raw = await linearGraphql(apiKey, mutation, { issueId, stateId });
  const parsed = linearIssueUpdateResponseSchema.safeParse(raw);

  if (!parsed.success) {
    console.warn(
      `⚠ Unexpected Linear issueUpdate response: ${parsed.error.message}`,
    );
    return false;
  }

  return parsed.data.data?.issueUpdate?.success === true;
}

/**
 * Transition a Linear issue to a new workflow state.
 *
 * Looks up the workflow state ID by name, then executes the `issueUpdate` mutation.
 * Best-effort — never throws on failure.
 *
 * @param apiKey - The Linear personal API key.
 * @param teamId - The Linear team ID.
 * @param issueId - The Linear issue internal ID.
 * @param stateName - The target workflow state name (e.g., `'In Progress'`).
 * @returns `true` if the transition succeeded.
 */
export async function transitionIssue(
  apiKey: string,
  teamId: string,
  issueId: string,
  stateName: string,
): Promise<boolean> {
  try {
    const stateId = await lookupWorkflowStateId(apiKey, teamId, stateName);

    if (!stateId) {
      console.warn(
        `⚠ Linear workflow state "${stateName}" not found — check team configuration`,
      );
      return false;
    }

    return await executeStateTransition(apiKey, issueId, stateId);
  } catch {
    return false;
  }
}
