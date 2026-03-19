import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createContext } from '../context/context.js';
import { appendCostEntry } from '../cost/cost.js';
import { readLock } from '../lock/lock.js';
import { cost } from './cost.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../cost/cost.js', () => ({
  appendCostEntry: vi.fn(),
}));

vi.mock('../lock/lock.js', () => ({
  readLock: vi.fn(),
}));

const mockAppendCost = vi.mocked(appendCostEntry);
const mockReadLock = vi.mocked(readLock);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('cost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends cost entry when lock file exists', () => {
    mockReadLock.mockReturnValue({
      pid: 1,
      ticketKey: 'PROJ-1',
      ticketTitle: 'T',
      ticketBranch: 'feature/proj-1',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'T',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const result = cost(ctx);

    expect(result).toBe(true);
    expect(mockAppendCost).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-1',
      '2026-01-01T00:00:00.000Z',
      6600,
    );
  });

  it('uses custom CLANCY_TOKEN_RATE', () => {
    mockReadLock.mockReturnValue({
      pid: 1,
      ticketKey: 'PROJ-1',
      ticketTitle: 'T',
      ticketBranch: 'feature/proj-1',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    const ctx = createContext([]);
    ctx.config = {
      provider: 'jira',
      env: { CLANCY_TOKEN_RATE: '10000' },
    } as never;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'T',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    cost(ctx);

    expect(mockAppendCost).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-1',
      '2026-01-01T00:00:00.000Z',
      10000,
    );
  });

  it('skips when no lock file exists', () => {
    mockReadLock.mockReturnValue(undefined);

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'T',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const result = cost(ctx);

    expect(result).toBe(true);
    expect(mockAppendCost).not.toHaveBeenCalled();
  });

  it('returns true even when appendCostEntry throws', () => {
    mockReadLock.mockReturnValue({
      pid: 1,
      ticketKey: 'PROJ-1',
      ticketTitle: 'T',
      ticketBranch: 'feature/proj-1',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    mockAppendCost.mockImplementation(() => {
      throw new Error('disk full');
    });

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'T',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const result = cost(ctx);

    expect(result).toBe(true);
  });
});
