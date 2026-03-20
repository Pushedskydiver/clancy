/**
 * Notion board factory.
 *
 * Returns a plain object conforming to the Board type, delegating to the
 * existing Notion board functions. Notion's dynamic property system requires
 * configurable property names via env vars.
 *
 * Key format: `notion-{first-8-chars-of-uuid}` (e.g., `notion-ab12cd34`)
 * Full UUID stored in `issueId` for API calls.
 */
import type { NotionEnv } from '~/schemas/env.js';
import type { NotionPage } from '~/schemas/notion.js';
import type { FetchedTicket } from '~/types/board.js';

import type { Board, FetchTicketOpts } from '../board.js';
import {
  fetchBlockerStatus as fetchNotionBlockerStatus,
  fetchChildrenStatus as fetchNotionChildrenStatus,
  getPropertyValue,
  pingNotion,
  queryDatabase,
  updatePage,
} from './notion.js';

// ─── Property name defaults ─────────────────────────────────────────────────

const DEFAULT_STATUS_PROP = 'Status';
const DEFAULT_ASSIGNEE_PROP = 'Assignee';
const DEFAULT_LABELS_PROP = 'Labels';
const DEFAULT_PARENT_PROP = 'Epic';

/**
 * Create a Board implementation for Notion.
 *
 * @param env - The validated Notion environment variables.
 * @returns A Board object that delegates to Notion API functions.
 */
