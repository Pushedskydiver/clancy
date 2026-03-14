import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMergeRequest } from './gitlab.js';

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

      const fetchCall = mockFetch.mock.calls[0];
      const headers = (fetchCall[1] as RequestInit).headers as Record<
        string,
        string
      >;
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
});
