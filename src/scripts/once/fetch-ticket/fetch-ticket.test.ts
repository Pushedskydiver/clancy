import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Board } from '~/scripts/board/board.js';
import type { FetchedTicket } from '~/types/board.js';

import {
  fetchTicket,
  resolveBuildLabel,
  resolvePlanLabel,
} from './fetch-ticket.js';

// ─── Mock Board factory ─────────────────────────────────────────────────────

function createMockBoard(overrides: Partial<Board> = {}): Board {
  return {
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
    ...overrides,
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ticket1: FetchedTicket = {
  key: 'PROJ-10',
  title: 'First ticket',
  description: 'Desc.',
  parentInfo: 'PROJ-1',
  blockers: 'None',
  labels: [],
};

const ticket2: FetchedTicket = {
  key: 'PROJ-11',
  title: 'Second ticket',
  description: 'Desc.',
  parentInfo: 'PROJ-1',
  blockers: 'None',
  labels: [],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('fetchTicket', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns first unblocked candidate', async () => {
    const board = createMockBoard({
      fetchTickets: vi.fn(() => Promise.resolve([ticket1, ticket2])),
      fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
    });

    const result = await fetchTicket(board);

    expect(result).toEqual(ticket1);
    expect(board.fetchBlockerStatus).toHaveBeenCalledTimes(1);
  });

  it('skips blocked candidate and returns second unblocked one', async () => {
    const board = createMockBoard({
      fetchTickets: vi.fn(() => Promise.resolve([ticket1, ticket2])),
      fetchBlockerStatus: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(board);
    log.mockRestore();

    expect(result).toEqual(ticket2);
    expect(board.fetchBlockerStatus).toHaveBeenCalledTimes(2);
  });

  it('returns undefined when all candidates are blocked', async () => {
    const board = createMockBoard({
      fetchTickets: vi.fn(() => Promise.resolve([ticket1])),
      fetchBlockerStatus: vi.fn(() => Promise.resolve(true)),
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(board);
    log.mockRestore();

    expect(result).toBeUndefined();
  });

  it('returns undefined when no candidates available', async () => {
    const board = createMockBoard({
      fetchTickets: vi.fn(() => Promise.resolve([])),
    });

    const result = await fetchTicket(board);

    expect(result).toBeUndefined();
    expect(board.fetchBlockerStatus).not.toHaveBeenCalled();
  });

  it('passes excludeHitl flag in AFK mode', async () => {
    const board = createMockBoard({
      fetchTickets: vi.fn(() => Promise.resolve([])),
    });

    await fetchTicket(board, { isAfk: true });

    expect(board.fetchTickets).toHaveBeenCalledWith({ excludeHitl: true });
  });

  it('passes excludeHitl=false in interactive mode', async () => {
    const board = createMockBoard({
      fetchTickets: vi.fn(() => Promise.resolve([])),
    });

    await fetchTicket(board);

    expect(board.fetchTickets).toHaveBeenCalledWith({ excludeHitl: false });
  });
});

// ─── Pipeline label filtering ─────────────────────────────────────────────

describe('fetchTicket — plan label guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips candidate with plan label', async () => {
    const planTicket: FetchedTicket = {
      ...ticket1,
      labels: ['clancy:build', 'clancy:plan'],
    };
    const cleanTicket: FetchedTicket = {
      ...ticket2,
      labels: ['clancy:build'],
    };

    const board = createMockBoard({
      fetchTickets: vi.fn(() => Promise.resolve([planTicket, cleanTicket])),
      fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
      sharedEnv: vi.fn(() => ({
        CLANCY_LABEL_PLAN: 'clancy:plan',
      })),
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(board);
    log.mockRestore();

    expect(result).toEqual(cleanTicket);
  });

  it('returns candidate when no plan label is configured', async () => {
    const ticketWithLabels: FetchedTicket = {
      ...ticket1,
      labels: ['clancy:build', 'some-label'],
    };

    const board = createMockBoard({
      fetchTickets: vi.fn(() => Promise.resolve([ticketWithLabels])),
      fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
      sharedEnv: vi.fn(() => ({})),
    });

    const result = await fetchTicket(board);

    expect(result).toEqual(ticketWithLabels);
  });

  it('returns undefined when all candidates have plan label', async () => {
    const planTicket: FetchedTicket = {
      ...ticket1,
      labels: ['clancy:plan'],
    };

    const board = createMockBoard({
      fetchTickets: vi.fn(() => Promise.resolve([planTicket])),
      sharedEnv: vi.fn(() => ({
        CLANCY_LABEL_PLAN: 'clancy:plan',
      })),
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(board);
    log.mockRestore();

    expect(result).toBeUndefined();
  });

  it('uses CLANCY_PLAN_LABEL fallback for plan label', async () => {
    const planTicket: FetchedTicket = {
      ...ticket1,
      labels: ['needs-refinement'],
    };
    const cleanTicket: FetchedTicket = {
      ...ticket2,
      labels: ['clancy'],
    };

    const board = createMockBoard({
      fetchTickets: vi.fn(() => Promise.resolve([planTicket, cleanTicket])),
      fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
      sharedEnv: vi.fn(() => ({
        CLANCY_PLAN_LABEL: 'needs-refinement',
      })),
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(board);
    log.mockRestore();

    expect(result).toEqual(cleanTicket);
  });
});

// ─── Label resolvers ────────────────────────────────────────────────────────

describe('resolveBuildLabel', () => {
  it('uses CLANCY_LABEL_BUILD when set', () => {
    expect(resolveBuildLabel({ CLANCY_LABEL_BUILD: 'clancy:build' })).toBe(
      'clancy:build',
    );
  });

  it('falls back to CLANCY_LABEL', () => {
    expect(resolveBuildLabel({ CLANCY_LABEL: 'clancy' })).toBe('clancy');
  });

  it('returns undefined when neither is set', () => {
    expect(resolveBuildLabel({})).toBeUndefined();
  });

  it('prefers CLANCY_LABEL_BUILD over CLANCY_LABEL', () => {
    expect(
      resolveBuildLabel({
        CLANCY_LABEL_BUILD: 'clancy:build',
        CLANCY_LABEL: 'clancy',
      }),
    ).toBe('clancy:build');
  });
});

describe('resolvePlanLabel', () => {
  it('uses CLANCY_LABEL_PLAN when set', () => {
    expect(resolvePlanLabel({ CLANCY_LABEL_PLAN: 'clancy:plan' })).toBe(
      'clancy:plan',
    );
  });

  it('falls back to CLANCY_PLAN_LABEL', () => {
    expect(resolvePlanLabel({ CLANCY_PLAN_LABEL: 'needs-plan' })).toBe(
      'needs-plan',
    );
  });

  it('returns undefined when neither is set', () => {
    expect(resolvePlanLabel({})).toBeUndefined();
  });
});
