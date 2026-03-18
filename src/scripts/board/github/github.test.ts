import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchChildrenStatus,
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

  describe('fetchChildrenStatus', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns total and incomplete counts from issues', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                { body: 'Parent: #50', state: 'open' },
                { body: 'Parent: #50', state: 'closed' },
                { body: 'Parent: #50', state: 'open' },
                { body: 'Unrelated issue', state: 'open' },
                { body: 'Parent: #50', pull_request: {}, state: 'open' },
              ]),
          }),
        ),
      );

      const result = await fetchChildrenStatus('ghp_test', 'owner/repo', 50);

      expect(result).toEqual({ total: 3, incomplete: 2 });
    });

    it('returns zero counts when no children found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          }),
        ),
      );

      const result = await fetchChildrenStatus('ghp_test', 'owner/repo', 50);

      expect(result).toEqual({ total: 0, incomplete: 0 });
    });

    it('returns undefined on API failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve({ ok: false, status: 500 })),
      );

      const result = await fetchChildrenStatus('ghp_test', 'owner/repo', 50);

      expect(result).toBeUndefined();
    });
  });
});
