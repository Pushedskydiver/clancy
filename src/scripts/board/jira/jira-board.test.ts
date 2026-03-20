import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JiraEnv } from '~/schemas/env.js';
import type { FetchedTicket } from '~/scripts/once/types/types.js';

import { createJiraBoard } from './jira-board.js';

// Mock the underlying Jira functions
vi.mock('./jira.js', () => ({
  buildAuthHeader: vi.fn(() => 'mock-auth'),
  pingJira: vi.fn(() => Promise.resolve({ ok: true })),
  isSafeJqlValue: vi.fn((v: string) => /^[a-zA-Z0-9 _\-'.]+$/.test(v)),
  fetchTickets: vi.fn(() => Promise.resolve([])),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
  fetchChildrenStatus: vi.fn(() =>
    Promise.resolve({ total: 3, incomplete: 1 }),
  ),
  transitionIssue: vi.fn(() => Promise.resolve(true)),
}));

const baseEnv: JiraEnv = {
  JIRA_BASE_URL: 'https://example.atlassian.net',
  JIRA_USER: 'user@example.com',
  JIRA_API_TOKEN: 'token123',
  JIRA_PROJECT_KEY: 'PROJ',
};

describe('jira-board', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createJiraBoard', () => {
    it('returns an object with all Board methods', () => {
      const board = createJiraBoard(baseEnv);

      expect(typeof board.ping).toBe('function');
      expect(typeof board.validateInputs).toBe('function');
      expect(typeof board.fetchTicket).toBe('function');
      expect(typeof board.fetchTickets).toBe('function');
      expect(typeof board.fetchBlockerStatus).toBe('function');
      expect(typeof board.fetchChildrenStatus).toBe('function');
      expect(typeof board.transitionTicket).toBe('function');
      expect(typeof board.sharedEnv).toBe('function');
    });
  });

  describe('ping', () => {
    it('delegates to pingJira with correct params', async () => {
      const { pingJira } = await import('./jira.js');
      const board = createJiraBoard(baseEnv);

      await board.ping();

      expect(pingJira).toHaveBeenCalledWith(
        'https://example.atlassian.net',
        'PROJ',
        'mock-auth',
      );
    });
  });

  describe('validateInputs', () => {
    it('returns undefined for valid inputs', () => {
      const board = createJiraBoard(baseEnv);
      expect(board.validateInputs()).toBeUndefined();
    });

    it('returns error for invalid project key', async () => {
      const { isSafeJqlValue } = await import('./jira.js');
      vi.mocked(isSafeJqlValue).mockReturnValueOnce(false);

      const board = createJiraBoard(baseEnv);
      expect(board.validateInputs()).toBe(
        '✗ JIRA_PROJECT_KEY contains invalid characters',
      );
    });

    it('returns error for invalid CLANCY_LABEL', async () => {
      const { isSafeJqlValue } = await import('./jira.js');
      vi.mocked(isSafeJqlValue)
        .mockReturnValueOnce(true) // project key OK
        .mockReturnValueOnce(false); // label bad

      const board = createJiraBoard({
        ...baseEnv,
        CLANCY_LABEL: 'bad;label',
      });
      expect(board.validateInputs()).toBe(
        '✗ CLANCY_LABEL contains invalid characters',
      );
    });

    it('returns error for invalid CLANCY_JQL_STATUS', async () => {
      const { isSafeJqlValue } = await import('./jira.js');
      vi.mocked(isSafeJqlValue)
        .mockReturnValueOnce(true) // project key OK
        .mockReturnValueOnce(false); // status bad

      const board = createJiraBoard({
        ...baseEnv,
        CLANCY_JQL_STATUS: 'bad;status',
      });
      expect(board.validateInputs()).toBe(
        '✗ CLANCY_JQL_STATUS contains invalid characters',
      );
    });
  });

  describe('fetchTickets', () => {
    it('delegates to fetchJiraTickets and normalises results', async () => {
      const { fetchTickets } = await import('./jira.js');
      vi.mocked(fetchTickets).mockResolvedValueOnce([
        {
          key: 'PROJ-1',
          title: 'Test ticket',
          description: 'A test ticket',
          provider: 'jira',
          epicKey: 'PROJ-100',
          blockers: ['PROJ-50'],
        },
      ]);

      const board = createJiraBoard(baseEnv);
      const results = await board.fetchTickets({ excludeHitl: false });

      expect(results).toEqual([
        {
          key: 'PROJ-1',
          title: 'Test ticket',
          description: 'A test ticket',
          parentInfo: 'PROJ-100',
          blockers: 'Blocked by: PROJ-50',
          labels: [],
          status: 'To Do',
        },
      ]);
    });

    it('sets parentInfo to none when no epic', async () => {
      const { fetchTickets } = await import('./jira.js');
      vi.mocked(fetchTickets).mockResolvedValueOnce([
        {
          key: 'PROJ-2',
          title: 'No epic',
          description: 'desc',
          provider: 'jira',
          blockers: [],
        },
      ]);

      const board = createJiraBoard(baseEnv);
      const results = await board.fetchTickets({ excludeHitl: false });

      expect(results[0].parentInfo).toBe('none');
      expect(results[0].blockers).toBe('None');
    });
  });

  describe('fetchTicket', () => {
    it('returns the first ticket from fetchTickets', async () => {
      const { fetchTickets } = await import('./jira.js');
      vi.mocked(fetchTickets).mockResolvedValueOnce([
        {
          key: 'PROJ-1',
          title: 'First',
          description: 'desc',
          provider: 'jira',
          blockers: [],
        },
      ]);

      const board = createJiraBoard(baseEnv);
      const result = await board.fetchTicket({ excludeHitl: false });

      expect(result?.key).toBe('PROJ-1');
    });

    it('returns undefined when no tickets', async () => {
      const { fetchTickets } = await import('./jira.js');
      vi.mocked(fetchTickets).mockResolvedValueOnce([]);

      const board = createJiraBoard(baseEnv);
      const result = await board.fetchTicket({ excludeHitl: false });

      expect(result).toBeUndefined();
    });
  });

  describe('fetchBlockerStatus', () => {
    it('delegates to fetchJiraBlockerStatus', async () => {
      const { fetchBlockerStatus } = await import('./jira.js');
      vi.mocked(fetchBlockerStatus).mockResolvedValueOnce(true);

      const board = createJiraBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'PROJ-1',
        title: 'Test',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.fetchBlockerStatus(ticket);

      expect(fetchBlockerStatus).toHaveBeenCalledWith(
        'https://example.atlassian.net',
        'mock-auth',
        'PROJ-1',
      );
      expect(result).toBe(true);
    });
  });

  describe('fetchChildrenStatus', () => {
    it('delegates to fetchJiraChildrenStatus', async () => {
      const { fetchChildrenStatus } = await import('./jira.js');

      const board = createJiraBoard(baseEnv);
      const result = await board.fetchChildrenStatus('PROJ-100');

      expect(fetchChildrenStatus).toHaveBeenCalledWith(
        'https://example.atlassian.net',
        'mock-auth',
        'PROJ-100',
      );
      expect(result).toEqual({ total: 3, incomplete: 1 });
    });
  });

  describe('transitionTicket', () => {
    it('delegates to transitionJiraIssue and returns result', async () => {
      const { transitionIssue } = await import('./jira.js');

      const board = createJiraBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'PROJ-1',
        title: 'Test',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.transitionTicket(ticket, 'In Progress');

      expect(transitionIssue).toHaveBeenCalledWith(
        'https://example.atlassian.net',
        'mock-auth',
        'PROJ-1',
        'In Progress',
      );
      expect(result).toBe(true);
    });
  });

  describe('ensureLabel', () => {
    it('is a no-op (Jira auto-creates labels)', async () => {
      const board = createJiraBoard(baseEnv);
      await expect(board.ensureLabel('clancy:build')).resolves.toBeUndefined();
    });
  });

  describe('addLabel', () => {
    it('fetches current labels and PUTs updated list', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ fields: { labels: ['existing'] } }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const board = createJiraBoard(baseEnv);
      await board.addLabel('PROJ-1', 'clancy:build');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0][0]).toContain(
        '/rest/api/3/issue/PROJ-1?fields=labels',
      );
      const putBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
      expect(putBody.fields.labels).toEqual(['existing', 'clancy:build']);
    });

    it('skips PUT when label already present', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ fields: { labels: ['clancy:build'] } }),
            { status: 200 },
          ),
        );

      const board = createJiraBoard(baseEnv);
      await board.addLabel('PROJ-1', 'clancy:build');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not throw on GET failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('', { status: 500 }),
      );

      const board = createJiraBoard(baseEnv);
      await expect(
        board.addLabel('PROJ-1', 'clancy:build'),
      ).resolves.toBeUndefined();
    });

    it('does not throw on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));

      const board = createJiraBoard(baseEnv);
      await expect(
        board.addLabel('PROJ-1', 'clancy:build'),
      ).resolves.toBeUndefined();
    });
  });

  describe('removeLabel', () => {
    it('fetches current labels and PUTs filtered list', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              fields: { labels: ['clancy:build', 'other'] },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const board = createJiraBoard(baseEnv);
      await board.removeLabel('PROJ-1', 'clancy:build');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const putBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
      expect(putBody.fields.labels).toEqual(['other']);
    });

    it('skips PUT when label not present', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ fields: { labels: ['other'] } }), {
          status: 200,
        }),
      );

      const board = createJiraBoard(baseEnv);
      await board.removeLabel('PROJ-1', 'clancy:build');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not throw on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));

      const board = createJiraBoard(baseEnv);
      await expect(
        board.removeLabel('PROJ-1', 'clancy:build'),
      ).resolves.toBeUndefined();
    });
  });

  describe('sharedEnv', () => {
    it('returns the env object', () => {
      const board = createJiraBoard(baseEnv);
      expect(board.sharedEnv()).toBe(baseEnv);
    });
  });
});
