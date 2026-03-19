import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Board } from '~/scripts/board/board.js';
import { findEntriesWithStatus } from '~/scripts/shared/progress/progress.js';

import { createContext } from '../context/context.js';
import { deliverEpicToBase } from '../deliver/deliver.js';
import { epicCompletion } from './epic-completion.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  findEntriesWithStatus: vi.fn(() => []),
}));

vi.mock('../deliver/deliver.js', () => ({
  deliverEpicToBase: vi.fn(() => Promise.resolve(true)),
}));

const mockFindEntries = vi.mocked(findEntriesWithStatus);
const mockDeliverEpic = vi.mocked(deliverEpicToBase);

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeBoard(fetchChildrenStatus: any = vi.fn()) {
  return {
    ping: vi.fn(),
    validateInputs: vi.fn(),
    fetchTicket: vi.fn(),
    fetchTickets: vi.fn(),
    fetchBlockerStatus: vi.fn(),
    fetchChildrenStatus,
    transitionTicket: vi.fn(),
    sharedEnv: vi.fn(() => ({})),
  } as unknown as Board;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('epicCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always returns true (best-effort)', async () => {
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.board = makeBoard();

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
    const mockFetchChildren = vi.fn(() =>
      Promise.resolve({ total: 2, incomplete: 0 }),
    );
    mockDeliverEpic.mockResolvedValue(true);

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.board = makeBoard(mockFetchChildren);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await epicCompletion(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(mockDeliverEpic).toHaveBeenCalled();
  });

  it('returns true even when fetchChildrenStatus throws', async () => {
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
    const mockFetchChildren = vi.fn(() =>
      Promise.reject(new Error('API error')),
    );

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.board = makeBoard(mockFetchChildren);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await epicCompletion(ctx);
    log.mockRestore();

    expect(result).toBe(true);
  });

  it('skips epics that already have EPIC_PR_CREATED', async () => {
    const mockFetchChildren = vi.fn(() => Promise.resolve(undefined));
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
    ctx.board = makeBoard(mockFetchChildren);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await epicCompletion(ctx);
    log.mockRestore();

    expect(mockFetchChildren).not.toHaveBeenCalled();
  });
});
