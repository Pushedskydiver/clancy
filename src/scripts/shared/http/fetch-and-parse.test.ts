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
});
