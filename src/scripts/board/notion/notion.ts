/**
 * Clancy Notion board script.
 *
 * Raw API functions for Notion's REST API. All calls use `retryFetch`
 * to handle Notion's 3 req/s rate limit with automatic retry and backoff.
 *
 * Auth: `Authorization: Bearer {NOTION_TOKEN}`, `Notion-Version: 2022-06-28`
 */
import {
  notionDatabaseQueryResponseSchema,
  notionPageSchema,
  notionUserResponseSchema,
} from '~/schemas/notion.js';
import type { NotionPage } from '~/schemas/notion.js';
import { retryFetch } from '~/scripts/shared/http/retry.js';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/** Build the standard Notion request headers. */
function notionHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// ─── API functions ──────────────────────────────────────────────────────────

/**
 * Ping the Notion API to verify connectivity and credentials.
 *
 * @param token - The Notion integration token.
 * @returns An object with `ok` and optional `error` message.
 */
export async function pingNotion(
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  let response: Response;

  try {
    response = await retryFetch(`${NOTION_API}/users/me`, {
      headers: notionHeaders(token),
    });
  } catch {
    return {
      ok: false,
      error: '✗ Could not reach Notion — check network',
    };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: '✗ Notion auth failed — check NOTION_TOKEN',
      };
    }
    return {
      ok: false,
      error: `✗ Notion API returned HTTP ${response.status}`,
    };
  }

  try {
    const json: unknown = await response.json();
    const parsed = notionUserResponseSchema.safeParse(json);
    if (parsed.success && parsed.data.id) return { ok: true };
  } catch {
    // Invalid JSON — treat as auth issue
  }

  return {
    ok: false,
    error: '✗ Notion auth failed — check NOTION_TOKEN',
  };
}

/**
 * Query a Notion database with optional filters and pagination.
 *
 * Note: Returns a single page of results (Notion default: 100 items).
 * Callers needing all results should loop using `has_more` / `next_cursor`.
 * For ticket fetching this is sufficient (we only need ~5 candidates),
 * but children/blocker lookups may miss items in large databases.
 *
 * @param token - The Notion integration token.
 * @param databaseId - The database UUID.
 * @param filter - Optional Notion filter object.
 * @param sorts - Optional Notion sorts array.
 * @param startCursor - Optional pagination cursor.
 * @returns The query response, or `undefined` on failure.
 */
export async function queryDatabase(
  token: string,
  databaseId: string,
  filter?: Record<string, unknown>,
  sorts?: Record<string, unknown>[],
  startCursor?: string,
): Promise<
  | { results: NotionPage[]; has_more: boolean; next_cursor?: string | null }
  | undefined
