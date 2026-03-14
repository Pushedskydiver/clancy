import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchComments,
  isValidRepo,
  resetUsernameCache,
  resolveUsername,
} from './github.js';

describe('github', () => {
  describe('isValidRepo', () => {
    it('accepts valid owner/repo format', () => {
      expect(isValidRepo('Pushedskydiver/clancy')).toBe(true);
    });

    it('accepts repos with dots and hyphens', () => {
      expect(isValidRepo('my-org/my-repo.js')).toBe(true);
    });

    it('rejects repos without slash', () => {
      expect(isValidRepo('just-a-repo')).toBe(false);
    });

    it('rejects repos with spaces', () => {
      expect(isValidRepo('my org/my repo')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidRepo('')).toBe(false);
    });

    it('rejects repos with special characters', () => {
      expect(isValidRepo('owner/repo;rm -rf')).toBe(false);
    });
  });

  describe('resolveUsername', () => {
    beforeEach(() => {
      resetUsernameCache();
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ login: 'testuser' }),
          }),
        ),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('resolves username from GET /user', async () => {
      const username = await resolveUsername('ghp_test');
      expect(username).toBe('testuser');
    });

    it('falls back to @me on API failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 401,
          }),
        ),
      );

      const username = await resolveUsername('ghp_bad');
      expect(username).toBe('@me');
    });

    it('falls back to @me on network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Network error'))),
      );

      const username = await resolveUsername('ghp_bad');
      expect(username).toBe('@me');
    });

    it('caches username and only calls fetch once', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ login: 'cached-user' }),
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const first = await resolveUsername('ghp_cache');
      const second = await resolveUsername('ghp_cache');

      expect(first).toBe('cached-user');
      expect(second).toBe('cached-user');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchComments', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('returns comment bodies', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: 1,
                  body: 'First comment',
                  created_at: '2026-01-01T00:00:00Z',
                },
                {
                  id: 2,
                  body: 'Second comment',
                  created_at: '2026-01-02T00:00:00Z',
                },
              ]),
          }),
        ),
      );

      const comments = await fetchComments('ghp_test', 'owner/repo', 42);

      expect(comments).toEqual(['First comment', 'Second comment']);
    });

    it('uses since param when provided', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 3,
                body: 'Recent comment',
                created_at: '2026-03-01T00:00:00Z',
              },
            ]),
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const comments = await fetchComments(
        'ghp_test',
        'owner/repo',
        42,
        '2026-02-01T00:00:00Z',
      );

      expect(comments).toEqual(['Recent comment']);

      const calledUrl = (mockFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledUrl).toContain('since=2026-02-01T00%3A00%3A00Z');
    });

    it('returns empty array on error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Network error'))),
      );

      const comments = await fetchComments('ghp_test', 'owner/repo', 42);

      expect(comments).toEqual([]);
    });
  });
});
