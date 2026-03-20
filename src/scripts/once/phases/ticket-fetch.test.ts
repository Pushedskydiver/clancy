import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Board } from '~/scripts/board/board.js';
import {
  appendProgress,
  countReworkCycles,
} from '~/scripts/shared/progress/progress.js';

import { createContext } from '../context/context.js';
import { fetchTicket } from '../fetch-ticket/fetch-ticket.js';
import { ticketFetch } from './ticket-fetch.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../fetch-ticket/fetch-ticket.js', () => ({
  fetchTicket: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  appendProgress: vi.fn(),
  countReworkCycles: vi.fn(() => 0),
}));

vi.mock('~/scripts/shared/env-schema/env-schema.js', () => ({
  sharedEnv: vi.fn(() => ({})),
}));

const mockFetchTicket = vi.mocked(fetchTicket);
const mockCountReworkCycles = vi.mocked(countReworkCycles);
const mockAppendProgress = vi.mocked(appendProgress);

/** Minimal mock Board for tests that trigger fetchTicket. */
const mockBoard: Board = {
  ping: vi.fn(() => Promise.resolve({ ok: true })),
  validateInputs: vi.fn(() => undefined),
  fetchTicket: vi.fn(() => Promise.resolve(undefined)),
  fetchTickets: vi.fn(() => Promise.resolve([])),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
  fetchChildrenStatus: vi.fn(() => Promise.resolve(undefined)),
  transitionTicket: vi.fn(() => Promise.resolve(true)),
  ensureLabel: vi.fn(() => Promise.resolve()),
  addLabel: vi.fn(() => Promise.resolve()),
  removeLabel: vi.fn(() => Promise.resolve()),
  sharedEnv: vi.fn(() => ({})),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ticketFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCountReworkCycles.mockReturnValue(0);
  });

  it('returns false when no ticket found', async () => {
    mockFetchTicket.mockResolvedValue(undefined);

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.board = mockBoard;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await ticketFetch(ctx);
    log.mockRestore();

    expect(result).toBe(false);
  });

  it('sets branch fields on success', async () => {
    mockFetchTicket.mockResolvedValue({
      key: 'PROJ-1',
      title: 'Test',
      description: 'desc',
      parentInfo: 'PROJ-100',
      blockers: 'None',
    });

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.board = mockBoard;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await ticketFetch(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(ctx.ticketBranch).toBe('feature/proj-1');
    expect(ctx.baseBranch).toBe('main');
    expect(ctx.hasParent).toBe(true);
  });

  it('uses existing ticket from rework detection', async () => {
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-2',
      title: 'Rework',
      description: 'desc',
      parentInfo: 'none',
      blockers: 'None',
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await ticketFetch(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(mockFetchTicket).not.toHaveBeenCalled();
    expect(ctx.hasParent).toBe(false);
  });

  it('returns false when max rework cycles exceeded', async () => {
    mockCountReworkCycles.mockReturnValue(3);

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.isRework = true;
    ctx.ticket = {
      key: 'PROJ-3',
      title: 'Max rework',
      description: 'desc',
      parentInfo: 'none',
      blockers: 'None',
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await ticketFetch(ctx);
    log.mockRestore();

    expect(result).toBe(false);
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-3',
      'Max rework',
      'SKIPPED',
    );
  });
});
