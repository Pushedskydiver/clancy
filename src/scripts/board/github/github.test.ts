import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchBlockerStatus,
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

    it('returns total and incomplete counts from search API', async () => {
      const mockFetch = vi.fn();
      // First call: all children (total_count)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total_count: 3 }),
      });
      // Second call: open children (incomplete)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total_count: 2 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchChildrenStatus('ghp_test', 'owner/repo', 50);

      expect(result).toEqual({ total: 3, incomplete: 2 });
    });

    it('returns zero counts when no children found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ total_count: 0 }),
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

  describe('fetchChildrenStatus — dual-mode (Epic: text + native fallback)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('finds children via Epic: text search when present', async () => {
      const mockFetch = vi.fn();
      // First call: all Epic: children
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total_count: 2 }),
      });
      // Second call: open Epic: children
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total_count: 1 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchChildrenStatus('ghp_test', 'owner/repo', 50);

      expect(result).toBeDefined();
      expect(result!.total).toBe(2);
      expect(result!.incomplete).toBe(1);
    });

    it('falls back to Parent: search when Epic: returns no results', async () => {
      const mockFetch = vi.fn();
      // First call: Epic: search returns 0
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total_count: 0 }),
      });
      // Second call: Parent: all children
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total_count: 2 }),
      });
      // Third call: Parent: open children
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total_count: 1 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchChildrenStatus('ghp_test', 'owner/repo', 50);

      expect(result).toEqual({ total: 2, incomplete: 1 });
    });

    it('returns zero counts when neither method finds children', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ total_count: 0 }),
          }),
        ),
      );

      const result = await fetchChildrenStatus('ghp_test', 'owner/repo', 50);

      expect(result).toEqual({ total: 0, incomplete: 0 });
    });

    it('falls back to at least 1 child when search returns 0 but currentTicketKey is provided', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ total_count: 0 }),
          }),
        ),
      );

      const result = await fetchChildrenStatus(
        'ghp_test',
        'owner/repo',
        50,
        '#51',
      );

      expect(result).toEqual({ total: 1, incomplete: 1 });
    });

    it('does not fall back when search returns results even with currentTicketKey', async () => {
      const mockFetch = vi.fn();
      // First call: Epic: search returns 2
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total_count: 2 }),
      });
      // Second call: open Epic: children
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total_count: 1 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchChildrenStatus(
        'ghp_test',
        'owner/repo',
        50,
        '#51',
      );

      expect(result).toEqual({ total: 2, incomplete: 1 });
    });
  });

  describe('fetchBlockerStatus', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns false (unblocked) when issue body has no blockers', async () => {
      const result = await fetchBlockerStatus(
        'ghp_test',
        'owner/repo',
        42,
        'A normal issue with no blocker references.',
      );

      expect(result).toBe(false);
    });

    it('returns false when all blockers are closed', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          // Fetch blocker #10
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ state: 'closed' }),
          })
          // Fetch blocker #11
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ state: 'closed' }),
          }),
      );

      const result = await fetchBlockerStatus(
        'ghp_test',
        'owner/repo',
        42,
        'Blocked by #10\nBlocked by #11',
      );

      expect(result).toBe(false);
    });

    it('returns true when one blocker is still open', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          // Fetch blocker #10
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ state: 'closed' }),
          })
          // Fetch blocker #11
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ state: 'open' }),
          }),
      );

      const result = await fetchBlockerStatus(
        'ghp_test',
        'owner/repo',
        42,
        'Blocked by #10\nBlocked by #11',
      );

      expect(result).toBe(true);
    });

    it('returns true with mixed blockers (some open, some closed)', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ state: 'closed' }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ state: 'open' }),
          })
          // Note: implementation returns true early on first open, may not reach #12
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ state: 'closed' }),
          }),
      );

      const result = await fetchBlockerStatus(
        'ghp_test',
        'owner/repo',
        42,
        'Blocked by #10\nBlocked by #11\nBlocked by #12',
      );

      expect(result).toBe(true);
    });

    it('returns false (fail-open) on API failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      // Even with blockers in body, if API fails for all, returns false
      const result = await fetchBlockerStatus(
        'ghp_test',
        'owner/repo',
        42,
        'Blocked by #10',
      );

      // API returns !ok, so `continue` is called — no blocker found unresolved
      expect(result).toBe(false);
    });

    it('returns false (fail-open) on network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await fetchBlockerStatus(
        'ghp_test',
        'owner/repo',
        42,
        'Blocked by #10',
      );

      expect(result).toBe(false);
    });

    it('ignores self-references in blockers', async () => {
      // Blocked by #42 is self-referential (issue #42 checking itself)
      const result = await fetchBlockerStatus(
        'ghp_test',
        'owner/repo',
        42,
        'Blocked by #42',
      );

      expect(result).toBe(false);
    });
  });
});
