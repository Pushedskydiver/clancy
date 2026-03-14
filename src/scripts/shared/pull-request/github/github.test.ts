import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPullRequest } from './github.js';

describe('pull-request/github', () => {
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