export function createNotionBoard(env: NotionEnv): Board {
  const statusProp = env.CLANCY_NOTION_STATUS ?? DEFAULT_STATUS_PROP;
  const assigneeProp = env.CLANCY_NOTION_ASSIGNEE ?? DEFAULT_ASSIGNEE_PROP;
  const labelsProp = env.CLANCY_NOTION_LABELS ?? DEFAULT_LABELS_PROP;
  const parentProp = env.CLANCY_NOTION_PARENT ?? DEFAULT_PARENT_PROP;

  return {
    async ping() {
      return pingNotion(env.NOTION_TOKEN);
    },

    validateInputs() {
      // Validate database ID looks like a UUID (with or without hyphens)
      const uuidPattern =
        /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
      if (!uuidPattern.test(env.NOTION_DATABASE_ID)) {
        return '✗ NOTION_DATABASE_ID does not look like a valid UUID. Use the database ID from the Notion URL, not the full URL.';
      }
      return undefined;
    },

    async fetchTicket(opts: FetchTicketOpts) {
      const tickets = await this.fetchTickets(opts);
      return tickets[0];
    },

    async fetchTickets(opts: FetchTicketOpts) {
      // Build filter: status = backlog/to-do (not in-progress)
      const statusFilter = buildStatusFilter(statusProp, 'To-do');

      const result = await queryDatabase(
        env.NOTION_TOKEN,
        env.NOTION_DATABASE_ID,
        statusFilter,
      );

      if (!result) return [];

      let pages = result.results;

      // HITL/AFK filtering: exclude pages with clancy:hitl label
      if (opts.excludeHitl) {
        pages = pages.filter((page) => {
          const labels = getPropertyValue(page, labelsProp, 'multi_select');
          return !labels?.includes('clancy:hitl');
        });
      }

      // Filter by CLANCY_LABEL if set
      if (env.CLANCY_LABEL) {
        const requiredLabel = env.CLANCY_LABEL;
        pages = pages.filter((page) => {
          const labels = getPropertyValue(page, labelsProp, 'multi_select');
          return labels?.includes(requiredLabel);
        });
      }

      return pages.slice(0, 5).map((page) =>
        pageToFetchedTicket(page, {
          labelsProp,
          parentProp,
          assigneeProp,
        }),
      );
    },

    async fetchBlockerStatus(ticket: FetchedTicket) {
      const pageId = ticket.issueId;
      if (!pageId) return false;
      return fetchNotionBlockerStatus(
        env.NOTION_TOKEN,
        env.NOTION_DATABASE_ID,
        pageId,
      );
    },

    async fetchChildrenStatus(parentKey: string) {
      return fetchNotionChildrenStatus(
        env.NOTION_TOKEN,
        env.NOTION_DATABASE_ID,
        parentKey,
        parentProp,
      );
    },

    async transitionTicket(ticket: FetchedTicket, status: string) {
      const pageId = ticket.issueId;
      if (!pageId) return false;

      // Try Status property type first, then fall back to Select
      const ok = await updatePage(env.NOTION_TOKEN, pageId, {
        [statusProp]: { status: { name: status } },
      });

      if (ok) {
        console.log(`  → Transitioned to ${status}`);
        return true;
      }

      // Fallback: try as select property (older databases)
      const fallbackOk = await updatePage(env.NOTION_TOKEN, pageId, {
        [statusProp]: { select: { name: status } },
      });

      if (fallbackOk) {
        console.log(`  → Transitioned to ${status}`);
      }

      return fallbackOk;
    },

    async ensureLabel(_label: string) {
      // No-op: Notion multi_select options auto-create on first PATCH
    },

    async addLabel(issueKey: string, label: string) {
      try {
        const page = await resolvePageFromKey(
          env.NOTION_TOKEN,
          env.NOTION_DATABASE_ID,
          issueKey,
        );
        if (!page) return;

        const currentLabels =
          getPropertyValue(page, labelsProp, 'multi_select') ?? [];
        if (currentLabels.includes(label)) return;

        const newLabels = [...currentLabels, label].map((name) => ({ name }));

        await updatePage(env.NOTION_TOKEN, page.id, {
          [labelsProp]: { multi_select: newLabels },
        });
      } catch (err) {
        console.warn(
          `⚠ addLabel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async removeLabel(issueKey: string, label: string) {
      try {
        const page = await resolvePageFromKey(
          env.NOTION_TOKEN,
          env.NOTION_DATABASE_ID,
          issueKey,
        );
        if (!page) return;

        const currentLabels =
          getPropertyValue(page, labelsProp, 'multi_select') ?? [];
        if (!currentLabels.includes(label)) return;

        const newLabels = currentLabels
          .filter((name) => name !== label)
          .map((name) => ({ name }));

        await updatePage(env.NOTION_TOKEN, page.id, {
          [labelsProp]: { multi_select: newLabels },
        });
      } catch (err) {
        console.warn(
          `⚠ removeLabel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    sharedEnv() {
      return env;
    },
  };
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Build a status filter for "To-do" or custom status. */
function buildStatusFilter(
  statusProp: string,
  customStatus?: string,
): Record<string, unknown> {
  const statusName = customStatus ?? 'To-do';

  // Try both Status and Select property types — Notion returns empty
  // results (not errors) when the filter type doesn't match the property.
  // Using `or` ensures we find pages regardless of which type is used.
  return {
    or: [
      { property: statusProp, status: { equals: statusName } },
      { property: statusProp, select: { equals: statusName } },
    ],
  };
}

/** Convert a Notion page to a FetchedTicket. */
function pageToFetchedTicket(
  page: NotionPage,
  props: {
    labelsProp: string;
    parentProp: string;
    assigneeProp: string;
  },
): FetchedTicket {
  const shortId = page.id.replace(/-/g, '').slice(0, 8);
  const key = `notion-${shortId}`;

  // Extract title from the first title-type property
  let title = '';
  for (const [propName, prop] of Object.entries(page.properties)) {
    if (prop.type === 'title') {
      title = getPropertyValue(page, propName, 'title') ?? '';
      break;
    }
  }

  // Extract description from rich_text properties
  let description = '';
  for (const name of ['Description', 'description', 'Body', 'body']) {
    const text = getPropertyValue(page, name, 'rich_text');
    if (text) {
      description = text;
      break;
    }
  }

  // Extract parent info from relation property
  const parentRelations = getPropertyValue(page, props.parentProp, 'relation');
  const parentInfo =
    parentRelations && parentRelations.length > 0
      ? `notion-${parentRelations[0].replace(/-/g, '').slice(0, 8)}`
      : 'none';

  // Extract labels
  const labels = getPropertyValue(page, props.labelsProp, 'multi_select') ?? [];

  return {
    key,
    title,
    description,
    parentInfo,
    blockers: 'None',
    issueId: page.id,
    labels,
    status: 'To-do',
  };
}

/**
 * Resolve a Notion page from a short key by querying the database.
 *
 * @param token - The Notion integration token.
 * @param databaseId - The database UUID.
 * @param issueKey - The short key (e.g., `'notion-ab12cd34'`).
 * @returns The matching page, or `undefined` if not found.
 */
async function resolvePageFromKey(
  token: string,
  databaseId: string,
  issueKey: string,
): Promise<NotionPage | undefined> {
  const shortId = issueKey.replace('notion-', '');
  if (!shortId) return undefined;

  const result = await queryDatabase(token, databaseId);
  if (!result) return undefined;

  return result.results.find(
    (page) => page.id.replace(/-/g, '').slice(0, 8) === shortId,
  );
}
