import { afterEach, describe, expect, it, vi } from 'vitest';

import { basicAuth, postPullRequest } from './post-pr.js';

describe('post-pr', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('postPullRequest', () => {
    it('returns success when response is ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ url: 'https://example.com/pr/1' }),
          }),
        ),
      );

      const result = await postPullRequest(
        'https://api.example.com/pulls',
        { Authorization: 'Bearer token' },
        { title: 'test', head: 'feat', base: 'main' },
        (json) => {
          const data = json as { url?: string };
          return { url: data.url ?? '', number: 1 };
        },
      );

      expect(result).toEqual({
        ok: true,
        url: 'https://example.com/pr/1',
        number: 1,
      });
    });

    it('returns error with status text on failure', async () => {
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

      const result = await postPullRequest(
        'https://api.example.com/pulls',
        {},
        {},
        () => ({ url: '', number: 0 }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('401');
        expect(result.error).toContain('Bad credentials');
      }
    });

    it('detects already-exists via custom check', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 422,
            text: () => Promise.resolve('A pull request already exists'),
          }),
        ),
      );

      const result = await postPullRequest(
        'https://api.example.com/pulls',
        {},
        {},
        () => ({ url: '', number: 0 }),
        (status, text) => status === 422 && text.includes('already exists'),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.alreadyExists).toBe(true);
      }
    });

    it('returns error on network failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Connection refused'))),
      );

      const result = await postPullRequest(
        'https://api.example.com/pulls',
        {},
        {},
        () => ({ url: '', number: 0 }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Connection refused');
      }
    });

    it('truncates long error text to 200 chars', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve('x'.repeat(300)),
          }),
        ),
      );

      const result = await postPullRequest(
        'https://api.example.com/pulls',
        {},
        {},
        () => ({ url: '', number: 0 }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // "HTTP 500: " + 200 chars
        expect(result.error.length).toBeLessThanOrEqual(210);
      }
    });

    it('sends correct headers and body', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      await postPullRequest(
        'https://api.example.com/pulls',
        { Authorization: 'Bearer tok' },
        { title: 'PR title' },
        () => ({ url: '', number: 0 }),
      );

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/pulls', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer tok',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'PR title' }),
      });
    });
  });

  describe('basicAuth', () => {
    it('encodes username:token as base64', () => {
      const result = basicAuth('user', 'pass');
      const expected = `Basic ${Buffer.from('user:pass').toString('base64')}`;
      expect(result).toBe(expected);
    });
  });
});
