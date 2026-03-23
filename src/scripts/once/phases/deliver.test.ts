import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appendProgress } from '~/scripts/shared/progress/progress.js';

import { createContext } from '../context/context.js';
import { deliverViaPullRequest } from '../deliver/deliver.js';
import { postReworkActions } from '../rework/rework.js';
import { deliver } from './deliver.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../deliver/deliver.js', () => ({
  deliverViaPullRequest: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../rework/rework.js', () => ({
  postReworkActions: vi.fn(() => Promise.resolve()),
}));

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  appendProgress: vi.fn(),
}));

const mockDeliver = vi.mocked(deliverViaPullRequest);
const mockPostRework = vi.mocked(postReworkActions);
const mockAppendProgress = vi.mocked(appendProgress);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('deliver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeliver.mockResolvedValue(true);
  });

  function makeCtx(overrides: Record<string, unknown> = {}) {
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'T',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };
    ctx.ticketBranch = 'feature/proj-1';
    ctx.effectiveTarget = 'main';
    ctx.hasParent = false;
    ctx.skipEpicBranch = false;
    ctx.isRework = false;
    Object.assign(ctx, overrides);
    return ctx;
  }

  it('returns true on successful fresh delivery', async () => {
    const result = await deliver(makeCtx());

    expect(result).toBe(true);
    const call = mockDeliver.mock.calls[0][0];
    expect(call.ticketBranch).toBe('feature/proj-1');
    expect(call.targetBranch).toBe('main');
    expect(call.skipLog).toBeUndefined();
    expect(call.parent).toBeUndefined();
    expect(call.singleChildParent).toBeUndefined();
  });

  it('returns false when fresh delivery fails', async () => {
    mockDeliver.mockResolvedValue(false);

    const result = await deliver(makeCtx());

    expect(result).toBe(false);
  });

  it('returns true on successful rework delivery', async () => {
    const ctx = makeCtx({
      isRework: true,
      reworkPrNumber: 42,
      prFeedback: ['fix this'],
      reworkDiscussionIds: ['d1'],
      reworkReviewers: ['alice'],
    });

    const result = await deliver(ctx);

    expect(result).toBe(true);
    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketBranch: 'feature/proj-1',
        targetBranch: 'main',
        skipLog: true,
      }),
    );
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-1',
      'T',
      'REWORK',
      42,
      undefined,
    );
    expect(mockPostRework).toHaveBeenCalled();
  });

  it('logs PUSH_FAILED when rework delivery fails', async () => {
    mockDeliver.mockResolvedValue(false);
    const ctx = makeCtx({ isRework: true });

    const result = await deliver(ctx);

    expect(result).toBe(false);
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-1',
      'T',
      'PUSH_FAILED',
      undefined,
      undefined,
    );
  });

  it('passes parentKey when hasParent and not skipEpicBranch', async () => {
    const ctx = makeCtx({ hasParent: true, skipEpicBranch: false });
    ctx.ticket!.parentInfo = 'EPIC-10';

    await deliver(ctx);

    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketBranch: 'feature/proj-1',
        targetBranch: 'main',
        parent: 'EPIC-10',
      }),
    );
  });

  it('skips postReworkActions when reworkPrNumber is null', async () => {
    const ctx = makeCtx({ isRework: true, reworkPrNumber: undefined });

    await deliver(ctx);

    expect(mockPostRework).not.toHaveBeenCalled();
  });
});
