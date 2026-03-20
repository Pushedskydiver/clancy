/**
 * Clancy Azure DevOps board script.
 *
 * Fetches work items from Azure DevOps using WIQL queries,
 * creates branches, invokes Claude, pushes feature branches, and creates PRs.
 *
 * Auth: `Authorization: Basic ${base64(':' + pat)}` (empty username).
 * API version: 7.1 on all requests.
 */
import {
  azdoProjectResponseSchema,
  azdoWiqlLinkResponseSchema,
  azdoWiqlResponseSchema,
  azdoWorkItemSchema,
  azdoWorkItemsBatchResponseSchema,
} from '~/schemas/azdo.js';
import type { AzdoWorkItem } from '~/schemas/azdo.js';
import type { Ticket } from '~/types/index.js';

const API_VERSION = '7.1';

// ─── Auth ────────────────────────────────────────────────────────────────────

/**
 * Build the Azure DevOps Basic auth header value.
 *
 * Azure DevOps uses `Basic base64(':' + pat)` — empty username, colon, then PAT.
 *
 * @param pat - The personal access token.
 * @returns The `Basic ...` header value.
 */
export function buildAzdoAuth(pat: string): string {
  return `Basic ${btoa(`:${pat}`)}`;
}

// ─── WIQL injection prevention ───────────────────────────────────────────────

/**
 * Validate that a value is safe to interpolate into a WIQL query.
 *
 * Blocks single quotes (WIQL string delimiter), `--` (SQL comment),
 * `;` (statement separator), block comments, and non-printable characters.
 *
 * @param value - The string to validate.
 * @returns `true` if the value is safe for WIQL interpolation.
 */
export function isSafeWiqlValue(value: string): boolean {
  if (value.includes("'")) return false;
  if (value.includes('--')) return false;
  if (value.includes(';')) return false;
  if (value.includes('/*')) return false;
  // Block non-printable characters (allow tab, newline, carriage return)
  if (/[^\x20-\x7E\t\n\r]/.test(value)) return false;
  return true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build the Azure DevOps API base URL for a given org and project. */
function apiBase(org: string, project: string): string {
  return `https://dev.azure.com/${org}/${project}/_apis`;
}

/** Build standard headers for Azure DevOps requests. */
function azdoHeaders(pat: string): Record<string, string> {
  return {
    Authorization: buildAzdoAuth(pat),
    'Content-Type': 'application/json',
  };
}

/** Build JSON Patch headers (required for work item updates). */
function azdoPatchHeaders(pat: string): Record<string, string> {
  return {
    Authorization: buildAzdoAuth(pat),
    'Content-Type': 'application/json-patch+json',
  };
}

// ─── API functions ───────────────────────────────────────────────────────────

/**
 * Ping the Azure DevOps API to verify connectivity and credentials.
 *
 * @param org - The Azure DevOps organisation name.
 * @param project - The Azure DevOps project name.
 * @param pat - The personal access token.
 * @returns An object with `ok` and optional `error` message.
 */
export async function pingAzdo(
  org: string,
  project: string,
  pat: string,
): Promise<{ ok: boolean; error?: string }> {
  let response: Response;

  try {
    response = await fetch(
      `https://dev.azure.com/${org}/_apis/projects/${encodeURIComponent(project)}?api-version=${API_VERSION}`,
      { headers: azdoHeaders(pat) },
    );
  } catch {
    return {
      ok: false,
      error: '✗ Could not reach Azure DevOps — check network',
    };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: '✗ Azure DevOps auth failed — check AZDO_PAT',
      };
    }
    return {
      ok: false,
      error: `✗ Azure DevOps API returned HTTP ${response.status}`,
    };
  }

  try {
    const json: unknown = await response.json();
    const parsed = azdoProjectResponseSchema.safeParse(json);
    if (parsed.success && parsed.data.id) return { ok: true };
  } catch {
    // Invalid JSON — treat as auth issue
  }

  return {
    ok: false,
    error: '✗ Azure DevOps auth failed — check AZDO_PAT',
  };
}

/**
 * Run a WIQL query against Azure DevOps.
 *
 * @param org - The Azure DevOps organisation name.
 * @param project - The Azure DevOps project name.
 * @param pat - The personal access token.
 * @param query - The WIQL query string.
 * @returns Array of work item IDs, or an empty array on failure.
 */
