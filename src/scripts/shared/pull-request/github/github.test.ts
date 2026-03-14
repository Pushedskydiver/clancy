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

    it('returns changesRequested: true when inline comments exist (no Rework: prefix needed)', async () => {
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
                body: 'This function needs error handling',
                path: 'src/index.ts',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
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

    it('returns changesRequested: true when a Rework: conversation comment exists', async () => {
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
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                body: 'Rework: Fix the validation logic',
                created_at: '2026-01-01T00:00:00Z',
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

    it('returns changesRequested: false when only non-Rework: conversation comments exist and no inline comments', async () => {
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
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                body: 'Nice work!',
                created_at: '2026-01-01T00:00:00Z',
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

    it('conversation comments without Rework: prefix do not trigger rework', async () => {
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
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                body: 'Please rework this part',
                created_at: '2026-01-01T00:00:00Z',
              },
              {
                id: 2,
                body: 'Looks good to me',
                created_at: '2026-01-02T00:00:00Z',
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

      expect(result?.changesRequested).toBe(false);
    });

    it('is case-insensitive for Rework: prefix on conversation comments', async () => {
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
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                body: 'rework: lowercase prefix',
                created_at: '2026-01-01T00:00:00Z',
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

      expect(result?.changesRequested).toBe(true);
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

    it('passes since parameter to API URLs when provided', async () => {
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
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });
      vi.stubGlobal('fetch', mockFetch);

      await checkPrReviewState(
        'ghp_test',
        'owner/repo',
        'feature/test',
        'owner',
        'https://api.github.com',
        '2026-03-14T10:00:00Z',
      );

      // Inline comments URL should include since
      expect(mockFetch.mock.calls[1]![0]).toContain(
        '&since=2026-03-14T10:00:00Z',
      );
      // Conversation comments URL should include since
      expect(mockFetch.mock.calls[2]![0]).toContain(
        '&since=2026-03-14T10:00:00Z',
      );
    });

    it('old comments before since do not trigger rework (GitHub filters server-side)', async () => {
      // When since is provided, GitHub API filters server-side.
      // Simulate: API returns no comments after since (all old).
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
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkPrReviewState(
        'ghp_test',
        'owner/repo',
        'feature/test',
        'owner',
        'https://api.github.com',
        '2026-03-14T10:00:00Z',
      );

      expect(result?.changesRequested).toBe(false);
    });

    it('new comments after since trigger rework', async () => {
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
                body: 'New inline comment',
                path: 'src/index.ts',
                created_at: '2026-03-14T12:00:00Z',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkPrReviewState(
        'ghp_test',
        'owner/repo',
        'feature/test',
        'owner',
        'https://api.github.com',
        '2026-03-14T10:00:00Z',
      );

      expect(result?.changesRequested).toBe(true);
    });

    it('without since, all comments trigger rework (backward compat)', async () => {
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
            Promise.resolve([{ body: 'Inline comment', path: 'src/index.ts' }]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkPrReviewState(
        'ghp_test',
        'owner/repo',
        'feature/test',
        'owner',
      );

      expect(result?.changesRequested).toBe(true);
      // Should NOT include since parameter
      expect(mockFetch.mock.calls[1]![0]).not.toContain('&since=');
    });
  });

  describe('fetchPrReviewComments', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('returns all inline comments and only Rework: conversation comments', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                body: 'This needs error handling',
                path: 'src/index.ts',
              },
              {
                body: 'Looks good',
                path: 'src/utils.ts',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                body: 'Rework: Overall validation is wrong',
                created_at: '2026-01-01T00:00:00Z',
              },
              {
                id: 2,
                body: 'Nice work on the tests',
                created_at: '2026-01-02T00:00:00Z',
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchPrReviewComments('ghp_test', 'owner/repo', 10);

      expect(result).toEqual([
        '[src/index.ts] This needs error handling',
        '[src/utils.ts] Looks good',
        'Overall validation is wrong',
      ]);
    });

    it('includes inline comments without Rework: prefix', async () => {
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

    it('excludes non-Rework: conversation comments', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                body: 'Please rework this part',
                created_at: '2026-01-01T00:00:00Z',
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchPrReviewComments('ghp_test', 'owner/repo', 10);

      expect(result).toEqual([]);
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
