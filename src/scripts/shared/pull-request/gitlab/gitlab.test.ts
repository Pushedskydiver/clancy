import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkMrReviewState,
  createMergeRequest,
  fetchMrReviewComments,
  postMrNote,
  resolveDiscussions,
} from './gitlab.js';

describe('gitlab', () => {
  describe('createMergeRequest', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                web_url: 'https://gitlab.com/group/project/-/merge_requests/1',
                iid: 1,
              }),
          }),
        ),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('creates an MR successfully', async () => {
      const result = await createMergeRequest(
        'glpat-test',
        'https://gitlab.com/api/v4',
        'group/project',
        'feature/test',
        'main',
        'feat: test',
        'Description',
      );

      expect(result).toEqual({
        ok: true,
        url: 'https://gitlab.com/group/project/-/merge_requests/1',
        number: 1,
      });
    });

    it('URL-encodes the project path', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ web_url: '', iid: 1 }),
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      await createMergeRequest(
        'token',
        'https://gitlab.com/api/v4',
        'group/subgroup/project',
        'branch',
        'main',
        'title',
        'body',
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/group%2Fsubgroup%2Fproject/merge_requests',
        expect.any(Object),
      );
    });

    it('uses PRIVATE-TOKEN header', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ web_url: '', iid: 1 }),
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      await createMergeRequest(
        'my-token',
        'https://gitlab.com/api/v4',
        'g/p',
        'branch',
        'main',
        'title',
        'body',
      );

      const fetchCall = mockFetch.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      const headers = fetchCall[1].headers as Record<string, string>;
      expect(headers['PRIVATE-TOKEN']).toBe('my-token');
    });

    it('returns error on 409 conflict (MR already exists)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 409,
            text: () =>
              Promise.resolve('Another open merge request already exists'),
          }),
        ),
      );

      const result = await createMergeRequest(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        'branch',
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
            text: () => Promise.resolve('Unauthorized'),
          }),
        ),
      );

      const result = await createMergeRequest(
        'bad-token',
        'https://gitlab.com/api/v4',
        'g/p',
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

      const result = await createMergeRequest(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
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
  });

  describe('checkMrReviewState', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('returns changesRequested: true when an inline DiffNote exists (no Rework: prefix needed)', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                iid: 42,
                web_url: 'https://gitlab.com/g/p/-/merge_requests/42',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                notes: [
                  {
                    body: 'This needs error handling',
                    resolvable: true,
                    resolved: false,
                    system: false,
                    type: 'DiffNote',
                    position: { new_path: 'src/main.ts' },
                  },
                ],
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkMrReviewState(
        'token',
        'https://gitlab.com/api/v4',
        'group/project',
        'feature/test',
      );

      expect(result).toEqual({
        changesRequested: true,
        prNumber: 42,
        prUrl: 'https://gitlab.com/g/p/-/merge_requests/42',
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
                iid: 42,
                web_url: 'https://gitlab.com/g/p/-/merge_requests/42',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                notes: [
                  {
                    body: 'Rework: Fix the error handling',
                    resolvable: true,
                    resolved: false,
                    system: false,
                  },
                ],
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkMrReviewState(
        'token',
        'https://gitlab.com/api/v4',
        'group/project',
        'feature/test',
      );

      expect(result).toEqual({
        changesRequested: true,
        prNumber: 42,
        prUrl: 'https://gitlab.com/g/p/-/merge_requests/42',
      });
    });

    it('returns changesRequested: false when only non-Rework: conversation notes exist', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                iid: 5,
                web_url: 'https://gitlab.com/g/p/-/merge_requests/5',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                notes: [
                  {
                    body: 'Looks good to me',
                    resolvable: true,
                    resolved: false,
                    system: false,
                  },
                ],
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkMrReviewState(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        'feature/ok',
      );

      expect(result).toEqual({
        changesRequested: false,
        prNumber: 5,
        prUrl: 'https://gitlab.com/g/p/-/merge_requests/5',
      });
    });

    it('ignores system notes when checking for rework', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                iid: 5,
                web_url: 'https://gitlab.com/g/p/-/merge_requests/5',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                notes: [
                  {
                    body: 'Rework: system generated',
                    resolvable: false,
                    resolved: false,
                    system: true,
                    type: 'DiffNote',
                  },
                ],
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkMrReviewState(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        'feature/sys',
      );

      expect(result).toEqual({
        changesRequested: false,
        prNumber: 5,
        prUrl: 'https://gitlab.com/g/p/-/merge_requests/5',
      });
    });

    it('is case-insensitive for Rework: prefix on conversation notes', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                iid: 5,
                web_url: 'https://gitlab.com/g/p/-/merge_requests/5',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                notes: [
                  {
                    body: 'rework: lowercase prefix',
                    resolvable: true,
                    resolved: false,
                    system: false,
                  },
                ],
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkMrReviewState(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        'feature/case',
      );

      expect(result?.changesRequested).toBe(true);
    });

    it('returns undefined when no open MR for branch', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          }),
        ),
      );

      const result = await checkMrReviewState(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        'feature/none',
      );

      expect(result).toBeUndefined();
    });

    it('returns undefined on API error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Internal Server Error'),
          }),
        ),
      );

      const result = await checkMrReviewState(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        'feature/err',
      );

      expect(result).toBeUndefined();
    });

    it('old DiffNote before since does not trigger rework', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                iid: 42,
                web_url: 'https://gitlab.com/g/p/-/merge_requests/42',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                notes: [
                  {
                    body: 'Old inline comment',
                    resolvable: true,
                    resolved: false,
                    system: false,
                    type: 'DiffNote',
                    created_at: '2026-03-14T08:00:00Z',
                    position: { new_path: 'src/main.ts' },
                  },
                ],
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkMrReviewState(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        'feature/test',
        '2026-03-14T10:00:00Z',
      );

      expect(result?.changesRequested).toBe(false);
    });

    it('new DiffNote after since triggers rework', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                iid: 42,
                web_url: 'https://gitlab.com/g/p/-/merge_requests/42',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                notes: [
                  {
                    body: 'New inline comment',
                    resolvable: true,
                    resolved: false,
                    system: false,
                    type: 'DiffNote',
                    created_at: '2026-03-14T12:00:00Z',
                    position: { new_path: 'src/main.ts' },
                  },
                ],
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkMrReviewState(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        'feature/test',
        '2026-03-14T10:00:00Z',
      );

      expect(result?.changesRequested).toBe(true);
    });

    it('without since, all notes trigger rework (backward compat)', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                iid: 42,
                web_url: 'https://gitlab.com/g/p/-/merge_requests/42',
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                notes: [
                  {
                    body: 'Old inline comment',
                    resolvable: true,
                    resolved: false,
                    system: false,
                    type: 'DiffNote',
                    created_at: '2026-01-01T00:00:00Z',
                    position: { new_path: 'src/main.ts' },
                  },
                ],
              },
            ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkMrReviewState(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        'feature/test',
      );

      expect(result?.changesRequested).toBe(true);
    });
  });

  describe('fetchMrReviewComments', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('returns all DiffNote comments and only Rework: conversation comments with discussion IDs', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: 'disc-1',
                  notes: [
                    {
                      body: 'This needs fixing',
                      resolvable: true,
                      resolved: false,
                      system: false,
                      type: 'DiffNote',
                      position: { new_path: 'src/main.ts' },
                    },
                  ],
                },
                {
                  id: 'disc-2',
                  notes: [
                    {
                      body: 'Looks good to me',
                      resolvable: true,
                      resolved: false,
                      system: false,
                    },
                  ],
                },
                {
                  id: 'disc-3',
                  notes: [
                    {
                      body: 'Rework: Also fix the validation',
                      resolvable: true,
                      resolved: false,
                      system: false,
                    },
                  ],
                },
              ]),
          }),
        ),
      );

      const result = await fetchMrReviewComments(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
      );

      expect(result.comments).toEqual([
        '[src/main.ts] This needs fixing',
        'Also fix the validation',
      ]);
      expect(result.discussionIds).toEqual(['disc-1', 'disc-3']);
    });

    it('includes DiffNote comments with file path prefix', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: 'disc-1',
                  notes: [
                    {
                      body: 'Needs refactor',
                      resolvable: true,
                      resolved: false,
                      system: false,
                      type: 'DiffNote',
                      position: { new_path: 'src/main.ts' },
                    },
                  ],
                },
              ]),
          }),
        ),
      );

      const result = await fetchMrReviewComments(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
      );

      expect(result.comments).toEqual(['[src/main.ts] Needs refactor']);
    });

    it('filters out system notes and non-Rework: conversation comments', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: 'disc-sys',
                  notes: [
                    {
                      body: 'System DiffNote',
                      resolvable: true,
                      resolved: false,
                      system: true,
                      type: 'DiffNote',
                    },
                  ],
                },
                {
                  id: 'disc-ok',
                  notes: [
                    {
                      body: 'Regular discussion comment',
                      resolvable: true,
                      resolved: false,
                      system: false,
                    },
                  ],
                },
                {
                  id: 'disc-rework',
                  notes: [
                    {
                      body: 'Rework: Valid comment',
                      resolvable: true,
                      resolved: false,
                      system: false,
                    },
                  ],
                },
              ]),
          }),
        ),
      );

      const result = await fetchMrReviewComments(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
      );

      expect(result.comments).toEqual(['Valid comment']);
      expect(result.discussionIds).toEqual(['disc-rework']);
    });

    it('returns empty comments and discussionIds on error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Network failure'))),
      );

      const result = await fetchMrReviewComments(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
      );

      expect(result).toEqual({ comments: [], discussionIds: [] });
    });
  });

  describe('postMrNote', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('posts a note successfully and returns true', async () => {
      const mockFetch = vi.fn(() => Promise.resolve({ ok: true }));
      vi.stubGlobal('fetch', mockFetch);

      const result = await postMrNote(
        'glpat-test',
        'https://gitlab.com/api/v4',
        'group/project',
        42,
        'Rework pushed.',
      );

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/group%2Fproject/merge_requests/42/notes',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ body: 'Rework pushed.' }),
        }),
      );
    });

    it('returns false on API error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve({ ok: false, status: 403 })),
      );

      const result = await postMrNote(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
        'comment',
      );

      expect(result).toBe(false);
    });

    it('returns false on network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Network error'))),
      );

      const result = await postMrNote(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
        'comment',
      );

      expect(result).toBe(false);
    });
  });

  describe('resolveDiscussions', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('resolves all discussions and returns count', async () => {
      const mockFetch = vi.fn(() => Promise.resolve({ ok: true }));
      vi.stubGlobal('fetch', mockFetch);

      const result = await resolveDiscussions(
        'glpat-test',
        'https://gitlab.com/api/v4',
        'group/project',
        42,
        ['disc-1', 'disc-2'],
      );

      expect(result).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/group%2Fproject/merge_requests/42/discussions/disc-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ resolved: true }),
        }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/group%2Fproject/merge_requests/42/discussions/disc-2',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ resolved: true }),
        }),
      );
    });

    it('handles partial failure and returns count of successes', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      const result = await resolveDiscussions(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
        ['disc-1', 'disc-2', 'disc-3'],
      );

      expect(result).toBe(2);
    });

    it('handles network errors gracefully and continues', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      const result = await resolveDiscussions(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
        ['disc-1', 'disc-2'],
      );

      expect(result).toBe(1);
    });

    it('returns 0 for empty discussion list', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const result = await resolveDiscussions(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
        [],
      );

      expect(result).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
