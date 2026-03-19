import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Board } from '~/scripts/board/board.js';

import { createContext } from '../context/context.js';
import { transition } from './transition.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBoard() {
  return {
    ping: vi.fn(),
    validateInputs: vi.fn(),
    fetchTicket: vi.fn(),
    fetchTickets: vi.fn(),
    fetchBlockerStatus: vi.fn(),
    fetchChildrenStatus: vi.fn(),
    transitionTicket: vi.fn(() => Promise.resolve(true)),
    sharedEnv: vi.fn(() => ({})),
  } as unknown as Board;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls board.transitionTicket when CLANCY_STATUS_IN_PROGRESS is set', async () => {
    const board = makeBoard();
    const ctx = createContext([]);
    ctx.config = {
      provider: 'jira',
      env: { CLANCY_STATUS_IN_PROGRESS: 'In Progress' },
    } as never;
    ctx.board = board;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'T',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const result = await transition(ctx);

    expect(result).toBe(true);
    expect(board.transitionTicket).toHaveBeenCalledWith(
      ctx.ticket,
      'In Progress',
    );
  });

  it('skips transition when CLANCY_STATUS_IN_PROGRESS is not set', async () => {
    const board = makeBoard();
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.board = board;
    ctx.ticket = {
      key: 'PROJ-2',
      title: 'T2',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const result = await transition(ctx);

    expect(result).toBe(true);
    expect(board.transitionTicket).not.toHaveBeenCalled();
  });

  it('always returns true (best-effort)', async () => {
    const board = makeBoard();
    const ctx = createContext([]);
    ctx.config = {
      provider: 'jira',
      env: { CLANCY_STATUS_IN_PROGRESS: 'In Progress' },
    } as never;
    ctx.board = board;
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
