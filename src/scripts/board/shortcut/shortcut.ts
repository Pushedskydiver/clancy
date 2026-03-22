/**
 * Clancy Shortcut board script.
 *
 * Fetches stories from Shortcut's REST API v3, creates branches,
 * invokes Claude, pushes feature branches, and creates PRs.
 *
 * Auth: `Shortcut-Token` header (no "Bearer" prefix).
 */
import {
  shortcutEpicStoriesResponseSchema,
  shortcutLabelCreateResponseSchema,
  shortcutLabelsResponseSchema,
  shortcutMemberInfoResponseSchema,
  shortcutStoryDetailResponseSchema,
  shortcutStorySearchResponseSchema,
  shortcutWorkflowsResponseSchema,
} from '~/schemas/shortcut.js';
import type {
  ShortcutLabelsResponse,
  ShortcutWorkflowsResponse,
} from '~/schemas/shortcut.js';
import type { Ticket } from '~/types/index.js';

const SHORTCUT_API = 'https://api.app.shortcut.com/api/v3';

/** Build the standard Shortcut request headers. */
function shortcutHeaders(token: string): Record<string, string> {
  return {
    'Shortcut-Token': token,
    'Content-Type': 'application/json',
  };
}

// ─── Workflow cache ─────────────────────────────────────────────────────────

/** Cached workflows to avoid repeated /workflows calls. */
let cachedWorkflows: ShortcutWorkflowsResponse | undefined;

/** Reset the cached workflows. Exported for testing only. */
export function resetWorkflowCache(): void {
  cachedWorkflows = undefined;
}

/** Cached labels to avoid repeated /labels calls. */
let cachedLabels: ShortcutLabelsResponse | undefined;

/** Reset the cached labels. Exported for testing only. */
export function resetLabelCache(): void {
  cachedLabels = undefined;
}

// ─── API functions ──────────────────────────────────────────────────────────

/**
 * Ping the Shortcut API to verify connectivity and credentials.
 *
 * @param token - The Shortcut API token.
 * @returns An object with `ok` and optional `error` message.
 */
export async function pingShortcut(
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  let response: Response;

  try {
    // /member-info may 404 for some API token types — fall back to /workflows
    response = await fetch(`${SHORTCUT_API}/member-info`, {
      headers: shortcutHeaders(token),
    });
    if (!response.ok) {
      response = await fetch(`${SHORTCUT_API}/workflows`, {
        headers: shortcutHeaders(token),
      });
    }
  } catch {
    return {
      ok: false,
      error: '✗ Could not reach Shortcut — check network',
    };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: '✗ Shortcut auth failed — check SHORTCUT_API_TOKEN',
      };
    }
    return {
      ok: false,
      error: `✗ Shortcut API returned HTTP ${response.status}`,
    };
  }

  // /member-info returns { id, ... } — validate if available.
  // /workflows returns an array — just check response.ok (already done above).
  try {
    const json: unknown = await response.json();
    const parsed = shortcutMemberInfoResponseSchema.safeParse(json);
    if (parsed.success && parsed.data.id) return { ok: true };
    // If schema doesn't match (e.g. /workflows fallback), OK response is sufficient
    if (Array.isArray(json)) return { ok: true };
  } catch {
    // Invalid JSON — treat as auth issue
  }

  return {
    ok: false,
    error: '✗ Shortcut auth failed — check SHORTCUT_API_TOKEN',
  };
}

/**
 * Fetch all workflows from Shortcut (cached per process).
 *
 * @param token - The Shortcut API token.
 * @returns The workflows array, or an empty array on failure.
 */
