/**
 * Clancy Linear board script.
 *
 * Fetches an issue from Linear's GraphQL API, creates branches,
 * invokes Claude, pushes feature branches, and creates PRs.
 *
 * Important: Linear personal API keys do NOT use "Bearer" prefix.
 * Only OAuth tokens use "Bearer". This is intentional per Linear docs.
 */
import {
  linearIssueRelationsResponseSchema,
  linearIssueSearchResponseSchema,
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
  let response: Response;

  try {
    response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    console.warn(
      `⚠ Linear API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  if (!response.ok) {
    console.warn(`⚠ Linear API returned HTTP ${response.status}`);
    return undefined;
  }

  try {
    return await response.json();
  } catch {
    console.warn('⚠ Linear API returned invalid JSON');
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
  let response: Response;

  try {
    response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ viewer { id } }' }),
    });
  } catch {
    return { ok: false, error: '✗ Could not reach Linear — check network' };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: '✗ Linear auth failed — check LINEAR_API_KEY',
      };
    }
    return {
      ok: false,
      error: `✗ Linear API returned HTTP ${response.status}`,
    };
  }

  try {
    const json: unknown = await response.json();
    const parsed = linearViewerResponseSchema.safeParse(json);
    if (parsed.success && parsed.data.data?.viewer?.id) return { ok: true };
  } catch {
    // Invalid JSON — treat as auth issue
  }

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
  const results = await fetchIssues(env);
  return results[0];
}

/** Linear ticket with issue ID and optional parent info. */
export type LinearTicket = Ticket & {
  issueId: string;
  parentIdentifier?: string;
};

/**
 * Fetch multiple candidate issues from Linear.
 *
 * @param env - The Linear environment variables.
 * @param excludeHitl - If `true`, excludes issues with the `clancy:hitl` label.
 * @param limit - Maximum number of results to return (default: 5).
 * @returns Array of fetched tickets (may be empty).
 */
export async function fetchIssues(
  env: LinearEnv,
  excludeHitl?: boolean,
  limit = 5,
): Promise<LinearTicket[]> {
  const label = env.CLANCY_LABEL?.trim();
  const hasLabel = Boolean(label);

  const labelFilter = hasLabel ? 'labels: { name: { eq: $label } }' : '';

  // Build variable declarations for the query
  const varDecls = [
    '$teamId: String!',
    ...(hasLabel ? ['$label: String!'] : []),
  ];

  // Build filter parts
  const filterParts = [
    'state: { type: { eq: "unstarted" } }',
    'team: { id: { eq: $teamId } }',
    labelFilter,
  ].filter(Boolean);

  const query = `
    query(${varDecls.join(', ')}) {
      viewer {
        assignedIssues(
          filter: {
            ${filterParts.join('\n            ')}
          }
          first: ${limit}
          orderBy: priority
        ) {
          nodes {
            id
            identifier
            title
            description
            parent { identifier title }
            labels { nodes { name } }
          }
        }
      }
    }
  `;

  const variables: Record<string, unknown> = {
    teamId: env.LINEAR_TEAM_ID,
  };

  if (hasLabel) variables.label = label;

  const raw = await linearGraphql(env.LINEAR_API_KEY, query, variables);
  const parsed = linearIssuesResponseSchema.safeParse(raw);

  if (!parsed.success) {
    console.warn(`⚠ Unexpected Linear response shape: ${parsed.error.message}`);
    return [];
  }

  let nodes = parsed.data.data?.viewer?.assignedIssues?.nodes;

  if (!nodes?.length) return [];

  // HITL/AFK filtering: exclude issues with clancy:hitl label
  if (excludeHitl) {
    // Access raw response data for label info (schema doesn't include labels)
    const rawData = raw as {
      data?: {
        viewer?: {
          assignedIssues?: {
            nodes?: Array<{
              id: string;
              labels?: { nodes?: Array<{ name?: string }> };
            }>;
          };
        };
      };
    };
    const rawNodes = rawData.data?.viewer?.assignedIssues?.nodes ?? [];
    const hitlIds = new Set(
      rawNodes
        .filter((n) => n.labels?.nodes?.some((l) => l.name === 'clancy:hitl'))
        .map((n) => n.id),
    );
    nodes = nodes.filter((n) => !hitlIds.has(n.id));
  }

  return nodes.map((issue) => ({
    key: issue.identifier,
    title: issue.title,
    description: issue.description ?? '',
    provider: 'linear' as const,
    issueId: issue.id,
    parentIdentifier: issue.parent?.identifier,
  }));
}

/**
 * Check whether a Linear issue is blocked by unresolved blockers.
 *
 * Queries the issue's relations for `blockedBy` type relationships and checks
 * if any blocking issues have an unresolved state (not "completed" or "canceled").
 *
 * @param apiKey - The Linear personal API key.
 * @param issueId - The Linear issue UUID.
 * @returns `true` if any blocker is unresolved, `false` otherwise.
 */
export async function fetchBlockerStatus(
  apiKey: string,
  issueId: string,
): Promise<boolean> {
  const query = `
    query($issueId: String!) {
      issue(id: $issueId) {
        relations {
          nodes {
            type
            relatedIssue {
              state { type }
            }
          }
        }
      }
    }
  `;

  const raw = await linearGraphql(apiKey, query, { issueId });
  const parsed = linearIssueRelationsResponseSchema.safeParse(raw);

  if (!parsed.success) return false;

  const relations = parsed.data.data?.issue?.relations?.nodes ?? [];
  const doneTypes = new Set(['completed', 'canceled']);

  return relations.some((rel) => {
    if (rel.type !== 'blocks') return false;
    const stateType = rel.relatedIssue?.state?.type;
    if (!stateType) return false;
    return !doneTypes.has(stateType);
  });
}

/** Result of checking children status for a parent issue. */
export type ChildrenStatus = { total: number; incomplete: number };

/**
 * Fetch the children status of a Linear parent issue (dual-mode).
 *
 * Tries the `Epic: {identifier}` text convention first (searches for issues
 * with "Epic: {parentIdentifier}" in their description). If no results, falls
 * back to the native `children` API for backward compatibility.
 *
 * @param apiKey - The Linear personal API key.
 * @param parentId - The Linear parent issue UUID.
 * @param parentIdentifier - The Linear parent identifier (e.g., `'ENG-42'`).
 *   Required for Epic: text convention search. Falls back to native API only if not provided.
 * @returns The children status, or `undefined` on failure.
 */
export async function fetchChildrenStatus(
  apiKey: string,
  parentId: string,
  parentIdentifier?: string,
): Promise<ChildrenStatus | undefined> {
  try {
    // Mode 1: Try Epic: text convention (only if identifier is available)
    if (parentIdentifier) {
      const epicTextResult = await fetchChildrenByDescription(
        apiKey,
        `Epic: ${parentIdentifier}`,
      );

      if (epicTextResult && epicTextResult.total > 0) return epicTextResult;
    }

    // Mode 2: Fall back to native children API
    return await fetchChildrenByNativeApi(apiKey, parentId);
  } catch {
    return undefined;
  }
}

/**
 * Fetch children status by searching for a description substring.
 *
 * @param apiKey - The Linear personal API key.
 * @param descriptionRef - The description substring to search for.
 * @returns The children status, or `undefined` on failure.
 */
async function fetchChildrenByDescription(
  apiKey: string,
  descriptionRef: string,
): Promise<ChildrenStatus | undefined> {
  const query = `
    query($filter: String!) {
      issueSearch(query: $filter) {
        nodes {
          state { type }
        }
      }
    }
  `;

  const raw = await linearGraphql(apiKey, query, { filter: descriptionRef });
  const parsed = linearIssueSearchResponseSchema.safeParse(raw);

  if (!parsed.success) return undefined;

  const nodes = parsed.data.data?.issueSearch?.nodes ?? [];
  const total = nodes.length;
  const doneTypes = new Set(['completed', 'canceled']);
  const incomplete = nodes.filter(
    (n) => !n.state?.type || !doneTypes.has(n.state.type),
  ).length;

  return { total, incomplete };
}

/**
 * Fetch children status using the native parent-child API.
 *
 * @param apiKey - The Linear personal API key.
 * @param parentId - The Linear parent issue UUID.
 * @returns The children status, or `undefined` on failure.
 */
async function fetchChildrenByNativeApi(
  apiKey: string,
  parentId: string,
): Promise<ChildrenStatus | undefined> {
  const query = `
    query($issueId: String!) {
      issue(id: $issueId) {
        children {
          nodes {
            state { type }
          }
        }
      }
    }
  `;

  const raw = await linearGraphql(apiKey, query, { issueId: parentId });

  if (!raw || typeof raw !== 'object') return undefined;

  const data = raw as {
    data?: {
      issue?: {
        children?: {
          nodes?: Array<{ state?: { type?: string } }>;
        };
      };
    };
  };

  const nodes = data.data?.issue?.children?.nodes;
  if (!nodes) return undefined;

  const total = nodes.length;
  const doneTypes = new Set(['completed', 'canceled']);
  const incomplete = nodes.filter(
    (n) => !n.state?.type || !doneTypes.has(n.state.type),
  ).length;

  return { total, incomplete };
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
