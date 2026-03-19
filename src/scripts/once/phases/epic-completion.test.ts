import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findEntriesWithStatus } from '~/scripts/shared/progress/progress.js';

import { fetchEpicChildrenStatus } from '../board-ops/board-ops.js';
import { createContext } from '../context/context.js';
import { deliverEpicToBase } from '../deliver/deliver.js';
import { epicCompletion } from './epic-completion.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  findEntriesWithStatus: vi.fn(() => []),
}));

vi.mock('../board-ops/board-ops.js', () => ({
  fetchEpicChildrenStatus: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../deliver/deliver.js', () => ({
  deliverEpicToBase: vi.fn(() => Promise.resolve(true)),
}));

const mockFindEntries = vi.mocked(findEntriesWithStatus);
const mockFetchChildren = vi.mocked(fetchEpicChildrenStatus);
const mockDeliverEpic = vi.mocked(deliverEpicToBase);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('epicCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always returns true (best-effort)', async () => {
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await epicCompletion(ctx);
    log.mockRestore();

    expect(result).toBe(true);
  });

  it('delivers epic PR when all children are done', async () => {
    mockFindEntries.mockImplementation((_root: string, status: string) => {
      if (status === 'PR_CREATED')
        return [
          {
            timestamp: 't',
            key: 'PROJ-1',
            summary: 'T',
            status: 'PR_CREATED',
            parent: 'PROJ-100',
          },
        ];
      return [];
    });
    mockFetchChildren.mockResolvedValue({ total: 2, incomplete: 0 });
    mockDeliverEpic.mockResolvedValue(true);

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await epicCompletion(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(mockDeliverEpic).toHaveBeenCalled();
  });

  it('returns true even when deliverEpicToBase throws', async () => {
    mockFindEntries.mockImplementation((_root: string, status: string) => {
      if (status === 'PR_CREATED')
        return [
          {
            timestamp: 't',
            key: 'PROJ-1',
            summary: 'T',
            status: 'PR_CREATED',
            parent: 'PROJ-200',
          },
        ];
      return [];
    });
    mockFetchChildren.mockRejectedValue(new Error('API error'));

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await epicCompletion(ctx);
    log.mockRestore();

    expect(result).toBe(true);
  });

  it('skips epics that already have EPIC_PR_CREATED', async () => {
    mockFindEntries.mockImplementation((_root: string, status: string) => {
      if (status === 'PR_CREATED')
        return [
          {
            timestamp: 't',
            key: 'PROJ-1',
            summary: 'T',
            status: 'PR_CREATED',
            parent: 'PROJ-100',
          },
        ];
      if (status === 'EPIC_PR_CREATED')
        return [
          {
            timestamp: 't',
            key: 'PROJ-100',
            summary: 'Epic',
            status: 'EPIC_PR_CREATED',
          },
        ];
      return [];
    });

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await epicCompletion(ctx);
    log.mockRestore();

    expect(mockFetchChildren).not.toHaveBeenCalled();
  });
});
