import { afterEach, describe, expect, it, vi } from 'vitest';

import { githubHeaders, jiraHeaders, pingEndpoint } from './http.js';

describe('http helpers', () => {
  describe('githubHeaders', () => {
    it('includes Bearer authorization', () => {
      const headers = githubHeaders('tok_123');
      expect(headers.Authorization).toBe('Bearer tok_123');
    });

    it('includes GitHub accept header', () => {
      const headers = githubHeaders('tok_123');
      expect(headers.Accept).toBe('application/vnd.github+json');
    });

    it('includes API version header', () => {
      const headers = githubHeaders('tok_123');
      expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    });
  });

  describe('jiraHeaders', () => {
    it('includes Basic authorization', () => {
      const headers = jiraHeaders('base64string');
      expect(headers.Authorization).toBe('Basic base64string');
    });

    it('includes JSON accept header', () => {
      const headers = jiraHeaders('base64string');
      expect(headers.Accept).toBe('application/json');
    });
  });

  describe('pingEndpoint', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns ok true on successful response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      const result = await pingEndpoint(
        'https://api.example.com',
        { Authorization: 'Bearer tok' },
        { 401: '✗ Auth failed' },
        '✗ Network error',
      );

      expect(result).toEqual({ ok: true });
    });

    it('returns mapped error message for known status codes', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 401 }),
      );

      const result = await pingEndpoint(
        'https://api.example.com',
        { Authorization: 'Bearer tok' },
        { 401: '✗ Auth failed', 404: '✗ Not found' },
        '✗ Network error',
      );

      expect(result).toEqual({ ok: false, error: '✗ Auth failed' });
    });

    it('returns generic HTTP status for unmapped status codes', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      const result = await pingEndpoint(
        'https://api.example.com',
        {},
        { 401: '✗ Auth failed' },
        '✗ Network error',
      );

      expect(result).toEqual({ ok: false, error: '✗ HTTP 500' });
    });

    it('returns network error message when fetch throws', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await pingEndpoint(
        'https://api.example.com',
        {},
        {},
        '✗ Could not reach API',
      );

      expect(result).toEqual({ ok: false, error: '✗ Could not reach API' });
    });

    it('passes an AbortController signal to fetch', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      await pingEndpoint(
        'https://api.example.com',
        { Authorization: 'Bearer tok' },
        {},
        '✗ Network error',
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });
});
