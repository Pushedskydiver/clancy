import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GitHubEnv } from '~/schemas/env.js';
import type { FetchedTicket } from '~/scripts/once/types/types.js';

import { createGitHubBoard } from './github-board.js';

// Mock the underlying GitHub functions
vi.mock('./github.js', () => ({
  pingGitHub: vi.fn(() => Promise.resolve({ ok: true })),
  isValidRepo: vi.fn((repo: string) =>
    /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo),
  ),
  resolveUsername: vi.fn(() => Promise.resolve('testuser')),
  fetchIssues: vi.fn(() => Promise.resolve([])),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
  fetchChildrenStatus: vi.fn(() =>
    Promise.resolve({ total: 2, incomplete: 0 }),
  ),
}));

const baseEnv: GitHubEnv = {
  GITHUB_TOKEN: 'ghp_test123',
  GITHUB_REPO: 'owner/repo',
};

describe('github-board', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createGitHubBoard', () => {
    it('returns an object with all Board methods', () => {
      const board = createGitHubBoard(baseEnv);

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
    it('delegates to pingGitHub with correct params', async () => {
      const { pingGitHub } = await import('./github.js');
      const board = createGitHubBoard(baseEnv);

      await board.ping();

      expect(pingGitHub).toHaveBeenCalledWith('ghp_test123', 'owner/repo');
    });
  });

  describe('validateInputs', () => {
    it('returns undefined for valid repo', () => {
      const board = createGitHubBoard(baseEnv);
      expect(board.validateInputs()).toBeUndefined();
    });

    it('returns error for invalid repo format', async () => {
      const { isValidRepo } = await import('./github.js');
      vi.mocked(isValidRepo).mockReturnValueOnce(false);

      const board = createGitHubBoard({
        ...baseEnv,
        GITHUB_REPO: 'invalid',
      });
      expect(board.validateInputs()).toBe(
        '✗ GITHUB_REPO format is invalid — expected owner/repo',
      );
    });
  });

  describe('fetchTickets', () => {
    it('delegates to fetchGitHubIssues and normalises results', async () => {
      const { fetchIssues } = await import('./github.js');
      vi.mocked(fetchIssues).mockResolvedValueOnce([
        {
          key: '#42',
          title: 'Test issue',
          description: 'A test issue',
          provider: 'github',
          milestone: 'v1.0',
        },
      ]);

      const board = createGitHubBoard(baseEnv);
      const results = await board.fetchTickets({ excludeHitl: false });

      expect(results).toEqual([
        {
          key: '#42',
          title: 'Test issue',
          description: 'A test issue',
          parentInfo: 'v1.0',
          blockers: 'None',
        },
      ]);
    });

    it('sets parentInfo to none when no milestone', async () => {
      const { fetchIssues } = await import('./github.js');
      vi.mocked(fetchIssues).mockResolvedValueOnce([
        {
          key: '#43',
          title: 'No milestone',
          description: 'desc',
          provider: 'github',
        },
      ]);

      const board = createGitHubBoard(baseEnv);
      const results = await board.fetchTickets({ excludeHitl: false });

      expect(results[0].parentInfo).toBe('none');
    });

    it('resolves username before fetching', async () => {
      const { resolveUsername, fetchIssues } = await import('./github.js');
      vi.mocked(fetchIssues).mockResolvedValueOnce([]);

      const board = createGitHubBoard(baseEnv);
      await board.fetchTickets({ excludeHitl: true });

      expect(resolveUsername).toHaveBeenCalledWith('ghp_test123');
      expect(fetchIssues).toHaveBeenCalledWith(
        'ghp_test123',
        'owner/repo',
        undefined,
        'testuser',
        true,
      );
    });
  });

  describe('fetchTicket', () => {
    it('returns the first ticket from fetchTickets', async () => {
      const { fetchIssues } = await import('./github.js');
      vi.mocked(fetchIssues).mockResolvedValueOnce([
        {
          key: '#1',
          title: 'First',
          description: 'desc',
          provider: 'github',
        },
      ]);

      const board = createGitHubBoard(baseEnv);
      const result = await board.fetchTicket({ excludeHitl: false });

      expect(result?.key).toBe('#1');
    });

    it('returns undefined when no issues', async () => {
      const { fetchIssues } = await import('./github.js');
      vi.mocked(fetchIssues).mockResolvedValueOnce([]);

      const board = createGitHubBoard(baseEnv);
      const result = await board.fetchTicket({ excludeHitl: false });

      expect(result).toBeUndefined();
    });
  });

  describe('fetchBlockerStatus', () => {
    it('delegates to fetchGitHubBlockerStatus', async () => {
      const { fetchBlockerStatus } = await import('./github.js');
      vi.mocked(fetchBlockerStatus).mockResolvedValueOnce(true);

      const board = createGitHubBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: '#42',
        title: 'Test',
        description: 'Blocked by #10',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.fetchBlockerStatus(ticket);

      expect(fetchBlockerStatus).toHaveBeenCalledWith(
        'ghp_test123',
        'owner/repo',
        42,
        'Blocked by #10',
      );
      expect(result).toBe(true);
    });

    it('returns false for non-numeric issue key', async () => {
      const board = createGitHubBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: '#abc',
        title: 'Bad key',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.fetchBlockerStatus(ticket);
      expect(result).toBe(false);
    });
  });

  describe('fetchChildrenStatus', () => {
    it('delegates to fetchGitHubChildrenStatus', async () => {
      const { fetchChildrenStatus } = await import('./github.js');

      const board = createGitHubBoard(baseEnv);
      const result = await board.fetchChildrenStatus('#50');

      expect(fetchChildrenStatus).toHaveBeenCalledWith(
        'ghp_test123',
        'owner/repo',
        50,
      );
      expect(result).toEqual({ total: 2, incomplete: 0 });
    });

    it('returns undefined for non-numeric parent key', async () => {
      const board = createGitHubBoard(baseEnv);
      const result = await board.fetchChildrenStatus('#abc');

      expect(result).toBeUndefined();
    });
  });

  describe('transitionTicket', () => {
    it('returns false (GitHub has no status transitions)', async () => {
      const board = createGitHubBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: '#42',
        title: 'Test',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.transitionTicket(ticket, 'In Progress');
      expect(result).toBe(false);
    });
  });

  describe('ensureLabel', () => {
    it('does nothing when label already exists', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const board = createGitHubBoard(baseEnv);
      await board.ensureLabel('clancy:build');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toContain('/labels/clancy%3Abuild');
    });

    it('creates label when 404', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response('{}', { status: 201 }));

      const board = createGitHubBoard(baseEnv);
      await board.ensureLabel('clancy:build');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[1][1]?.method).toBe('POST');
    });

    it('does not throw on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));

      const board = createGitHubBoard(baseEnv);
      await expect(board.ensureLabel('clancy:build')).resolves.toBeUndefined();
    });
  });

  describe('addLabel', () => {
    it('calls ensureLabel then adds label to issue', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        // ensureLabel GET
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        // addLabel POST
        .mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const board = createGitHubBoard(baseEnv);
      await board.addLabel('#42', 'clancy:build');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[1][0]).toContain('/issues/42/labels');
      expect(fetchSpy.mock.calls[1][1]?.method).toBe('POST');
    });

    it('does not throw for non-numeric issue key', async () => {
      // ensureLabel GET
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('{}', { status: 200 }),
      );

      const board = createGitHubBoard(baseEnv);
      await expect(
        board.addLabel('#abc', 'clancy:build'),
      ).resolves.toBeUndefined();
    });

    it('does not throw on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));

      const board = createGitHubBoard(baseEnv);
      await expect(
        board.addLabel('#42', 'clancy:build'),
      ).resolves.toBeUndefined();
    });
  });

  describe('removeLabel', () => {
    it('sends DELETE request for the label', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      const board = createGitHubBoard(baseEnv);
      await board.removeLabel('#42', 'clancy:build');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toContain(
        '/issues/42/labels/clancy%3Abuild',
      );
      expect(fetchSpy.mock.calls[0][1]?.method).toBe('DELETE');
    });

    it('ignores 404 (label not on issue)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('', { status: 404 }),
      );

      const board = createGitHubBoard(baseEnv);
      await expect(
        board.removeLabel('#42', 'clancy:build'),
      ).resolves.toBeUndefined();
    });

    it('does not throw for non-numeric issue key', async () => {
      const board = createGitHubBoard(baseEnv);
      await expect(
        board.removeLabel('#abc', 'clancy:build'),
      ).resolves.toBeUndefined();
    });

    it('does not throw on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));

      const board = createGitHubBoard(baseEnv);
      await expect(
        board.removeLabel('#42', 'clancy:build'),
      ).resolves.toBeUndefined();
    });
  });

  describe('sharedEnv', () => {
    it('returns the env object', () => {
      const board = createGitHubBoard(baseEnv);
      expect(board.sharedEnv()).toBe(baseEnv);
    });
  });
});
