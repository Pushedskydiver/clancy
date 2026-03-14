import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkPrReviewState,
  checkServerPrReviewState,
  createPullRequest,
  createServerPullRequest,
  fetchPrReviewComments,
  fetchServerPrReviewComments,
} from './bitbucket.js';

describe('bitbucket', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('createPullRequest (Cloud)', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 7,
                links: {
                  html: {
                    href: 'https://bitbucket.org/workspace/repo/pull-requests/7',
                  },
                },
              }),
          }),
        ),
      );
    });

    it('creates a PR successfully', async () => {
      const result = await createPullRequest(
        'user',
        'token',
        'workspace',
        'repo',
        'feature/test',
        'main',
        'feat: test',
        'Description',
      );

      expect(result).toEqual({
        ok: true,
        url: 'https://bitbucket.org/workspace/repo/pull-requests/7',
        number: 7,
      });
    });

    it('uses Basic Auth header', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 1, links: { html: { href: '' } } }),
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      await createPullRequest(
        'myuser',
        'mytoken',
        'ws',
        'repo',
        'branch',
        'main',
        'title',
        'body',
      );

      const fetchCall = mockFetch.mock.calls[0];
      const headers = (fetchCall[1] as RequestInit).headers as Record<
        string,
        string
      >;
      const expected = `Basic ${Buffer.from('myuser:mytoken').toString('base64')}`;
      expect(headers.Authorization).toBe(expected);
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

      const result = await createPullRequest(
        'user',
        'bad',
        'ws',
        'repo',
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
        vi.fn(() => Promise.reject(new Error('Connection refused'))),
      );

      const result = await createPullRequest(
        'user',
        'token',
        'ws',
        'repo',
        'branch',
        'main',
        'title',
        'body',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Connection refused');
      }
    });
  });

  describe('createServerPullRequest (Server/DC)', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 42,
                links: {
                  self: [
                    {
                      href: 'https://bitbucket.acme.com/projects/PROJ/repos/repo/pull-requests/42',
                    },
                  ],
                },
              }),
          }),
        ),
      );
    });

    it('creates a PR on Bitbucket Server', async () => {
      const result = await createServerPullRequest(
        'token',
        'https://bitbucket.acme.com/rest/api/1.0',
        'PROJ',
        'repo',
        'feature/test',
        'main',
        'feat: test',
        'Description',
      );

      expect(result).toEqual({
        ok: true,
        url: 'https://bitbucket.acme.com/projects/PROJ/repos/repo/pull-requests/42',
        number: 42,
      });
    });

    it('uses Bearer auth and fromRef/toRef format', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ id: 1, links: { self: [{ href: '' }] } }),
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      await createServerPullRequest(
        'my-token',
        'https://bb.acme.com/rest/api/1.0',
        'PROJ',
        'repo',
        'feature/x',
        'develop',
        'title',
        'body',
      );

      const fetchCall = mockFetch.mock.calls[0];
      const headers = (fetchCall[1] as RequestInit).headers as Record<
        string,
        string
      >;
      expect(headers.Authorization).toBe('Bearer my-token');

      const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
      expect(body.fromRef.id).toBe('refs/heads/feature/x');
      expect(body.toRef.id).toBe('refs/heads/develop');
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

      const result = await createServerPullRequest(
        'bad',
        'https://bb.acme.com/rest/api/1.0',
        'PROJ',
        'repo',
        'branch',
        'main',
        'title',
        'body',
      );

      expect(result.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Cloud — review state & comments
  // -------------------------------------------------------------------------

  describe('checkPrReviewState (Cloud)', () => {
    it('returns changesRequested: true when inline comments exist (no Rework: prefix needed)', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  id: 10,
                  links: {
                    html: {
                      href: 'https://bitbucket.org/ws/repo/pull-requests/10',
                    },
                  },
                  participants: [{ state: 'approved', role: 'REVIEWER' }],
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  content: { raw: 'This needs fixing' },
                  inline: { path: 'src/index.ts' },
                  created_on: '2026-01-01T00:00:00Z',
                },
              ],
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkPrReviewState(
        'user',
        'token',
        'ws',
        'repo',
        'feature/test',
      );

      expect(result).toEqual({
        changesRequested: true,
        prNumber: 10,
        prUrl: 'https://bitbucket.org/ws/repo/pull-requests/10',
      });
    });

    it('returns changesRequested: true when a Rework: conversation comment exists', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  id: 10,
                  links: {
                    html: {
                      href: 'https://bitbucket.org/ws/repo/pull-requests/10',
                    },
                  },
                  participants: [{ state: 'approved', role: 'REVIEWER' }],
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  content: { raw: 'Rework: Fix the validation' },
                  created_on: '2026-01-01T00:00:00Z',
                },
              ],
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkPrReviewState(
        'user',
        'token',
        'ws',
        'repo',
        'feature/test',
      );

      expect(result).toEqual({
        changesRequested: true,
        prNumber: 10,
        prUrl: 'https://bitbucket.org/ws/repo/pull-requests/10',
      });
    });

    it('returns changesRequested: false when only non-Rework: conversation comments exist', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  id: 11,
                  links: {
                    html: {
                      href: 'https://bitbucket.org/ws/repo/pull-requests/11',
                    },
                  },
                  participants: [{ state: 'approved', role: 'REVIEWER' }],
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  content: { raw: 'Nice work!' },
                  created_on: '2026-01-01T00:00:00Z',
                },
              ],
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkPrReviewState(
        'user',
        'token',
        'ws',
        'repo',
        'feature/ok',
      );

      expect(result).toEqual({
        changesRequested: false,
        prNumber: 11,
        prUrl: 'https://bitbucket.org/ws/repo/pull-requests/11',
      });
    });

    it('returns undefined when no open PR exists', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ values: [] }),
          }),
        ),
      );

      const result = await checkPrReviewState(
        'user',
        'token',
        'ws',
        'repo',
        'feature/none',
      );

      expect(result).toBeUndefined();
    });
  });

  describe('fetchPrReviewComments (Cloud)', () => {
    it('returns all inline comments and only Rework: conversation comments', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                values: [
                  {
                    content: { raw: 'This needs fixing' },
                    inline: { path: 'src/index.ts' },
                    created_on: '2026-01-01T00:00:00Z',
                  },
                  {
                    content: { raw: 'Rework: Fix the validation' },
                    created_on: '2026-01-02T00:00:00Z',
                  },
                  {
                    content: { raw: 'Looks good' },
                    created_on: '2026-01-03T00:00:00Z',
                  },
                ],
              }),
          }),
        ),
      );

      const result = await fetchPrReviewComments(
        'user',
        'token',
        'ws',
        'repo',
        10,
      );

      expect(result).toEqual([
        '[src/index.ts] This needs fixing',
        'Fix the validation',
      ]);
    });

    it('includes inline comments without Rework: prefix', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                values: [
                  {
                    content: { raw: 'Rename this variable' },
                    inline: { path: 'src/index.ts' },
                    created_on: '2026-01-01T00:00:00Z',
                  },
                ],
              }),
          }),
        ),
      );

      const result = await fetchPrReviewComments(
        'user',
        'token',
        'ws',
        'repo',
        10,
      );

      expect(result).toEqual(['[src/index.ts] Rename this variable']);
    });

    it('excludes non-Rework: conversation comments', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                values: [
                  {
                    content: { raw: 'Looks good' },
                    created_on: '2026-01-01T00:00:00Z',
                  },
                ],
              }),
          }),
        ),
      );

      const result = await fetchPrReviewComments(
        'user',
        'token',
        'ws',
        'repo',
        10,
      );

      expect(result).toEqual([]);
    });

    it('returns empty array on error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Network error'))),
      );

      const result = await fetchPrReviewComments(
        'user',
        'token',
        'ws',
        'repo',
        10,
      );

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Server/DC — review state & comments
  // -------------------------------------------------------------------------

  describe('checkServerPrReviewState', () => {
    it('returns changesRequested: true when inline comments exist (no Rework: prefix needed)', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  id: 20,
                  links: {
                    self: [
                      {
                        href: 'https://bb.acme.com/projects/PROJ/repos/repo/pull-requests/20',
                      },
                    ],
                  },
                  reviewers: [{ status: 'APPROVED' }],
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  action: 'COMMENTED',
                  comment: {
                    text: 'This needs fixing',
                    anchor: { path: 'src/app.ts' },
                    createdDate: 1700000000000,
                  },
                },
              ],
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkServerPrReviewState(
        'token',
        'https://bb.acme.com/rest/api/1.0',
        'PROJ',
        'repo',
        'feature/test',
      );

      expect(result).toEqual({
        changesRequested: true,
        prNumber: 20,
        prUrl: 'https://bb.acme.com/projects/PROJ/repos/repo/pull-requests/20',
      });
    });

    it('returns changesRequested: true when a Rework: conversation comment exists', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  id: 20,
                  links: {
                    self: [
                      {
                        href: 'https://bb.acme.com/projects/PROJ/repos/repo/pull-requests/20',
                      },
                    ],
                  },
                  reviewers: [{ status: 'APPROVED' }],
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  action: 'COMMENTED',
                  comment: {
                    text: 'Rework: Fix the error handling',
                    createdDate: 1700000000000,
                  },
                },
              ],
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkServerPrReviewState(
        'token',
        'https://bb.acme.com/rest/api/1.0',
        'PROJ',
        'repo',
        'feature/test',
      );

      expect(result).toEqual({
        changesRequested: true,
        prNumber: 20,
        prUrl: 'https://bb.acme.com/projects/PROJ/repos/repo/pull-requests/20',
      });
    });

    it('returns changesRequested: false when only non-Rework: conversation comments exist', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  id: 20,
                  links: {
                    self: [
                      {
                        href: 'https://bb.acme.com/projects/PROJ/repos/repo/pull-requests/20',
                      },
                    ],
                  },
                  reviewers: [{ status: 'APPROVED' }],
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              values: [
                {
                  action: 'COMMENTED',
                  comment: {
                    text: 'Nice job',
                    createdDate: 1700000000000,
                  },
                },
              ],
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await checkServerPrReviewState(
        'token',
        'https://bb.acme.com/rest/api/1.0',
        'PROJ',
        'repo',
        'feature/ok',
      );

      expect(result).toEqual({
        changesRequested: false,
        prNumber: 20,
        prUrl: 'https://bb.acme.com/projects/PROJ/repos/repo/pull-requests/20',
      });
    });

    it('returns undefined when no open PR exists', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ values: [] }),
          }),
        ),
      );

      const result = await checkServerPrReviewState(
        'token',
        'https://bb.acme.com/rest/api/1.0',
        'PROJ',
        'repo',
        'feature/none',
      );

      expect(result).toBeUndefined();
    });
  });

  describe('fetchServerPrReviewComments', () => {
    it('returns all inline comments and only Rework: conversation comments', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                values: [
                  {
                    action: 'COMMENTED',
                    comment: {
                      text: 'This needs fixing',
                      anchor: { path: 'src/app.ts' },
                      createdDate: 1700000000000,
                    },
                  },
                  {
                    action: 'COMMENTED',
                    comment: {
                      text: 'Rework: Please fix',
                      createdDate: 1700000001000,
                    },
                  },
                  {
                    action: 'COMMENTED',
                    comment: {
                      text: 'Looks good',
                      createdDate: 1700000002000,
                    },
                  },
                  {
                    action: 'APPROVED',
                  },
                ],
              }),
          }),
        ),
      );

      const result = await fetchServerPrReviewComments(
        'token',
        'https://bb.acme.com/rest/api/1.0',
        'PROJ',
        'repo',
        20,
      );

      expect(result).toEqual(['[src/app.ts] This needs fixing', 'Please fix']);
    });

    it('includes inline comments without Rework: prefix', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                values: [
                  {
                    action: 'COMMENTED',
                    comment: {
                      text: 'Update this line',
                      anchor: { path: 'src/app.ts' },
                      createdDate: 1700000000000,
                    },
                  },
                ],
              }),
          }),
        ),
      );

      const result = await fetchServerPrReviewComments(
        'token',
        'https://bb.acme.com/rest/api/1.0',
        'PROJ',
        'repo',
        20,
      );

      expect(result).toEqual(['[src/app.ts] Update this line']);
    });

    it('excludes non-Rework: conversation comments', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                values: [
                  {
                    action: 'COMMENTED',
                    comment: {
                      text: 'Looks good overall',
                      createdDate: 1700000000000,
                    },
                  },
                ],
              }),
          }),
        ),
      );

      const result = await fetchServerPrReviewComments(
        'token',
        'https://bb.acme.com/rest/api/1.0',
        'PROJ',
        'repo',
        20,
      );

      expect(result).toEqual([]);
    });

    it('returns empty array on error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Timeout'))),
      );

      const result = await fetchServerPrReviewComments(
        'token',
        'https://bb.acme.com/rest/api/1.0',
        'PROJ',
        'repo',
        20,
      );

      expect(result).toEqual([]);
    });
  });
});