> {
  const body: Record<string, unknown> = {};
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;
  if (startCursor) body.start_cursor = startCursor;

  let response: Response;

  try {
    response = await retryFetch(`${NOTION_API}/databases/${databaseId}/query`, {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn(
      `⚠ Notion API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  if (!response.ok) {
    console.warn(`⚠ Notion API returned HTTP ${response.status}`);
    return undefined;
  }

  let json: unknown;

  try {
    json = await response.json();
  } catch {
    console.warn('⚠ Notion API returned invalid JSON');
    return undefined;
  }

  const parsed = notionDatabaseQueryResponseSchema.safeParse(json);

  if (!parsed.success) {
    console.warn(`⚠ Unexpected Notion response shape: ${parsed.error.message}`);
    return undefined;
  }

  return parsed.data;
}

/**
 * Fetch a single Notion page by ID.
 *
 * @param token - The Notion integration token.
 * @param pageId - The page UUID.
 * @returns The page object, or `undefined` on failure.
 */
export async function fetchPage(
  token: string,
  pageId: string,
): Promise<NotionPage | undefined> {
  try {
    const response = await retryFetch(`${NOTION_API}/pages/${pageId}`, {
      headers: notionHeaders(token),
    });

    if (!response.ok) return undefined;

    const json: unknown = await response.json();
    const parsed = notionPageSchema.safeParse(json);

    if (!parsed.success) return undefined;

    return parsed.data;
  } catch {
    return undefined;
  }
}

/**
 * Update a Notion page's properties.
 *
 * @param token - The Notion integration token.
 * @param pageId - The page UUID.
 * @param properties - The properties to update.
 * @returns `true` if the update succeeded.
 */
export async function updatePage(
  token: string,
  pageId: string,
  properties: Record<string, unknown>,
): Promise<boolean> {
  try {
    const response = await retryFetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH',
      headers: notionHeaders(token),
      body: JSON.stringify({ properties }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check whether a Notion page is blocked by unresolved blockers.
 *
 * Checks for a "Blocked by" relation property, and also searches the
 * database for pages whose descriptions reference "Blocked by notion-{id}".
 *
 * @param token - The Notion integration token.
 * @param databaseId - The database UUID (for text search fallback).
 * @param pageId - The page UUID.
 * @returns `true` if any blocker is unresolved, `false` otherwise.
 */
export async function fetchBlockerStatus(
  token: string,
  databaseId: string,
  pageId: string,
): Promise<boolean> {
  try {
    const page = await fetchPage(token, pageId);
    if (!page) return false;

    // Check for "Blocked by" relation property
    const blockedByProp = findPropertyByName(page, 'Blocked by');

    if (blockedByProp?.type === 'relation') {
      const relations = (
        blockedByProp as { type: 'relation'; relation: { id: string }[] }
      ).relation;

      if (relations.length > 0) {
        // Check if any blocking page is not in a "Complete" status group
        for (const rel of relations) {
          const blockerPage = await fetchPage(token, rel.id);
          if (!blockerPage) continue;

          const status = getPropertyValue(blockerPage, 'Status', 'status');
          // If the blocker doesn't have a done-like status, it's still blocking
          if (status && !isCompleteStatus(status)) {
            return true;
          }
        }

        return false;
      }
    }

    // Fallback: search description for "Blocked by notion-{short-id}" text
    const shortId = pageId.replace(/-/g, '').slice(0, 8);
    const description = getDescriptionText(page);

    if (description) {
      const blockerMatch = description.match(
        /Blocked by (notion-[a-f0-9]{8})/gi,
      );

      if (blockerMatch) {
        // Found text-based blocker references — query the database once upfront
        const result = await queryDatabase(token, databaseId);
        if (!result) return false;

        for (const match of blockerMatch) {
          const blockerShortId = match
            .replace('Blocked by notion-', '')
            .toLowerCase();
          if (blockerShortId === shortId) continue; // Skip self-reference

          for (const candidate of result.results) {
            const candidateShortId = candidate.id.replace(/-/g, '').slice(0, 8);
            if (candidateShortId === blockerShortId) {
              const status = getPropertyValue(candidate, 'Status', 'status');
              if (status && !isCompleteStatus(status)) return true;
            }
          }
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Fetch the children status of a parent page in a Notion database (dual-mode).
 *
 * Mode 1: Query by parent relation property (e.g., "Epic" relation).
 * Mode 2: Search page descriptions for `Epic: notion-{shortId}` text convention.
 *
 * @param token - The Notion integration token.
 * @param databaseId - The database UUID.
 * @param parentKey - The parent key (e.g., `'notion-ab12cd34'`).
 * @param parentProp - The relation property name (default: "Epic").
 * @returns The children status, or `undefined` on failure.
 */
export async function fetchChildrenStatus(
  token: string,
  databaseId: string,
  parentKey: string,
  parentProp = 'Epic',
): Promise<{ total: number; incomplete: number } | undefined> {
  try {
    // Extract the full UUID from the parentKey — we need the parentId for relation queries
    // parentKey is "notion-{first8}" but we need the full page ID
    // Try Mode 1 first: query by description text convention
    const epicTextResult = await fetchChildrenByDescription(
      token,
      databaseId,
      `Epic: ${parentKey}`,
    );

    if (epicTextResult && epicTextResult.total > 0) return epicTextResult;

    // Mode 2: query by relation property (requires parentId — search for the parent page)
    const parentResult = await findPageByKey(token, databaseId, parentKey);
    if (!parentResult) return undefined;

    return await fetchChildrenByRelation(
      token,
      databaseId,
      parentResult.id,
      parentProp,
    );
  } catch {
    return undefined;
  }
}

// ─── Property helpers ───────────────────────────────────────────────────────

/**
 * Extract a typed property value from a Notion page's dynamic property system.
 *
 * @param page - The Notion page object.
 * @param propName - The property name to look up.
 * @param propType - The expected property type.
 * @returns The extracted string value, or `undefined` if not found.
 */
export function getPropertyValue(
  page: NotionPage,
  propName: string,
  propType: 'status' | 'select' | 'title' | 'rich_text',
): string | undefined;
export function getPropertyValue(
  page: NotionPage,
  propName: string,
  propType: 'multi_select',
): string[] | undefined;
export function getPropertyValue(
  page: NotionPage,
  propName: string,
  propType: 'people',
): string[] | undefined;
export function getPropertyValue(
  page: NotionPage,
  propName: string,
  propType: 'relation',
): string[] | undefined;
export function getPropertyValue(
  page: NotionPage,
  propName: string,
  propType: string,
): string | string[] | undefined {
  const prop = page.properties[propName];
  if (!prop || prop.type !== propType) return undefined;

  switch (propType) {
    case 'status': {
      const p = prop as { type: 'status'; status: { name: string } | null };
      return p.status?.name;
    }
    case 'select': {
      const p = prop as { type: 'select'; select: { name: string } | null };
      return p.select?.name;
    }
    case 'title': {
      const p = prop as {
        type: 'title';
        title: { plain_text: string }[];
      };
      return p.title.map((t) => t.plain_text).join('');
    }
    case 'rich_text': {
      const p = prop as {
        type: 'rich_text';
        rich_text: { plain_text: string }[];
      };
      return p.rich_text.map((t) => t.plain_text).join('');
    }
    case 'multi_select': {
      const p = prop as {
        type: 'multi_select';
        multi_select: { name: string }[];
      };
      return p.multi_select.map((o) => o.name);
    }
    case 'people': {
      const p = prop as {
        type: 'people';
        people: { id: string }[];
      };
      return p.people.map((u) => u.id);
    }
    case 'relation': {
      const p = prop as {
        type: 'relation';
        relation: { id: string }[];
      };
      return p.relation.map((r) => r.id);
    }
    default:
      return undefined;
  }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Find a property by name in a page (case-insensitive fallback). */
function findPropertyByName(
  page: NotionPage,
  name: string,
): { type: string } | undefined {
  // Exact match first
  if (page.properties[name]) return page.properties[name];

  // Case-insensitive fallback
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(page.properties)) {
    if (key.toLowerCase() === lowerName) return value;
  }

  return undefined;
}

/** Check whether a status name indicates completion. */
function isCompleteStatus(statusName: string): boolean {
  const lower = statusName.toLowerCase();
  return (
    lower === 'done' ||
    lower === 'complete' ||
    lower === 'completed' ||
    lower === 'closed'
  );
}

/** Extract description text from a page (looks for rich_text properties). */
function getDescriptionText(page: NotionPage): string | undefined {
  // Try common description property names
  for (const name of ['Description', 'description', 'Body', 'body']) {
    const text = getPropertyValue(page, name, 'rich_text');
    if (text) return text;
  }
  return undefined;
}

/** Search for children pages by description text convention. */
async function fetchChildrenByDescription(
  token: string,
  databaseId: string,
  descriptionRef: string,
): Promise<{ total: number; incomplete: number } | undefined> {
  // Notion doesn't have a text search filter on rich_text properties directly,
  // so we query all pages and filter client-side for the "Epic: " convention
  const result = await queryDatabase(token, databaseId);
  if (!result) return undefined;

  const matching = result.results.filter((page) => {
    const desc = getDescriptionText(page);
    return desc?.includes(descriptionRef);
  });

  const total = matching.length;
  if (total === 0) return { total: 0, incomplete: 0 };

  const incomplete = matching.filter((page) => {
    const status =
      getPropertyValue(page, 'Status', 'status') ??
      getPropertyValue(page, 'Status', 'select');
    return !status || !isCompleteStatus(status);
  }).length;

  return { total, incomplete };
}

/** Search for children pages by relation property. */
async function fetchChildrenByRelation(
  token: string,
  databaseId: string,
  parentPageId: string,
  parentProp: string,
): Promise<{ total: number; incomplete: number } | undefined> {
  const result = await queryDatabase(token, databaseId, {
    property: parentProp,
    relation: { contains: parentPageId },
  });

  if (!result) return undefined;

  const total = result.results.length;
  if (total === 0) return { total: 0, incomplete: 0 };

  const incomplete = result.results.filter((page) => {
    const status =
      getPropertyValue(page, 'Status', 'status') ??
      getPropertyValue(page, 'Status', 'select');
    return !status || !isCompleteStatus(status);
  }).length;

  return { total, incomplete };
}

/** Find a page by its short key (notion-{first8}) in a database. */
async function findPageByKey(
  token: string,
  databaseId: string,
  key: string,
): Promise<NotionPage | undefined> {
  // Extract the short ID from the key
  const shortId = key.replace('notion-', '');
  if (!shortId) return undefined;

  const result = await queryDatabase(token, databaseId);
  if (!result) return undefined;

  return result.results.find(
    (page) => page.id.replace(/-/g, '').slice(0, 8) === shortId,
  );
}