export async function fetchWorkflows(
  token: string,
): Promise<ShortcutWorkflowsResponse> {
  if (cachedWorkflows) return cachedWorkflows;

  try {
    const response = await fetch(`${SHORTCUT_API}/workflows`, {
      headers: shortcutHeaders(token),
    });

    if (!response.ok) {
      console.warn(`⚠ Shortcut /workflows returned HTTP ${response.status}`);
      return [];
    }

    const json: unknown = await response.json();
    const parsed = shortcutWorkflowsResponseSchema.safeParse(json);

    if (!parsed.success) {
      console.warn(
        `⚠ Unexpected Shortcut workflows response: ${parsed.error.message}`,
      );
      return [];
    }

    cachedWorkflows = parsed.data;
    return cachedWorkflows;
  } catch (err) {
    console.warn(
      `⚠ Shortcut /workflows request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/**
 * Resolve a workflow state name to its numeric ID.
 *
 * @param token - The Shortcut API token.
 * @param stateName - The state name to resolve (e.g., "In Progress").
 * @param workflowName - Optional workflow name to scope the search.
 * @returns The state ID, or `undefined` if not found.
 */
export async function resolveWorkflowStateId(
  token: string,
  stateName: string,
  workflowName?: string,
): Promise<number | undefined> {
  const workflows = await fetchWorkflows(token);

  for (const wf of workflows) {
    if (workflowName && wf.name !== workflowName) continue;

    const state = wf.states.find(
      (s) => s.name.toLowerCase() === stateName.toLowerCase(),
    );
    if (state) return state.id;
  }

  return undefined;
}

/**
 * Resolve a workflow state type to find all matching state IDs.
 *
 * @param token - The Shortcut API token.
 * @param stateType - The state type to resolve (e.g., "unstarted").
 * @param workflowName - Optional workflow name to scope the search.
 * @returns Array of matching state IDs.
 */
export async function resolveWorkflowStateIdsByType(
  token: string,
  stateType: string,
  workflowName?: string,
): Promise<number[]> {
  const workflows = await fetchWorkflows(token);
  const ids: number[] = [];

  for (const wf of workflows) {
    if (workflowName && wf.name !== workflowName) continue;

    for (const state of wf.states) {
      if (state.type === stateType) ids.push(state.id);
    }
  }

  return ids;
}

/** Shortcut ticket with optional epic ID and labels. */
export type ShortcutTicket = Ticket & {
  storyId: number;
  epicId?: number;
  labels?: string[];
};

/**
 * Fetch stories from Shortcut using search.
 *
 * @param token - The Shortcut API token.
 * @param workflowStateIds - Workflow state IDs to filter by.
 * @param labelName - Optional label name to filter stories.
 * @param ownerUuid - Optional owner UUID to filter by assignee.
 * @param excludeHitl - If `true`, excludes stories with the `clancy:hitl` label (client-side).
 * @param limit - Maximum number of results to return (default: 5).
 * @returns Array of fetched tickets (may be empty).
 */
export async function fetchStories(
  token: string,
  workflowStateIds: number[],
  labelName?: string,
  ownerUuid?: string,
  excludeHitl?: boolean,
  limit = 5,
): Promise<ShortcutTicket[]> {
  if (!workflowStateIds.length) return [];

  let response: Response;

  const body: Record<string, unknown> = {};

  // Use workflow state IDs for server-side filtering
  if (workflowStateIds.length) {
    body.workflow_state_ids = workflowStateIds;
  }

  if (ownerUuid) body.owner_ids = [ownerUuid];
  if (labelName) body.label_name = labelName;

  try {
    response = await fetch(`${SHORTCUT_API}/stories/search`, {
      method: 'POST',
      headers: shortcutHeaders(token),
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn(
      `⚠ Shortcut API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  if (!response.ok) {
    console.warn(`⚠ Shortcut API returned HTTP ${response.status}`);
    return [];
  }

  let json: unknown;

  try {
    json = await response.json();
  } catch {
    console.warn('⚠ Shortcut API returned invalid JSON');
    return [];
  }

  const parsed = shortcutStorySearchResponseSchema.safeParse(json);

  if (!parsed.success) {
    console.warn(
      `⚠ Unexpected Shortcut response shape: ${parsed.error.message}`,
    );
    return [];
  }

  let stories = parsed.data.data;

  // HITL/AFK filtering: exclude stories with clancy:hitl label
  if (excludeHitl) {
    stories = stories.filter(
      (s) => !s.labels?.some((l) => l.name === 'clancy:hitl'),
    );
  }

  return stories.slice(0, limit).map((story) => ({
    key: `sc-${story.id}`,
    title: story.name,
    description: story.description ?? '',
    provider: 'shortcut' as const,
    storyId: story.id,
    epicId: story.epic_id ?? undefined,
    labels: story.labels
      ?.map((l) => l.name)
      .filter((n): n is string => Boolean(n)),
  }));
}

/**
 * Fetch a single story by ID.
 *
 * @param token - The Shortcut API token.
 * @param storyId - The story numeric ID.
 * @returns The story detail, or `undefined` on failure.
 */
export async function fetchStory(
  token: string,
  storyId: number,
): Promise<ShortcutTicket | undefined> {
  try {
    const response = await fetch(`${SHORTCUT_API}/stories/${storyId}`, {
      headers: shortcutHeaders(token),
    });

    if (!response.ok) return undefined;

    const json: unknown = await response.json();
    const parsed = shortcutStoryDetailResponseSchema.safeParse(json);

    if (!parsed.success) return undefined;

    const story = parsed.data;
    return {
      key: `sc-${story.id}`,
      title: story.name,
      description: story.description ?? '',
      provider: 'shortcut' as const,
      storyId: story.id,
      epicId: story.epic_id ?? undefined,
      labels: story.labels
        ?.map((l) => l.name)
        .filter((n): n is string => Boolean(n)),
    };
  } catch {
    return undefined;
  }
}

/**
 * Check whether a Shortcut story is blocked by unresolved blockers.
 *
 * Checks the `blocked` boolean flag and `story_links` with verb `"is blocked by"`.
 * For each blocker link, fetches the blocking story to check if it's in a "done" state.
 *
 * @param token - The Shortcut API token.
 * @param storyId - The story numeric ID.
 * @returns `true` if any blocker is unresolved, `false` otherwise.
 */
export async function fetchBlockerStatus(
  token: string,
  storyId: number,
): Promise<boolean> {
  try {
    const response = await fetch(`${SHORTCUT_API}/stories/${storyId}`, {
      headers: shortcutHeaders(token),
    });

    if (!response.ok) return false;

    const json: unknown = await response.json();
    const parsed = shortcutStoryDetailResponseSchema.safeParse(json);

    if (!parsed.success) return false;

    const story = parsed.data;

    // Quick check: if the story has the blocked flag
    if (!story.blocked) return false;

    // Check story_links for "is blocked by" relationships
    const blockerLinks = (story.story_links ?? []).filter(
      (link) => link.verb === 'is blocked by',
    );

    if (!blockerLinks.length) return false;

    // Check if any blocking story is NOT in a "done" state
    const workflows = await fetchWorkflows(token);
    const doneStateIds = new Set<number>();

    for (const wf of workflows) {
      for (const state of wf.states) {
        if (state.type === 'done') doneStateIds.add(state.id);
      }
    }

    for (const link of blockerLinks) {
      // object_id is the blocking story (the one that blocks this story)
      const blockerId = link.object_id;
      const blockerResponse = await fetch(
        `${SHORTCUT_API}/stories/${blockerId}`,
        { headers: shortcutHeaders(token) },
      );

      if (!blockerResponse.ok) continue;

      const blockerJson: unknown = await blockerResponse.json();
      const blockerParsed =
        shortcutStoryDetailResponseSchema.safeParse(blockerJson);

      if (!blockerParsed.success) continue;

      if (
        blockerParsed.data.workflow_state_id !== undefined &&
        !doneStateIds.has(blockerParsed.data.workflow_state_id)
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/** Result of checking children status for an epic. */
export type ChildrenStatus = { total: number; incomplete: number };

/**
 * Fetch the children status of a Shortcut epic (dual-mode).
 *
 * Tries the `Epic: sc-{epicId}` text convention first (searches story descriptions).
 * If no results, falls back to the native GET /epics/{id}/stories endpoint.
 *
 * @param token - The Shortcut API token.
 * @param epicId - The Shortcut epic numeric ID.
 * @param parentKey - The parent key (e.g., `'sc-123'`). Used for Epic: text convention.
 * @returns The children status, or `undefined` on failure.
 */
export async function fetchChildrenStatus(
  token: string,
  epicId: number,
  parentKey?: string,
): Promise<ChildrenStatus | undefined> {
  try {
    // Mode 1: Try Epic: text convention (search stories with description matching)
    if (parentKey) {
      const epicTextResult = await fetchChildrenByDescription(
        token,
        `Epic: ${parentKey}`,
      );

      if (epicTextResult && epicTextResult.total > 0) return epicTextResult;
    }

    // Mode 2: Fall back to native /epics/{id}/stories
    return await fetchChildrenByEpicApi(token, epicId);
  } catch {
    return undefined;
  }
}

/**
 * Fetch children status by searching story descriptions for a text reference.
 *
 * @param token - The Shortcut API token.
 * @param descriptionRef - The description text to search for.
 * @returns The children status, or `undefined` on failure.
 */
async function fetchChildrenByDescription(
  token: string,
  descriptionRef: string,
): Promise<ChildrenStatus | undefined> {
  try {
    const response = await fetch(`${SHORTCUT_API}/stories/search`, {
      method: 'POST',
      headers: shortcutHeaders(token),
      body: JSON.stringify({ query: descriptionRef }),
    });

    if (!response.ok) return undefined;

    const json: unknown = await response.json();
    const parsed = shortcutStorySearchResponseSchema.safeParse(json);

    if (!parsed.success) return undefined;

    const stories = parsed.data.data;
    const total = stories.length;

    if (total === 0) return { total: 0, incomplete: 0 };

    // Resolve done state IDs
    const workflows = await fetchWorkflows(token);
    const doneStateIds = new Set<number>();

    for (const wf of workflows) {
      for (const state of wf.states) {
        if (state.type === 'done') doneStateIds.add(state.id);
      }
    }

    const incomplete = stories.filter(
      (s) =>
        s.workflow_state_id === undefined ||
        !doneStateIds.has(s.workflow_state_id),
    ).length;

    return { total, incomplete };
  } catch {
    return undefined;
  }
}

/**
 * Fetch children status from the native epic stories endpoint.
 *
 * @param token - The Shortcut API token.
 * @param epicId - The Shortcut epic numeric ID.
 * @returns The children status, or `undefined` on failure.
 */
async function fetchChildrenByEpicApi(
  token: string,
  epicId: number,
): Promise<ChildrenStatus | undefined> {
  try {
    const response = await fetch(`${SHORTCUT_API}/epics/${epicId}/stories`, {
      headers: shortcutHeaders(token),
    });

    if (!response.ok) return undefined;

    const json: unknown = await response.json();
    const parsed = shortcutEpicStoriesResponseSchema.safeParse(json);

    if (!parsed.success) return undefined;

    // Epic stories endpoint returns a bare array (not paginated like search)
    const stories = parsed.data;
    const total = stories.length;

    if (total === 0) return { total: 0, incomplete: 0 };

    // Resolve done state IDs
    const workflows = await fetchWorkflows(token);
    const doneStateIds = new Set<number>();

    for (const wf of workflows) {
      for (const state of wf.states) {
        if (state.type === 'done') doneStateIds.add(state.id);
      }
    }

    const incomplete = stories.filter(
      (s) =>
        s.workflow_state_id === undefined ||
        !doneStateIds.has(s.workflow_state_id),
    ).length;

    return { total, incomplete };
  } catch {
    return undefined;
  }
}

/**
 * Transition a Shortcut story to a new workflow state.
 *
 * @param token - The Shortcut API token.
 * @param storyId - The story numeric ID.
 * @param workflowStateId - The target workflow state ID.
 * @returns `true` if the transition succeeded.
 */
export async function transitionStory(
  token: string,
  storyId: number,
  workflowStateId: number,
): Promise<boolean> {
  try {
    const response = await fetch(`${SHORTCUT_API}/stories/${storyId}`, {
      method: 'PUT',
      headers: shortcutHeaders(token),
      body: JSON.stringify({ workflow_state_id: workflowStateId }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch all labels from Shortcut (cached per process).
 *
 * @param token - The Shortcut API token.
 * @returns The labels array, or an empty array on failure.
 */
export async function fetchLabels(
  token: string,
): Promise<ShortcutLabelsResponse> {
  if (cachedLabels) return cachedLabels;

  try {
    const response = await fetch(`${SHORTCUT_API}/labels`, {
      headers: shortcutHeaders(token),
    });

    if (!response.ok) {
      console.warn(`⚠ Shortcut /labels returned HTTP ${response.status}`);
      return [];
    }

    const json: unknown = await response.json();
    const parsed = shortcutLabelsResponseSchema.safeParse(json);

    if (!parsed.success) {
      console.warn(
        `⚠ Unexpected Shortcut labels response: ${parsed.error.message}`,
      );
      return [];
    }

    cachedLabels = parsed.data;
    return cachedLabels;
  } catch (err) {
    console.warn(
      `⚠ Shortcut /labels request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/**
 * Create a new label in Shortcut.
 *
 * @param token - The Shortcut API token.
 * @param name - The label name to create.
 * @returns The created label's numeric ID, or `undefined` on failure.
 */
export async function createLabel(
  token: string,
  name: string,
): Promise<number | undefined> {
  try {
    const response = await fetch(`${SHORTCUT_API}/labels`, {
      method: 'POST',
      headers: shortcutHeaders(token),
      body: JSON.stringify({ name, color: '#0075ca' }),
    });

    if (!response.ok) {
      console.warn(`⚠ Shortcut label create returned HTTP ${response.status}`);
      return undefined;
    }

    const json: unknown = await response.json();
    const parsed = shortcutLabelCreateResponseSchema.safeParse(json);

    if (!parsed.success) return undefined;

    // Invalidate label cache so next fetchLabels picks up the new label
    cachedLabels = undefined;

    return parsed.data.id;
  } catch (err) {
    console.warn(
      `⚠ Shortcut label create failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/**
 * Fetch current label IDs for a story.
 *
 * @param token - The Shortcut API token.
 * @param storyId - The story numeric ID.
 * @returns The label IDs array, or `undefined` on failure.
 */
export async function getStoryLabelIds(
  token: string,
  storyId: number,
): Promise<number[] | undefined> {
  try {
    const response = await fetch(`${SHORTCUT_API}/stories/${storyId}`, {
      headers: shortcutHeaders(token),
    });

    if (!response.ok) return undefined;

    const json: unknown = await response.json();
    const parsed = shortcutStoryDetailResponseSchema.safeParse(json);

    if (!parsed.success) return undefined;

    return parsed.data.label_ids ?? [];
  } catch {
    return undefined;
  }
}

/**
 * Update a story's label IDs.
 *
 * @param token - The Shortcut API token.
 * @param storyId - The story numeric ID.
 * @param labelIds - The new label IDs array.
 * @returns `true` if the update succeeded.
 */
export async function updateStoryLabelIds(
  token: string,
  storyId: number,
  labelIds: number[],
): Promise<boolean> {
  try {
    const response = await fetch(`${SHORTCUT_API}/stories/${storyId}`, {
      method: 'PUT',
      headers: shortcutHeaders(token),
      body: JSON.stringify({ label_ids: labelIds }),
    });

    if (!response.ok) {
      console.warn(
        `⚠ Shortcut story label update returned HTTP ${response.status}`,
      );
    }

    return response.ok;
  } catch (err) {
    console.warn(
      `⚠ Shortcut story label update failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
