import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPullRequest,
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

  describe('createPullRequest', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('creates a PR successfully', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                html_url: 'https://github.com/owner/repo/pull/42',
                number: 42,
              }),
          }),
        ),
      );

      const result = await createPullRequest(
        'ghp_test',
        'owner/repo',
        'feature/test',
        'main',
        'feat: test',
        'Description',
      );

      expect(result).toEqual({
        ok: true,
        url: 'https://github.com/owner/repo/pull/42',
        number: 42,
      });
    });

    it('returns alreadyExists on 422 duplicate', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 422,
            text: () =>
              Promise.resolve(
                'A pull request already exists for owner:feature/test',
              ),
          }),
        ),
      );

      const result = await createPullRequest(
        'ghp_test',
        'owner/repo',
        'feature/test',
        'main',
        'title',
        'body',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.alreadyExists).toBe(true);
      }
    });

    it('returns error on auth failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 401,
            text: () => Promise.resolve('Bad credentials'),
          }),
        ),
      );

      const result = await createPullRequest(
        'bad',
        'owner/repo',
        'branch',
        'main',
        'title',
        'body',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('401');
      }
    });

    it('returns error on network failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Network error'))),
      );

      const result = await createPullRequest(
        'token',
        'owner/repo',
        'branch',
        'main',
        'title',
        'body',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Network error');
      }
    });

    it('uses custom API base URL', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ html_url: '', number: 1 }),
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      await createPullRequest(
        'token',
        'owner/repo',
        'branch',
        'main',
        'title',
        'body',
        'https://github.acme.com/api/v3',
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://github.acme.com/api/v3/repos/owner/repo/pulls',
        expect.any(Object),
      );
    });
  });
});