export async function runWiql(
  org: string,
  project: string,
  pat: string,
  query: string,
): Promise<number[]> {
  try {
    const response = await fetch(
      `${apiBase(org, project)}/wit/wiql?api-version=${API_VERSION}`,
      {
        method: 'POST',
        headers: azdoHeaders(pat),
        body: JSON.stringify({ query }),
      },
    );

    if (!response.ok) {
      console.warn(`⚠ Azure DevOps WIQL returned HTTP ${response.status}`);
      return [];
    }

    const json: unknown = await response.json();
    const parsed = azdoWiqlResponseSchema.safeParse(json);

    if (!parsed.success) {
      console.warn(
        `⚠ Unexpected Azure DevOps WIQL response: ${parsed.error.message}`,
      );
      return [];
    }

    return parsed.data.workItems.map((wi) => wi.id);
  } catch (err) {
    console.warn(
      `⚠ Azure DevOps WIQL request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/**
 * Batch-fetch work items by IDs (up to 200 per request).
 *
 * @param org - The Azure DevOps organisation name.
 * @param project - The Azure DevOps project name.
 * @param pat - The personal access token.
 * @param ids - Array of work item IDs to fetch.
 * @returns Array of work items, or an empty array on failure.
 */
export async function fetchWorkItems(
  org: string,
  project: string,
  pat: string,
  ids: number[],
): Promise<AzdoWorkItem[]> {
  if (!ids.length) return [];

  const results: AzdoWorkItem[] = [];

  // Batch in chunks of 200 (Azure DevOps limit)
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const idString = batch.join(',');

    try {
      const response = await fetch(
        `${apiBase(org, project)}/wit/workitems?ids=${idString}&$expand=relations&api-version=${API_VERSION}`,
        { headers: azdoHeaders(pat) },
      );

      if (!response.ok) {
        console.warn(
          `⚠ Azure DevOps work items batch returned HTTP ${response.status}`,
        );
        continue;
      }

      const json: unknown = await response.json();
      const parsed = azdoWorkItemsBatchResponseSchema.safeParse(json);

      if (!parsed.success) {
        console.warn(
          `⚠ Unexpected Azure DevOps work items response: ${parsed.error.message}`,
        );
        continue;
      }

      results.push(...parsed.data.value);
    } catch (err) {
      console.warn(
        `⚠ Azure DevOps work items fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return results;
}

/**
 * Fetch a single work item by ID.
 *
 * @param org - The Azure DevOps organisation name.
 * @param project - The Azure DevOps project name.
 * @param pat - The personal access token.
 * @param id - The work item ID.
 * @returns The work item, or `undefined` on failure.
 */
export async function fetchWorkItem(
  org: string,
  project: string,
  pat: string,
  id: number,
): Promise<AzdoWorkItem | undefined> {
  try {
    const response = await fetch(
      `${apiBase(org, project)}/wit/workitems/${id}?$expand=relations&api-version=${API_VERSION}`,
      { headers: azdoHeaders(pat) },
    );

    if (!response.ok) return undefined;

    const json: unknown = await response.json();
    const parsed = azdoWorkItemSchema.safeParse(json);

    if (!parsed.success) return undefined;

    return parsed.data;
  } catch {
    return undefined;
  }
}

/** A JSON Patch operation for Azure DevOps work item updates. */
export type JsonPatchOp = {
  op: 'add' | 'replace' | 'remove' | 'test';
  path: string;
  value?: unknown;
};

/**
 * Update a work item using JSON Patch operations.
 *
 * @param org - The Azure DevOps organisation name.
 * @param project - The Azure DevOps project name.
 * @param pat - The personal access token.
 * @param id - The work item ID.
 * @param patchOps - Array of JSON Patch operations.
 * @returns `true` if the update succeeded.
 */
export async function updateWorkItem(
  org: string,
  project: string,
  pat: string,
  id: number,
  patchOps: JsonPatchOp[],
): Promise<boolean> {
  try {
    const response = await fetch(
      `${apiBase(org, project)}/wit/workitems/${id}?api-version=${API_VERSION}`,
      {
        method: 'PATCH',
        headers: azdoPatchHeaders(pat),
        body: JSON.stringify(patchOps),
      },
    );

    return response.ok;
  } catch {
    return false;
  }
}

// ─── Ticket types ────────────────────────────────────────────────────────────

/** Azure DevOps ticket with work item ID and optional tags. */
export type AzdoTicket = Ticket & {
  workItemId: number;
  parentId?: number;
  labels?: string[];
};

// ─── Tags helpers ────────────────────────────────────────────────────────────

/**
 * Parse Azure DevOps semicolon-separated tags into an array.
 *
 * @param tags - The raw tags string (e.g., "tag1; tag2; tag3").
 * @returns Array of trimmed tag strings.
 */
export function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Rebuild a tags string from an array.
 *
 * @param tags - Array of tag strings.
 * @returns Semicolon-separated tags string.
 */
export function buildTagsString(tags: string[]): string {
  return tags.join('; ');
}

// ─── High-level fetch ────────────────────────────────────────────────────────

/**
 * Extract the work item ID from a relation URL.
 *
 * Relation URLs look like: https://dev.azure.com/{org}/_apis/wit/workItems/{id}
 *
 * @param url - The relation URL.
 * @returns The work item ID, or `undefined` if parsing fails.
 */
export function extractIdFromRelationUrl(url: string): number | undefined {
  const match = url.match(/workItems\/(\d+)/i);
  if (!match) return undefined;
  const num = parseInt(match[1], 10);
  return Number.isNaN(num) ? undefined : num;
}

/**
 * Fetch work items matching a WIQL query and convert to AzdoTicket format.
 *
 * Two-step fetch: WIQL returns IDs, then batch fetch gets details.
 *
 * @param org - The Azure DevOps organisation name.
 * @param project - The Azure DevOps project name.
 * @param pat - The personal access token.
 * @param status - The work item state to filter by.
 * @param wit - Optional work item type filter.
 * @param excludeHitl - If `true`, excludes items tagged `clancy:hitl` (client-side).
 * @param limit - Maximum number of results (default: 5).
 * @returns Array of AzdoTickets.
 */
export async function fetchTickets(
  org: string,
  project: string,
  pat: string,
  status: string,
  wit?: string,
  excludeHitl?: boolean,
  limit = 5,
): Promise<AzdoTicket[]> {
  let wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.State] = '${status}' AND [System.AssignedTo] = @Me`;

  if (wit) {
    wiql += ` AND [System.WorkItemType] = '${wit}'`;
  }

  wiql += ' ORDER BY [System.CreatedDate] ASC';

  const ids = await runWiql(org, project, pat, wiql);

  if (!ids.length) return [];

  // Only fetch up to a reasonable limit
  const limitedIds = ids.slice(0, limit * 2);
  const items = await fetchWorkItems(org, project, pat, limitedIds);

  let tickets = items.map((item) => workItemToTicket(item));

  // HITL/AFK filtering: exclude items tagged clancy:hitl
  if (excludeHitl) {
    tickets = tickets.filter(
      (t) => !t.labels?.some((l) => l === 'clancy:hitl'),
    );
  }

  return tickets.slice(0, limit);
}

/**
 * Convert a raw AzdoWorkItem to an AzdoTicket.
 *
 * @param item - The raw work item from the API.
 * @returns A normalised AzdoTicket.
 */
export function workItemToTicket(item: AzdoWorkItem): AzdoTicket {
  const tags = parseTags(item.fields['System.Tags']);

  // Find parent from relations
  let parentId: number | undefined;
  if (item.relations) {
    for (const rel of item.relations) {
      if (rel.rel === 'System.LinkTypes.Hierarchy-Reverse') {
        parentId = extractIdFromRelationUrl(rel.url);
        break;
      }
    }
  }

  return {
    key: `azdo-${item.id}`,
    title: item.fields['System.Title'] ?? '',
    description: item.fields['System.Description'] ?? '',
    provider: 'azdo' as const,
    workItemId: item.id,
    parentId,
    labels: tags,
  };
}

// ─── Blocker detection ───────────────────────────────────────────────────────

/** Done/Closed states for Azure DevOps — used for blocker resolution check. */
const DONE_STATES = new Set(['Done', 'Closed', 'Completed', 'Resolved']);

/**
 * Check whether a work item is blocked by unresolved predecessors.
 *
 * Looks for relations with `rel: "System.LinkTypes.Dependency-Reverse"` (predecessor).
 * Fetches each predecessor and checks if its state is Done/Closed.
 *
 * @param org - The Azure DevOps organisation name.
 * @param project - The Azure DevOps project name.
 * @param pat - The personal access token.
 * @param workItemId - The work item ID to check.
 * @returns `true` if any predecessor is unresolved, `false` otherwise.
 */
export async function fetchBlockerStatus(
  org: string,
  project: string,
  pat: string,
  workItemId: number,
): Promise<boolean> {
  try {
    const item = await fetchWorkItem(org, project, pat, workItemId);
    if (!item) return false;

    const predecessors = (item.relations ?? []).filter(
      (r) => r.rel === 'System.LinkTypes.Dependency-Reverse',
    );

    if (!predecessors.length) return false;

    for (const pred of predecessors) {
      const predId = extractIdFromRelationUrl(pred.url);
      if (predId === undefined) continue;

      const predItem = await fetchWorkItem(org, project, pat, predId);
      if (!predItem) continue;

      const state = predItem.fields['System.State'];
      if (!state || !DONE_STATES.has(state)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

// ─── Children status ─────────────────────────────────────────────────────────

/** Result of checking children status for a parent work item. */
export type ChildrenStatus = { total: number; incomplete: number };

/**
 * Fetch the children status of a parent work item (dual-mode).
 *
 * Mode 1: Tries the `Epic: azdo-{parentId}` text convention (WIQL description search).
 * Mode 2: Falls back to native hierarchy links (child work items).
 *
 * @param org - The Azure DevOps organisation name.
 * @param project - The Azure DevOps project name.
 * @param pat - The personal access token.
 * @param parentId - The parent work item ID.
 * @param parentKey - The parent key (e.g., `'azdo-123'`). Used for Epic: text convention.
 * @returns The children status, or `undefined` on failure.
 */
export async function fetchChildrenStatus(
  org: string,
  project: string,
  pat: string,
  parentId: number,
  parentKey?: string,
): Promise<ChildrenStatus | undefined> {
  try {
    // Mode 1: Try Epic: text convention
    if (parentKey) {
      const epicRef = `Epic: ${parentKey}`;
      const result = await fetchChildrenByDescription(
        org,
        project,
        pat,
        epicRef,
      );

      if (result && result.total > 0) return result;
    }

    // Mode 2: Fall back to hierarchy links
    return await fetchChildrenByLinks(org, project, pat, parentId);
  } catch {
    return undefined;
  }
}

/**
 * Fetch children status by searching descriptions for an Epic: reference.
 *
 * @param org - The Azure DevOps organisation name.
 * @param project - The Azure DevOps project name.
 * @param pat - The personal access token.
 * @param descriptionRef - The description text to search for.
 * @returns The children status, or `undefined` on failure.
 */
async function fetchChildrenByDescription(
  org: string,
  project: string,
  pat: string,
  descriptionRef: string,
): Promise<ChildrenStatus | undefined> {
  try {
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.Description] CONTAINS '${descriptionRef}'`;

    const ids = await runWiql(org, project, pat, wiql);
    if (!ids.length) return { total: 0, incomplete: 0 };

    const items = await fetchWorkItems(org, project, pat, ids);
    const total = items.length;

    const incomplete = items.filter((item) => {
      const state = item.fields['System.State'];
      return !state || !DONE_STATES.has(state);
    }).length;

    return { total, incomplete };
  } catch {
    return undefined;
  }
}

