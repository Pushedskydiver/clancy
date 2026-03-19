import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transitionToStatus } from '../board-ops/board-ops.js';
import { createContext } from '../context/context.js';
import { transition } from './transition.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../board-ops/board-ops.js', () => ({
  transitionToStatus: vi.fn(() => Promise.resolve()),
}));

const mockTransition = vi.mocked(transitionToStatus);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls transitionToStatus when CLANCY_STATUS_IN_PROGRESS is set', async () => {
    const ctx = createContext([]);
    ctx.config = {
      provider: 'jira',
      env: { CLANCY_STATUS_IN_PROGRESS: 'In Progress' },
    } as never;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'T',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const result = await transition(ctx);

    expect(result).toBe(true);
    expect(mockTransition).toHaveBeenCalledWith(
      ctx.config,
      ctx.ticket,
      'In Progress',
    );
  });

  it('skips transition when CLANCY_STATUS_IN_PROGRESS is not set', async () => {
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-2',
      title: 'T2',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const result = await transition(ctx);

    expect(result).toBe(true);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('always returns true (best-effort)', async () => {
    const ctx = createContext([]);
    ctx.config = {
      provider: 'jira',
      env: { CLANCY_STATUS_IN_PROGRESS: 'In Progress' },
    } as never;
    ctx.ticket = {
      key: 'PROJ-3',
      title: 'T3',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const result = await transition(ctx);

    expect(result).toBe(true);
  });
});
