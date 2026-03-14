import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPullRequest, createServerPullRequest } from './bitbucket.js';

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
});
