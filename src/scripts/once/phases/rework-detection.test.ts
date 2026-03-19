import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createContext } from '../context/context.js';
import { fetchReworkFromPrReview } from '../rework/rework.js';
import { reworkDetection } from './rework-detection.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../rework/rework.js', () => ({
  fetchReworkFromPrReview: vi.fn(() => Promise.resolve(undefined)),
}));

const mockFetchRework = vi.mocked(fetchReworkFromPrReview);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('reworkDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always returns true', async () => {
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await reworkDetection(ctx);
    log.mockRestore();

    expect(result).toBe(true);
  });

  it('sets rework fields when PR rework is detected', async () => {
    mockFetchRework.mockResolvedValue({
      ticket: {
        key: 'PROJ-1',
        title: 'Fix bug',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
      },
      feedback: ['Fix the tests'],
      prNumber: 42,
      discussionIds: ['d1'],
      reviewers: ['alice'],
    });

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await reworkDetection(ctx);
    log.mockRestore();

    expect(ctx.isRework).toBe(true);
    expect(ctx.ticket?.key).toBe('PROJ-1');
    expect(ctx.prFeedback).toEqual(['Fix the tests']);
    expect(ctx.reworkPrNumber).toBe(42);
    expect(ctx.reworkDiscussionIds).toEqual(['d1']);
    expect(ctx.reworkReviewers).toEqual(['alice']);
  });

  it('leaves ctx unchanged when no rework found', async () => {
    mockFetchRework.mockResolvedValue(undefined);

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await reworkDetection(ctx);
    log.mockRestore();

    expect(ctx.isRework).toBeUndefined();
    expect(ctx.ticket).toBeUndefined();
  });

  it('continues when fetchReworkFromPrReview throws', async () => {
    mockFetchRework.mockRejectedValue(new Error('API error'));

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await reworkDetection(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(ctx.isRework).toBeUndefined();
  });
});
