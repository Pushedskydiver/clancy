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

  describe('sharedEnv', () => {
    it('returns the env object', () => {
      const board = createGitHubBoard(baseEnv);
      expect(board.sharedEnv()).toBe(baseEnv);
    });
  });
});
