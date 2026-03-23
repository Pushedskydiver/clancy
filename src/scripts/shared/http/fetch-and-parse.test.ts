import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/mini';

import { fetchAndParse } from './fetch-and-parse.js';

const testSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const label = 'Test API';

describe('fetchAndParse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed data on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 1, name: 'Alice' }), { status: 200 }),
    );

    const result = await fetchAndParse(
      'https://api.example.com/users/1',
      undefined,
      { schema: testSchema, label },
    );

    expect(result).toEqual({ id: 1, name: 'Alice' });
  });

  it('returns undefined on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchAndParse(
      'https://api.example.com/down',
      undefined,
      { schema: testSchema, label },
    );

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('request failed: ECONNREFUSED'),
    );
  });

  it('returns undefined on non-OK status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchAndParse(
      'https://api.example.com/secret',
      undefined,
      { schema: testSchema, label },
    );

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('returned HTTP 401'),
    );
  });

  it('includes response body snippet in non-OK warning', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Bad credentials', { status: 401 }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await fetchAndParse('https://api.example.com/auth', undefined, {
      schema: testSchema,
      label,
    });

    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain('returned HTTP 401');
    expect(message).toContain('Bad credentials');
  });

  it('truncates long response bodies to 200 chars', async () => {
    const longBody = 'X'.repeat(1000);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(longBody, { status: 500 }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await fetchAndParse('https://api.example.com/error', undefined, {
      schema: testSchema,
      label,
    });

    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain('returned HTTP 500');
    expect(message).not.toContain(longBody);
    expect(message.length).toBeLessThan(300);
  });

  it('omits body segment when response body is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 404 }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await fetchAndParse('https://api.example.com/empty', undefined, {
      schema: testSchema,
      label,
    });

    const message = warn.mock.calls[0][0] as string;
    expect(message).toBe(`⚠ ${label} returned HTTP 404`);
  });

  it('returns undefined on invalid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchAndParse(
      'https://api.example.com/broken',
      undefined,
      { schema: testSchema, label },
    );

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('returned invalid JSON'),
    );
  });

  it('returns undefined on schema mismatch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ wrong: 'shape' }), { status: 200 }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchAndParse(
      'https://api.example.com/mismatched',
      undefined,
      { schema: testSchema, label },
    );

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unexpected response shape'),
    );
  });

  it('passes init options to fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 1, name: 'Bob' }), { status: 200 }),
      );

    await fetchAndParse(
      'https://api.example.com/data',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test' }),
      },
      { schema: testSchema, label },
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('includes label in all error messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await fetchAndParse('https://api.example.com', undefined, {
      schema: testSchema,
      label: 'Custom Board API',
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Custom Board API'),
    );
  });

  it('handles non-Error throw from fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('string error');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchAndParse('https://api.example.com', undefined, {
      schema: testSchema,
      label,
    });

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('string error'));
  });

  it('uses custom fetcher when provided', async () => {
    const customFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 1, name: 'Custom' }), {
        status: 200,
      }),
    );

    const result = await fetchAndParse(
      'https://api.example.com/custom',
      { method: 'POST' },
      { schema: testSchema, label, fetcher: customFetcher },
    );

    expect(result).toEqual({ id: 1, name: 'Custom' });
    expect(customFetcher).toHaveBeenCalledWith(
      'https://api.example.com/custom',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not call global fetch when custom fetcher is provided', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error(
        'global fetch should not be called when custom fetcher is provided',
      );
    });
    const customFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 1, name: 'Test' }), { status: 200 }),
      );

    await fetchAndParse('https://api.example.com', undefined, {
      schema: testSchema,
      label,
      fetcher: customFetcher,
    });

    expect(globalFetch).not.toHaveBeenCalled();
    expect(customFetcher).toHaveBeenCalled();
  });

  it('handles custom fetcher errors the same as global fetch', async () => {
    const customFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('rate limited'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchAndParse('https://api.example.com', undefined, {
      schema: testSchema,
      label,
      fetcher: customFetcher,
    });

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
  });
});
