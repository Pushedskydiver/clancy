import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { retryFetch } from './retry.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal Response-like object for mocking. */
function mockResponse(
  status: number,
  headers?: Record<string, string>,
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
  } as Response;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Advance all pending timers so setTimeout resolves. */
async function flushTimers() {
  await vi.advanceTimersByTimeAsync(100_000);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('retryFetch', () => {
  it('returns successful response immediately (no retry)', async () => {
    const res = mockResponse(200);
    vi.mocked(fetch).mockResolvedValueOnce(res);

    const result = await retryFetch('https://api.test.com/data');

    expect(result).toBe(res);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 with Retry-After header (seconds)', async () => {
    const rateLimited = mockResponse(429, { 'Retry-After': '2' });
    const success = mockResponse(200);

    vi.mocked(fetch)
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(success);

    const promise = retryFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      baseDelayMs: 100,
    });

    // Flush the Retry-After delay
    await flushTimers();
    const result = await promise;

    expect(result).toBe(success);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 with exponential backoff', async () => {
    const err500 = mockResponse(500);
    const success = mockResponse(200);

    vi.mocked(fetch)
      .mockResolvedValueOnce(err500)
      .mockResolvedValueOnce(success);

    const promise = retryFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 5000,
    });

    await flushTimers();
    const result = await promise;

    expect(result).toBe(success);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns last response when max retries exhausted', async () => {
    const err500 = mockResponse(502);

    vi.mocked(fetch).mockResolvedValue(err500);

    const promise = retryFetch('https://api.test.com/data', undefined, {
      maxRetries: 2,
      baseDelayMs: 10,
      maxDelayMs: 100,
    });

    await flushTimers();
    const result = await promise;

    expect(result).toBe(err500);
    // Initial + 2 retries = 3 calls
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries on network error and succeeds', async () => {
    const success = mockResponse(200);

    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(success);

    const promise = retryFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      baseDelayMs: 10,
    });

    await flushTimers();
    const result = await promise;

    expect(result).toBe(success);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws last error when network error exhausts retries', async () => {
    const networkErr = new TypeError('fetch failed');

    vi.mocked(fetch).mockRejectedValue(networkErr);

    const promise = retryFetch('https://api.test.com/data', undefined, {
      maxRetries: 1,
      baseDelayMs: 10,
    });

    // Attach rejection handler before flushing to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow('fetch failed');

    await flushTimers();
    await assertion;

    // Initial + 1 retry = 2 calls
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 400', async () => {
    const res = mockResponse(400);
    vi.mocked(fetch).mockResolvedValueOnce(res);

    const result = await retryFetch('https://api.test.com/data');

    expect(result).toBe(res);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401', async () => {
    const res = mockResponse(401);
    vi.mocked(fetch).mockResolvedValueOnce(res);

    const result = await retryFetch('https://api.test.com/data');

    expect(result).toBe(res);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 403', async () => {
    const res = mockResponse(403);
    vi.mocked(fetch).mockResolvedValueOnce(res);

    const result = await retryFetch('https://api.test.com/data');

    expect(result).toBe(res);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('respects custom maxRetries option', async () => {
    const err500 = mockResponse(500);

    vi.mocked(fetch).mockResolvedValue(err500);

    const promise = retryFetch('https://api.test.com/data', undefined, {
      maxRetries: 1,
      baseDelayMs: 10,
    });

    await flushTimers();
    const result = await promise;

    expect(result).toBe(err500);
    // Initial + 1 retry = 2 calls
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('respects custom baseDelayMs and maxDelayMs options', async () => {
    const err500 = mockResponse(503);
    const success = mockResponse(200);

    vi.mocked(fetch)
      .mockResolvedValueOnce(err500)
      .mockResolvedValueOnce(success);

    const promise = retryFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      baseDelayMs: 50,
      maxDelayMs: 200,
    });

    await flushTimers();
    const result = await promise;

    expect(result).toBe(success);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('passes RequestInit through to fetch', async () => {
    const res = mockResponse(200);
    vi.mocked(fetch).mockResolvedValueOnce(res);

    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"key":"value"}',
    };

    await retryFetch('https://api.test.com/data', init);

    expect(fetch).toHaveBeenCalledWith('https://api.test.com/data', init);
  });

  it('uses default options when none provided', async () => {
    const err500 = mockResponse(500);

    vi.mocked(fetch).mockResolvedValue(err500);

    const promise = retryFetch('https://api.test.com/data');

    await flushTimers();
    const result = await promise;

    expect(result).toBe(err500);
    // Default maxRetries=3 → 4 calls total
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('handles 429 with Retry-After as HTTP-date', async () => {
    const futureDate = new Date(Date.now() + 3000).toUTCString();
    const rateLimited = mockResponse(429, { 'Retry-After': futureDate });
    const success = mockResponse(200);

    vi.mocked(fetch)
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(success);

    const promise = retryFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      baseDelayMs: 100,
    });

    await flushTimers();
    const result = await promise;

    expect(result).toBe(success);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to backoff when 429 has no Retry-After header', async () => {
    const rateLimited = mockResponse(429);
    const success = mockResponse(200);

    vi.mocked(fetch)
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(success);

    const promise = retryFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      baseDelayMs: 100,
    });

    await flushTimers();
    const result = await promise;

    expect(result).toBe(success);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