/**
 * Fetch children status via hierarchy link queries.
 *
 * @param org - The Azure DevOps organisation name.
 * @param project - The Azure DevOps project name.
 * @param pat - The personal access token.
 * @param parentId - The parent work item ID.
 * @returns The children status, or `undefined` on failure.
 */
async function fetchChildrenByLinks(
  org: string,
  project: string,
  pat: string,
  parentId: number,
): Promise<ChildrenStatus | undefined> {
  try {
    const wiql = `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${parentId} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' MODE (MustContain)`;

    const response = await fetch(
      `${apiBase(org, project)}/wit/wiql?api-version=${API_VERSION}`,
      {
        method: 'POST',
        headers: azdoHeaders(pat),
        body: JSON.stringify({ query: wiql }),
      },
    );

    if (!response.ok) return undefined;

    const json: unknown = await response.json();
    const parsed = azdoWiqlLinkResponseSchema.safeParse(json);

    if (!parsed.success) return undefined;

    const relations = parsed.data.workItemRelations ?? [];
    // Filter out the source item itself (target is null for the source row)
    const childIds = relations
      .filter((r) => r.target?.id !== undefined && r.target.id !== parentId)
      .map((r) => r.target!.id);

    if (!childIds.length) return { total: 0, incomplete: 0 };

    const items = await fetchWorkItems(org, project, pat, childIds);
    const total = items.length;

    const incomplete = items.filter((item) => {
      const state = item.fields['System.State'];
      return !state || !DONE_STATES.has(state);
    }).length;

    return { total, incomplete };
  } catch {
    return undefined;
  }
}
