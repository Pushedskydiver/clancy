import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkMrReviewState,
  createMergeRequest,
  fetchMrReviewComments,
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

  describe('checkMrReviewState', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('returns changesRequested: true when detailed_merge_status is requested_changes', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  iid: 42,
                  web_url: 'https://gitlab.com/g/p/-/merge_requests/42',
                  detailed_merge_status: 'requested_changes',
                },
              ]),
          }),
        ),
      );

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

    it('returns changesRequested: true when detailed_merge_status is discussions_not_resolved', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  iid: 10,
                  web_url: 'https://gitlab.com/g/p/-/merge_requests/10',
                  detailed_merge_status: 'discussions_not_resolved',
                },
              ]),
          }),
        ),
      );

      const result = await checkMrReviewState(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        'feature/branch',
      );

      expect(result).toEqual({
        changesRequested: true,
        prNumber: 10,
        prUrl: 'https://gitlab.com/g/p/-/merge_requests/10',
      });
    });

    it('returns changesRequested: false when detailed_merge_status is mergeable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  iid: 5,
                  web_url: 'https://gitlab.com/g/p/-/merge_requests/5',
                  detailed_merge_status: 'mergeable',
                },
              ]),
          }),
        ),
      );

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
  });

  describe('fetchMrReviewComments', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('returns unresolved discussion note bodies', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  notes: [
                    {
                      body: 'Please fix this',
                      resolvable: true,
                      resolved: false,
                      system: false,
                    },
                  ],
                },
                {
                  notes: [
                    {
                      body: 'Also this',
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

      const comments = await fetchMrReviewComments(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
      );

      expect(comments).toEqual(['Please fix this', 'Also this']);
    });

    it('prefixes notes with file path when available', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  notes: [
                    {
                      body: 'Needs refactor',
                      resolvable: true,
                      resolved: false,
                      system: false,
                      position: { new_path: 'src/main.ts' },
                    },
                  ],
                },
              ]),
          }),
        ),
      );

      const comments = await fetchMrReviewComments(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
      );

      expect(comments).toEqual(['[src/main.ts] Needs refactor']);
    });

    it('filters out system notes and resolved discussions', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  notes: [
                    {
                      body: 'System note',
                      resolvable: true,
                      resolved: false,
                      system: true,
                    },
                  ],
                },
                {
                  notes: [
                    {
                      body: 'Resolved comment',
                      resolvable: true,
                      resolved: true,
                      system: false,
                    },
                  ],
                },
                {
                  notes: [
                    {
                      body: 'Non-resolvable',
                      resolvable: false,
                      resolved: false,
                      system: false,
                    },
                  ],
                },
                {
                  notes: [
                    {
                      body: 'Valid comment',
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

      const comments = await fetchMrReviewComments(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
      );

      expect(comments).toEqual(['Valid comment']);
    });

    it('returns empty array on error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Network failure'))),
      );

      const comments = await fetchMrReviewComments(
        'token',
        'https://gitlab.com/api/v4',
        'g/p',
        42,
      );

      expect(comments).toEqual([]);
    });
  });
});
