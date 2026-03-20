import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotionEnv } from '~/schemas/env.js';
import type { FetchedTicket } from '~/types/board.js';

import { createNotionBoard } from './notion-board.js';

// Mock the underlying Notion functions
vi.mock('./notion.js', () => ({
  pingNotion: vi.fn(() => Promise.resolve({ ok: true })),
  queryDatabase: vi.fn(() =>
    Promise.resolve({ results: [], has_more: false, next_cursor: null }),
  ),
  fetchPage: vi.fn(() => Promise.resolve(undefined)),
  updatePage: vi.fn(() => Promise.resolve(true)),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
  fetchChildrenStatus: vi.fn(() =>
    Promise.resolve({ total: 4, incomplete: 2 }),
  ),
  getPropertyValue: vi.fn(),
}));

const baseEnv: NotionEnv = {
  NOTION_TOKEN: 'ntn_test_token',
  NOTION_DATABASE_ID: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
};

describe('notion-board', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('createNotionBoard', () => {
    it('returns an object with all Board methods', () => {
      const board = createNotionBoard(baseEnv);

      expect(typeof board.ping).toBe('function');
      expect(typeof board.validateInputs).toBe('function');
      expect(typeof board.fetchTicket).toBe('function');
      expect(typeof board.fetchTickets).toBe('function');
      expect(typeof board.fetchBlockerStatus).toBe('function');
      expect(typeof board.fetchChildrenStatus).toBe('function');
      expect(typeof board.transitionTicket).toBe('function');
      expect(typeof board.ensureLabel).toBe('function');
      expect(typeof board.addLabel).toBe('function');
      expect(typeof board.removeLabel).toBe('function');
      expect(typeof board.sharedEnv).toBe('function');
    });
  });

  describe('ping', () => {
    it('delegates to pingNotion with correct params', async () => {
      const { pingNotion } = await import('./notion.js');
      const board = createNotionBoard(baseEnv);

      await board.ping();

      expect(pingNotion).toHaveBeenCalledWith('ntn_test_token');
    });
  });

  describe('validateInputs', () => {
    it('returns undefined (no structural validation for Notion tokens)', () => {
      const board = createNotionBoard(baseEnv);
      expect(board.validateInputs()).toBeUndefined();
    });
  });

  describe('fetchTickets', () => {
    it('delegates to queryDatabase and normalises results', async () => {
      const { queryDatabase, getPropertyValue } = await import('./notion.js');

      const page = {
        id: 'ab12cd34-5678-9abc-def0-123456789abc',
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'Fix login bug' }],
          },
          Status: {
            type: 'status',
            status: { name: 'To-do' },
          },
          Description: {
            type: 'rich_text',
            rich_text: [{ plain_text: 'The login form crashes' }],
          },
          Labels: {
            type: 'multi_select',
            multi_select: [{ name: 'bug' }],
          },
          Epic: {
            type: 'relation',
            relation: [],
          },
        },
      };

      vi.mocked(queryDatabase).mockResolvedValueOnce({
        results: [page],
        has_more: false,
        next_cursor: null,
      });

      // Mock getPropertyValue for the various calls in pageToFetchedTicket
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (vi.mocked(getPropertyValue) as any).mockImplementation(
        (p: unknown, propName: string, propType: string) => {
          const pageObj = p as typeof page;
          const prop =
            pageObj.properties[propName as keyof typeof pageObj.properties];
          if (!prop || prop.type !== propType) return undefined;

          if (propType === 'title' && 'title' in prop) {
            return (prop.title as { plain_text: string }[])
              .map((t) => t.plain_text)
              .join('');
          }
          if (propType === 'rich_text' && 'rich_text' in prop) {
            return (prop.rich_text as { plain_text: string }[])
              .map((t) => t.plain_text)
              .join('');
          }
          if (propType === 'multi_select' && 'multi_select' in prop) {
            return (prop.multi_select as { name: string }[]).map((o) => o.name);
          }
          if (propType === 'relation' && 'relation' in prop) {
            return (prop.relation as { id: string }[]).map((r) => r.id);
          }
          return undefined;
        },
      );

      const board = createNotionBoard(baseEnv);
      const tickets = await board.fetchTickets({});

      expect(tickets).toHaveLength(1);
      expect(tickets[0].key).toBe('notion-ab12cd34');
      expect(tickets[0].title).toBe('Fix login bug');
      expect(tickets[0].description).toBe('The login form crashes');
      expect(tickets[0].issueId).toBe('ab12cd34-5678-9abc-def0-123456789abc');
      expect(tickets[0].parentInfo).toBe('none');
      expect(tickets[0].labels).toEqual(['bug']);
    });

    it('returns empty array when queryDatabase returns undefined', async () => {
      const { queryDatabase } = await import('./notion.js');
      vi.mocked(queryDatabase).mockResolvedValueOnce(undefined);

      const board = createNotionBoard(baseEnv);
      const tickets = await board.fetchTickets({});

      expect(tickets).toEqual([]);
    });

    it('filters out hitl tickets when excludeHitl is true', async () => {
      const { queryDatabase, getPropertyValue } = await import('./notion.js');

      const hitlPage = {
        id: 'hitl-page-5678-9abc-def0-123456789abc',
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'HITL task' }] },
          Status: { type: 'status', status: { name: 'To-do' } },
          Labels: {
            type: 'multi_select',
            multi_select: [{ name: 'clancy:hitl' }],
          },
        },
      };

      vi.mocked(queryDatabase).mockResolvedValueOnce({
        results: [hitlPage],
        has_more: false,
        next_cursor: null,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (vi.mocked(getPropertyValue) as any).mockImplementation(
        (_p: unknown, propName: string, propType: string) => {
          if (propName === 'Labels' && propType === 'multi_select') {
            return ['clancy:hitl'];
          }
          return undefined;
        },
      );

      const board = createNotionBoard(baseEnv);
      const tickets = await board.fetchTickets({ excludeHitl: true });

      expect(tickets).toEqual([]);
    });
  });

  describe('fetchTicket', () => {
    it('returns the first ticket from fetchTickets', async () => {
      const { queryDatabase, getPropertyValue } = await import('./notion.js');

      const page = {
        id: 'ab12cd34-5678-9abc-def0-123456789abc',
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Task 1' }] },
          Status: { type: 'status', status: { name: 'To-do' } },
        },
      };

      vi.mocked(queryDatabase).mockResolvedValueOnce({
        results: [page],
        has_more: false,
        next_cursor: null,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (vi.mocked(getPropertyValue) as any).mockImplementation(
        (_p: unknown, propName: string, propType: string) => {
          if (propName === 'Name' && propType === 'title') return 'Task 1';
          return undefined;
        },
      );

      const board = createNotionBoard(baseEnv);
      const ticket = await board.fetchTicket({});

      expect(ticket).toBeDefined();
      expect(ticket!.key).toBe('notion-ab12cd34');
    });

    it('returns undefined when no tickets available', async () => {
      const { queryDatabase } = await import('./notion.js');
      vi.mocked(queryDatabase).mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null,
      });

      const board = createNotionBoard(baseEnv);
      const ticket = await board.fetchTicket({});

      expect(ticket).toBeUndefined();
    });
  });

  describe('fetchBlockerStatus', () => {
    it('delegates to fetchNotionBlockerStatus', async () => {
      const { fetchBlockerStatus } = await import('./notion.js');
      const board = createNotionBoard(baseEnv);

      const ticket: FetchedTicket = {
        key: 'notion-ab12cd34',
        title: 'Test',
        description: '',
        parentInfo: 'none',
        blockers: 'None',
        issueId: 'ab12cd34-5678-9abc-def0-123456789abc',
      };

      await board.fetchBlockerStatus(ticket);

      expect(fetchBlockerStatus).toHaveBeenCalledWith(
        'ntn_test_token',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'ab12cd34-5678-9abc-def0-123456789abc',
        'Status', // default status prop
      );
    });

    it('returns false when ticket has no issueId', async () => {
      const board = createNotionBoard(baseEnv);

      const ticket: FetchedTicket = {
        key: 'notion-ab12cd34',
        title: 'Test',
        description: '',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.fetchBlockerStatus(ticket);
      expect(result).toBe(false);
    });
  });

  describe('fetchChildrenStatus', () => {
    it('delegates to fetchNotionChildrenStatus', async () => {
      const { fetchChildrenStatus } = await import('./notion.js');
      const board = createNotionBoard(baseEnv);

      await board.fetchChildrenStatus('notion-ab12cd34');

      expect(fetchChildrenStatus).toHaveBeenCalledWith(
        'ntn_test_token',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'notion-ab12cd34',
        'Epic', // default parent prop
        'Status', // default status prop
      );
    });

    it('uses custom parent prop from env', async () => {
      const { fetchChildrenStatus } = await import('./notion.js');
      const envWithCustomProp: NotionEnv = {
        ...baseEnv,
        CLANCY_NOTION_PARENT: 'Parent Task',
      };
      const board = createNotionBoard(envWithCustomProp);

      await board.fetchChildrenStatus('notion-ab12cd34');

      expect(fetchChildrenStatus).toHaveBeenCalledWith(
        'ntn_test_token',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'notion-ab12cd34',
        'Parent Task',
        'Status', // default status prop
      );
    });
  });

  describe('transitionTicket', () => {
    it('updates page status property', async () => {
      const { updatePage } = await import('./notion.js');
      vi.mocked(updatePage).mockResolvedValueOnce(true);

      const board = createNotionBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'notion-ab12cd34',
        title: 'Test',
        description: '',
        parentInfo: 'none',
        blockers: 'None',
        issueId: 'ab12cd34-5678-9abc-def0-123456789abc',
      };

      const result = await board.transitionTicket(ticket, 'In Progress');

      expect(result).toBe(true);
      expect(updatePage).toHaveBeenCalledWith(
        'ntn_test_token',
        'ab12cd34-5678-9abc-def0-123456789abc',
        { Status: { status: { name: 'In Progress' } } },
      );
    });

    it('falls back to select property on status failure', async () => {
      const { updatePage } = await import('./notion.js');
      vi.mocked(updatePage)
        .mockResolvedValueOnce(false) // status property fails
        .mockResolvedValueOnce(true); // select property succeeds

      const board = createNotionBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'notion-ab12cd34',
        title: 'Test',
        description: '',
        parentInfo: 'none',
        blockers: 'None',
        issueId: 'ab12cd34-5678-9abc-def0-123456789abc',
      };

      const result = await board.transitionTicket(ticket, 'In Progress');

      expect(result).toBe(true);
      expect(updatePage).toHaveBeenCalledTimes(2);
      expect(updatePage).toHaveBeenLastCalledWith(
        'ntn_test_token',
        'ab12cd34-5678-9abc-def0-123456789abc',
        { Status: { select: { name: 'In Progress' } } },
      );
    });

    it('uses custom status prop from env', async () => {
      const { updatePage } = await import('./notion.js');
      vi.mocked(updatePage).mockResolvedValueOnce(true);

      const envWithCustomStatus: NotionEnv = {
        ...baseEnv,
        CLANCY_NOTION_STATUS: 'Task Status',
      };
      const board = createNotionBoard(envWithCustomStatus);
      const ticket: FetchedTicket = {
        key: 'notion-ab12cd34',
        title: 'Test',
        description: '',
        parentInfo: 'none',
        blockers: 'None',
        issueId: 'ab12cd34-5678-9abc-def0-123456789abc',
      };

      await board.transitionTicket(ticket, 'Done');

      expect(updatePage).toHaveBeenCalledWith(
        'ntn_test_token',
        'ab12cd34-5678-9abc-def0-123456789abc',
        { 'Task Status': { status: { name: 'Done' } } },
      );
    });

    it('returns false when ticket has no issueId', async () => {
      const board = createNotionBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'notion-ab12cd34',
        title: 'Test',
        description: '',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.transitionTicket(ticket, 'Done');
      expect(result).toBe(false);
    });
  });

  describe('ensureLabel', () => {
    it('is a no-op (Notion multi_select auto-creates)', async () => {
      const board = createNotionBoard(baseEnv);

      // Should not throw
      await board.ensureLabel('clancy:build');
    });
  });

  describe('addLabel', () => {
    it('queries database and updates page with appended label', async () => {
      const { queryDatabase, getPropertyValue, updatePage } =
        await import('./notion.js');

      const page = {
        id: 'ab12cd34-5678-9abc-def0-123456789abc',
        properties: {
          Labels: {
            type: 'multi_select',
            multi_select: [{ name: 'existing' }],
          },
        },
      };

      vi.mocked(queryDatabase).mockResolvedValueOnce({
        results: [page],
        has_more: false,
        next_cursor: null,
      });

      vi.mocked(getPropertyValue).mockReturnValueOnce(['existing']);
      vi.mocked(updatePage).mockResolvedValueOnce(true);

      const board = createNotionBoard(baseEnv);
      await board.addLabel('notion-ab12cd34', 'new-label');

      expect(updatePage).toHaveBeenCalledWith(
        'ntn_test_token',
        'ab12cd34-5678-9abc-def0-123456789abc',
        {
          Labels: {
            multi_select: [{ name: 'existing' }, { name: 'new-label' }],
          },
        },
      );
    });

    it('skips update when label already present', async () => {
      const { queryDatabase, getPropertyValue, updatePage } =
        await import('./notion.js');

      const page = {
        id: 'ab12cd34-5678-9abc-def0-123456789abc',
        properties: {
          Labels: {
            type: 'multi_select',
            multi_select: [{ name: 'existing' }],
          },
        },
      };

      vi.mocked(queryDatabase).mockResolvedValueOnce({
        results: [page],
        has_more: false,
        next_cursor: null,
      });

      vi.mocked(getPropertyValue).mockReturnValueOnce(['existing']);

      const board = createNotionBoard(baseEnv);
      await board.addLabel('notion-ab12cd34', 'existing');

      expect(updatePage).not.toHaveBeenCalled();
    });
  });

  describe('removeLabel', () => {
    it('queries database and updates page with label removed', async () => {
      const { queryDatabase, getPropertyValue, updatePage } =
        await import('./notion.js');

      const page = {
        id: 'ab12cd34-5678-9abc-def0-123456789abc',
        properties: {
          Labels: {
            type: 'multi_select',
            multi_select: [{ name: 'keep' }, { name: 'remove-me' }],
          },
        },
      };

      vi.mocked(queryDatabase).mockResolvedValueOnce({
        results: [page],
        has_more: false,
        next_cursor: null,
      });

      vi.mocked(getPropertyValue).mockReturnValueOnce(['keep', 'remove-me']);
      vi.mocked(updatePage).mockResolvedValueOnce(true);

      const board = createNotionBoard(baseEnv);
      await board.removeLabel('notion-ab12cd34', 'remove-me');

      expect(updatePage).toHaveBeenCalledWith(
        'ntn_test_token',
        'ab12cd34-5678-9abc-def0-123456789abc',
        {
          Labels: {
            multi_select: [{ name: 'keep' }],
          },
        },
      );
    });

    it('skips update when label not present', async () => {
      const { queryDatabase, getPropertyValue, updatePage } =
        await import('./notion.js');

      const page = {
        id: 'ab12cd34-5678-9abc-def0-123456789abc',
        properties: {},
      };

      vi.mocked(queryDatabase).mockResolvedValueOnce({
        results: [page],
        has_more: false,
        next_cursor: null,
      });

      vi.mocked(getPropertyValue).mockReturnValueOnce(['other']);

      const board = createNotionBoard(baseEnv);
      await board.removeLabel('notion-ab12cd34', 'not-present');

      expect(updatePage).not.toHaveBeenCalled();
    });
  });

  describe('sharedEnv', () => {
    it('returns the env record', () => {
      const board = createNotionBoard(baseEnv);
      expect(board.sharedEnv()).toBe(baseEnv);
    });
  });
});
