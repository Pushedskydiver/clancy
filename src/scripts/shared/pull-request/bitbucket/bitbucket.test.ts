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
    it('returns changesRequested: true when participant has changes_requested state', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
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
                    participants: [
                      { state: 'approved', role: 'REVIEWER' },
                      { state: 'changes_requested', role: 'REVIEWER' },
                    ],
                  },
                ],
              }),
          }),
        ),
      );

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

    it('returns changesRequested: false when all participants approved', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
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
          }),
        ),
      );

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
    it('returns comment bodies', async () => {
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
                  {
                    content: { raw: 'Fix this' },
                    created_on: '2026-01-02T00:00:00Z',
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

      expect(result).toEqual(['Looks good', 'Fix this']);
    });

    it('prefixes inline comments with path', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                values: [
                  {
                    content: { raw: 'Rename this' },
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

      expect(result).toEqual(['[src/index.ts] Rename this']);
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
    it('returns changesRequested: true when reviewer has NEEDS_WORK status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
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
                    reviewers: [
                      { status: 'APPROVED' },
                      { status: 'NEEDS_WORK' },
                    ],
                  },
                ],
              }),
          }),
        ),
      );

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
    it('returns comment text', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                values: [
                  { text: 'Please fix', createdDate: 1700000000000 },
                  {
                    text: 'Update this line',
                    anchor: { path: 'src/app.ts' },
                    createdDate: 1700000001000,
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

      expect(result).toEqual(['Please fix', '[src/app.ts] Update this line']);
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
