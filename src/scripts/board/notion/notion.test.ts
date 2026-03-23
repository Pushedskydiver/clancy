import { afterEach, describe, expect, it, vi } from 'vitest';

import { retryFetch } from '~/scripts/shared/http/retry-fetch.js';

import {
  fetchBlockerStatus,
  fetchChildrenStatus,
  fetchPage,
  getPropertyValue,
  pingNotion,
  queryDatabase,
  updatePage,
} from './notion.js';

// Mock retryFetch before importing the module under test
vi.mock('~/scripts/shared/http/retry-fetch.js', () => ({
  retryFetch: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const TOKEN = 'ntn_test_token';
const DATABASE_ID = 'db-uuid-1234';
const PAGE_ID = 'ab12cd34-5678-9abc-def0-123456789abc';

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response;
}

function makePage(
  id: string,
  title: string,
  statusName = 'To-do',
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    properties: {
      Name: {
        type: 'title',
        title: [{ plain_text: title }],
      },
      Status: {
        type: 'status',
        status: { name: statusName },
      },
      ...extra,
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('notion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('pingNotion', () => {
    it('returns ok true on successful response', async () => {
      vi.mocked(retryFetch).mockResolvedValue(
        mockResponse({ id: 'bot-user-uuid', type: 'bot', name: 'Clancy' }),
      );

      const result = await pingNotion(TOKEN);
      expect(result).toEqual({ ok: true });
    });

    it('returns error on auth failure (401)', async () => {
      vi.mocked(retryFetch).mockResolvedValue(mockResponse({}, 401));

      const result = await pingNotion(TOKEN);
      expect(result).toEqual({
        ok: false,
        error: '✗ Notion auth failed — check NOTION_TOKEN',
      });
    });

    it('returns error on auth failure (403)', async () => {
      vi.mocked(retryFetch).mockResolvedValue(mockResponse({}, 403));

      const result = await pingNotion(TOKEN);
      expect(result).toEqual({
        ok: false,
        error: '✗ Notion auth failed — check NOTION_TOKEN',
      });
    });

    it('returns error on server error', async () => {
      vi.mocked(retryFetch).mockResolvedValue(mockResponse({}, 500));

      const result = await pingNotion(TOKEN);
      expect(result).toEqual({
        ok: false,
        error: '✗ Notion API returned HTTP 500',
      });
    });

    it('returns error on network failure', async () => {
      vi.mocked(retryFetch).mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await pingNotion(TOKEN);
      expect(result).toEqual({
        ok: false,
        error: '✗ Could not reach Notion — check network',
      });
    });

    it('sends correct headers', async () => {
      vi.mocked(retryFetch).mockResolvedValue(
        mockResponse({ id: 'bot-user-uuid' }),
      );

      await pingNotion(TOKEN);

      expect(retryFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/users/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${TOKEN}`,
            'Notion-Version': '2022-06-28',
          }),
        }),
      );
    });

    it('returns error on invalid JSON response', async () => {
      vi.mocked(retryFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('invalid json')),
        headers: new Headers(),
      } as unknown as Response);

      const result = await pingNotion(TOKEN);
      expect(result).toEqual({
        ok: false,
        error: '✗ Notion auth failed — check NOTION_TOKEN',
      });
    });
  });

  describe('queryDatabase', () => {
    it('returns parsed results on success', async () => {
      const page = makePage(PAGE_ID, 'Test ticket');
      vi.mocked(retryFetch).mockResolvedValue(
        mockResponse({
          results: [page],
          has_more: false,
          next_cursor: null,
        }),
      );

      const result = await queryDatabase(TOKEN, DATABASE_ID);

      expect(result).toBeDefined();
      expect(result!.results).toHaveLength(1);
      expect(result!.results[0].id).toBe(PAGE_ID);
      expect(result!.has_more).toBe(false);
    });

    it('sends filter and sorts when provided', async () => {
      vi.mocked(retryFetch).mockResolvedValue(
        mockResponse({ results: [], has_more: false, next_cursor: null }),
      );

      const filter = { property: 'Status', status: { equals: 'To-do' } };
      const sorts = [{ property: 'Created', direction: 'ascending' }];

      await queryDatabase(TOKEN, DATABASE_ID, filter, sorts);

      expect(retryFetch).toHaveBeenCalledWith(
        `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ filter, sorts }),
        }),
      );
    });

    it('sends start_cursor for pagination', async () => {
      vi.mocked(retryFetch).mockResolvedValue(
        mockResponse({ results: [], has_more: false, next_cursor: null }),
      );

      await queryDatabase(
        TOKEN,
        DATABASE_ID,
        undefined,
        undefined,
        'cursor-abc',
      );

      expect(retryFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ start_cursor: 'cursor-abc' }),
        }),
      );
    });

    it('returns undefined on HTTP error', async () => {
      vi.mocked(retryFetch).mockResolvedValue(mockResponse({}, 400));

      const result = await queryDatabase(TOKEN, DATABASE_ID);
      expect(result).toBeUndefined();
    });

    it('returns undefined on network failure', async () => {
      vi.mocked(retryFetch).mockRejectedValue(new Error('network error'));

      const result = await queryDatabase(TOKEN, DATABASE_ID);
      expect(result).toBeUndefined();
    });

    it('returns undefined on invalid JSON', async () => {
      vi.mocked(retryFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('invalid json')),
        headers: new Headers(),
      } as unknown as Response);

      const result = await queryDatabase(TOKEN, DATABASE_ID);
      expect(result).toBeUndefined();
    });
  });

  describe('fetchPage', () => {
    it('returns parsed page on success', async () => {
      const page = makePage(PAGE_ID, 'Test page');
      vi.mocked(retryFetch).mockResolvedValue(mockResponse(page));

      const result = await fetchPage(TOKEN, PAGE_ID);

      expect(result).toBeDefined();
      expect(result!.id).toBe(PAGE_ID);
    });

    it('returns undefined on HTTP error', async () => {
      vi.mocked(retryFetch).mockResolvedValue(mockResponse({}, 404));

      const result = await fetchPage(TOKEN, PAGE_ID);
      expect(result).toBeUndefined();
    });

    it('returns undefined on network failure', async () => {
      vi.mocked(retryFetch).mockRejectedValue(new Error('timeout'));

      const result = await fetchPage(TOKEN, PAGE_ID);
      expect(result).toBeUndefined();
    });
  });

  describe('updatePage', () => {
    it('returns true on success', async () => {
      vi.mocked(retryFetch).mockResolvedValue(mockResponse({}));

      const result = await updatePage(TOKEN, PAGE_ID, {
        Status: { status: { name: 'In Progress' } },
      });

      expect(result).toBe(true);
    });

    it('sends PATCH with properties in body', async () => {
      vi.mocked(retryFetch).mockResolvedValue(mockResponse({}));

      const props = { Status: { status: { name: 'Done' } } };
      await updatePage(TOKEN, PAGE_ID, props);

      expect(retryFetch).toHaveBeenCalledWith(
        `https://api.notion.com/v1/pages/${PAGE_ID}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ properties: props }),
        }),
      );
    });

    it('returns false on HTTP error', async () => {
      vi.mocked(retryFetch).mockResolvedValue(mockResponse({}, 400));

      const result = await updatePage(TOKEN, PAGE_ID, {});
      expect(result).toBe(false);
    });

    it('returns false on network failure', async () => {
      vi.mocked(retryFetch).mockRejectedValue(new Error('network'));

      const result = await updatePage(TOKEN, PAGE_ID, {});
      expect(result).toBe(false);
    });
  });

  describe('fetchBlockerStatus', () => {
    it('returns false when page has no blockers', async () => {
      const page = makePage(PAGE_ID, 'Unblocked');
      vi.mocked(retryFetch).mockResolvedValue(mockResponse(page));

      const result = await fetchBlockerStatus(TOKEN, DATABASE_ID, PAGE_ID);
      expect(result).toBe(false);
    });

    it('returns true when blocked by relation with incomplete status', async () => {
      const blockerPage = makePage(
        'blocker-id-1234-5678-abcd-efgh12345678',
        'Blocker',
        'In Progress',
      );
      const page = {
        id: PAGE_ID,
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Blocked task' }] },
          Status: { type: 'status', status: { name: 'To-do' } },
          'Blocked by': {
            type: 'relation',
            relation: [{ id: 'blocker-id-1234-5678-abcd-efgh12345678' }],
          },
        },
      };

      vi.mocked(retryFetch)
        .mockResolvedValueOnce(mockResponse(page)) // fetchPage for the page itself
        .mockResolvedValueOnce(mockResponse(blockerPage)); // fetchPage for the blocker

      const result = await fetchBlockerStatus(TOKEN, DATABASE_ID, PAGE_ID);
      expect(result).toBe(true);
    });

    it('returns false when blocker is complete', async () => {
      const blockerPage = makePage(
        'blocker-id-1234-5678-abcd-efgh12345678',
        'Blocker',
        'Done',
      );
      const page = {
        id: PAGE_ID,
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Blocked task' }] },
          Status: { type: 'status', status: { name: 'To-do' } },
          'Blocked by': {
            type: 'relation',
            relation: [{ id: 'blocker-id-1234-5678-abcd-efgh12345678' }],
          },
        },
      };

      vi.mocked(retryFetch)
        .mockResolvedValueOnce(mockResponse(page))
        .mockResolvedValueOnce(mockResponse(blockerPage));

      const result = await fetchBlockerStatus(TOKEN, DATABASE_ID, PAGE_ID);
      expect(result).toBe(false);
    });

    it('returns false on network failure', async () => {
      vi.mocked(retryFetch).mockRejectedValue(new Error('network'));

      const result = await fetchBlockerStatus(TOKEN, DATABASE_ID, PAGE_ID);
      expect(result).toBe(false);
    });
  });

  describe('fetchChildrenStatus', () => {
    it('returns children count from description text convention', async () => {
      const child1 = {
        ...makePage('child-1-uuid-0000-0000-000000000000', 'Child 1', 'Done'),
        properties: {
          ...makePage('child-1-uuid-0000-0000-000000000000', 'Child 1', 'Done')
            .properties,
          Description: {
            type: 'rich_text',
            rich_text: [{ plain_text: 'Epic: notion-ab12cd34' }],
          },
        },
      };

      const child2 = {
        ...makePage('child-2-uuid-0000-0000-000000000000', 'Child 2', 'To-do'),
        properties: {
          ...makePage('child-2-uuid-0000-0000-000000000000', 'Child 2', 'To-do')
            .properties,
          Description: {
            type: 'rich_text',
            rich_text: [{ plain_text: 'Epic: notion-ab12cd34' }],
          },
        },
      };

      vi.mocked(retryFetch).mockResolvedValue(
        mockResponse({
          results: [child1, child2],
          has_more: false,
          next_cursor: null,
        }),
      );

      const result = await fetchChildrenStatus(
        TOKEN,
        DATABASE_ID,
        'notion-ab12cd34',
      );

      expect(result).toEqual({ total: 2, incomplete: 1 });
    });

    it('returns undefined on failure', async () => {
      vi.mocked(retryFetch).mockRejectedValue(new Error('network'));

      const result = await fetchChildrenStatus(
        TOKEN,
        DATABASE_ID,
        'notion-ab12cd34',
      );

      expect(result).toBeUndefined();
    });

    it('returns undefined when no children match via either mode', async () => {
      // Mode 1 (description search) returns empty results
      // Mode 2 (findPageByKey) also returns empty results — parent page not found
      vi.mocked(retryFetch)
        .mockResolvedValueOnce(
          mockResponse({ results: [], has_more: false, next_cursor: null }),
        )
        .mockResolvedValueOnce(
          mockResponse({ results: [], has_more: false, next_cursor: null }),
        );

      const result = await fetchChildrenStatus(
        TOKEN,
        DATABASE_ID,
        'notion-ab12cd34',
      );

      // No children found via description, and parent page not found for relation mode
      expect(result).toBeUndefined();
    });
  });

  describe('getPropertyValue', () => {
    it('extracts status property', () => {
      const page = makePage(PAGE_ID, 'Test', 'In Progress');

      const result = getPropertyValue(page, 'Status', 'status');
      expect(result).toBe('In Progress');
    });

    it('extracts title property', () => {
      const page = makePage(PAGE_ID, 'My Title');

      const result = getPropertyValue(page, 'Name', 'title');
      expect(result).toBe('My Title');
    });

    it('extracts multi_select property', () => {
      const page = {
        id: PAGE_ID,
        properties: {
          Labels: {
            type: 'multi_select' as const,
            multi_select: [{ name: 'bug' }, { name: 'urgent' }],
          },
        },
      };

      const result = getPropertyValue(page, 'Labels', 'multi_select');
      expect(result).toEqual(['bug', 'urgent']);
    });

    it('extracts rich_text property', () => {
      const page = {
        id: PAGE_ID,
        properties: {
          Description: {
            type: 'rich_text' as const,
            rich_text: [{ plain_text: 'Hello ' }, { plain_text: 'world' }],
          },
        },
      };

      const result = getPropertyValue(page, 'Description', 'rich_text');
      expect(result).toBe('Hello world');
    });

    it('extracts people property', () => {
      const page = {
        id: PAGE_ID,
        properties: {
          Assignee: {
            type: 'people' as const,
            people: [{ id: 'user-1' }, { id: 'user-2' }],
          },
        },
      };

      const result = getPropertyValue(page, 'Assignee', 'people');
      expect(result).toEqual(['user-1', 'user-2']);
    });

    it('extracts relation property', () => {
      const page = {
        id: PAGE_ID,
        properties: {
          Epic: {
            type: 'relation' as const,
            relation: [{ id: 'page-uuid-1' }, { id: 'page-uuid-2' }],
          },
        },
      };

      const result = getPropertyValue(page, 'Epic', 'relation');
      expect(result).toEqual(['page-uuid-1', 'page-uuid-2']);
    });

    it('extracts select property', () => {
      const page = {
        id: PAGE_ID,
        properties: {
          Priority: {
            type: 'select' as const,
            select: { name: 'High' },
          },
        },
      };

      const result = getPropertyValue(page, 'Priority', 'select');
      expect(result).toBe('High');
    });

    it('returns undefined for missing property', () => {
      const page = makePage(PAGE_ID, 'Test');

      const result = getPropertyValue(page, 'NonExistent', 'status');
      expect(result).toBeUndefined();
    });

    it('returns undefined for type mismatch', () => {
      const page = makePage(PAGE_ID, 'Test');

      const result = getPropertyValue(page, 'Status', 'title');
      expect(result).toBeUndefined();
    });

    it('returns undefined for null status', () => {
      const page = {
        id: PAGE_ID,
        properties: {
          Status: {
            type: 'status' as const,
            status: null,
          },
        },
      };

      const result = getPropertyValue(page, 'Status', 'status');
      expect(result).toBeUndefined();
    });

    it('returns undefined for null select', () => {
      const page = {
        id: PAGE_ID,
        properties: {
          Priority: {
            type: 'select' as const,
            select: null,
          },
        },
      };

      const result = getPropertyValue(page, 'Priority', 'select');
      expect(result).toBeUndefined();
    });
  });
});
