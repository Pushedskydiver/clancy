import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkPrReviewState,
  createPullRequest,
  fetchPrReviewComments,
} from './github.js';

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

  describe('checkPrReviewState', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('returns changesRequested: true when latest review has CHANGES_REQUESTED', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                number: 10,
                html_url: 'https://github.com/owner/repo/pull/10',
                state: 'open',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                state: 'CHANGES_REQUESTED',
                user: { login: 'reviewer1' },
                submitted_at: '2026-01-01T00:00:00Z',
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkPrReviewState(
        'ghp_test',
        'owner/repo',
        'feature/test',
        'owner',
      );

      expect(result).toEqual({
        changesRequested: true,
        prNumber: 10,
        prUrl: 'https://github.com/owner/repo/pull/10',
      });
    });

    it('returns changesRequested: false when latest review has APPROVED', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                number: 10,
                html_url: 'https://github.com/owner/repo/pull/10',
                state: 'open',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                state: 'APPROVED',
                user: { login: 'reviewer1' },
                submitted_at: '2026-01-01T00:00:00Z',
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkPrReviewState(
        'ghp_test',
        'owner/repo',
        'feature/test',
        'owner',
      );

      expect(result).toEqual({
        changesRequested: false,
        prNumber: 10,
        prUrl: 'https://github.com/owner/repo/pull/10',
      });
    });

    it('returns undefined when no open PR for branch', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkPrReviewState(
        'ghp_test',
        'owner/repo',
        'feature/no-pr',
        'owner',
      );

      expect(result).toBeUndefined();
    });

    it('deduplicates reviews — later APPROVED overrides earlier CHANGES_REQUESTED', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                number: 10,
                html_url: 'https://github.com/owner/repo/pull/10',
                state: 'open',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                state: 'CHANGES_REQUESTED',
                user: { login: 'reviewer1' },
                submitted_at: '2026-01-01T00:00:00Z',
              },
              {
                state: 'APPROVED',
                user: { login: 'reviewer1' },
                submitted_at: '2026-01-02T00:00:00Z',
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkPrReviewState(
        'ghp_test',
        'owner/repo',
        'feature/test',
        'owner',
      );

      expect(result).toEqual({
        changesRequested: false,
        prNumber: 10,
        prUrl: 'https://github.com/owner/repo/pull/10',
      });
    });

    it('returns undefined on API error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Network error'))),
      );

      const result = await checkPrReviewState(
        'ghp_test',
        'owner/repo',
        'feature/test',
        'owner',
      );

      expect(result).toBeUndefined();
    });
  });

  describe('fetchPrReviewComments', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('returns combined inline + conversation comments', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { body: 'Fix this line', path: 'src/index.ts' },
              { body: 'Also here', path: 'src/utils.ts' },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                body: 'Overall looks good',
                created_at: '2026-01-01T00:00:00Z',
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchPrReviewComments('ghp_test', 'owner/repo', 10);

      expect(result).toEqual([
        '[src/index.ts] Fix this line',
        '[src/utils.ts] Also here',
        'Overall looks good',
      ]);
    });

    it('formats inline comments with file path prefix', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([{ body: 'Needs refactor', path: 'lib/core.ts' }]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchPrReviewComments('ghp_test', 'owner/repo', 5);

      expect(result).toEqual(['[lib/core.ts] Needs refactor']);
    });

    it('returns empty array on error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Network error'))),
      );

      const result = await fetchPrReviewComments('ghp_test', 'owner/repo', 10);

      expect(result).toEqual([]);
    });
  });
});
