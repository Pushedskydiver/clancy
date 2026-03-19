import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoard } from '~/scripts/board/factory/factory.js';
import { detectBoard } from '~/scripts/shared/env-schema/env-schema.js';
import { runPreflight } from '~/scripts/shared/preflight/preflight.js';

import { createContext } from '../context/context.js';
import { preflight } from './preflight.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/preflight/preflight.js', () => ({
  runPreflight: vi.fn(),
}));

vi.mock('~/scripts/shared/env-schema/env-schema.js', () => ({
  detectBoard: vi.fn(),
}));

vi.mock('~/scripts/board/factory/factory.js', () => ({
  createBoard: vi.fn(() => ({
    ping: vi.fn(() => Promise.resolve({ ok: true })),
    validateInputs: vi.fn(() => undefined),
  })),
}));

const mockPreflight = vi.mocked(runPreflight);
const mockDetectBoard = vi.mocked(detectBoard);
const mockCreateBoard = vi.mocked(createBoard);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateBoard.mockReturnValue({
      ping: vi.fn(() => Promise.resolve({ ok: true })),
      validateInputs: vi.fn(() => undefined),
      fetchTicket: vi.fn(),
      fetchTickets: vi.fn(),
      fetchBlockerStatus: vi.fn(),
      fetchChildrenStatus: vi.fn(),
      transitionTicket: vi.fn(),
      ensureLabel: vi.fn(),
      addLabel: vi.fn(),
      removeLabel: vi.fn(),
      sharedEnv: vi.fn(() => ({})),
    });
  });

  it('returns false when preflight fails', async () => {
    mockPreflight.mockReturnValue({ ok: false, error: 'missing claude' });

    const ctx = createContext([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await preflight(ctx);
    log.mockRestore();

    expect(result).toBe(false);
    expect(ctx.config).toBeUndefined();
  });

  it('returns false when no board detected', async () => {
    mockPreflight.mockReturnValue({ ok: true, env: {} });
    mockDetectBoard.mockReturnValue('No board detected');

    const ctx = createContext([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await preflight(ctx);
    log.mockRestore();

    expect(result).toBe(false);
  });

  it('returns false when validation fails', async () => {
    mockPreflight.mockReturnValue({ ok: true, env: { JIRA_BASE_URL: 'x' } });
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: { JIRA_BASE_URL: 'x' },
    } as never);
    mockCreateBoard.mockReturnValue({
      ping: vi.fn(() => Promise.resolve({ ok: true })),
      validateInputs: vi.fn(() => 'Invalid project key'),
      fetchTicket: vi.fn(),
      fetchTickets: vi.fn(),
      fetchBlockerStatus: vi.fn(),
      fetchChildrenStatus: vi.fn(),
      transitionTicket: vi.fn(),
      ensureLabel: vi.fn(),
      addLabel: vi.fn(),
      removeLabel: vi.fn(),
      sharedEnv: vi.fn(() => ({})),
    });

    const ctx = createContext([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await preflight(ctx);
    log.mockRestore();

    expect(result).toBe(false);
  });

  it('returns false when ping fails', async () => {
    mockPreflight.mockReturnValue({ ok: true, env: { JIRA_BASE_URL: 'x' } });
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: { JIRA_BASE_URL: 'x' },
    } as never);
    mockCreateBoard.mockReturnValue({
      ping: vi.fn(() =>
        Promise.resolve({ ok: false, error: 'Connection refused' }),
      ),
      validateInputs: vi.fn(() => undefined),
      fetchTicket: vi.fn(),
      fetchTickets: vi.fn(),
      fetchBlockerStatus: vi.fn(),
      fetchChildrenStatus: vi.fn(),
      transitionTicket: vi.fn(),
      ensureLabel: vi.fn(),
      addLabel: vi.fn(),
      removeLabel: vi.fn(),
      sharedEnv: vi.fn(() => ({})),
    });

    const ctx = createContext([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await preflight(ctx);
    log.mockRestore();

    expect(result).toBe(false);
  });

  it('sets ctx.config and ctx.board on success', async () => {
    const config = {
      provider: 'jira' as const,
      env: {
        JIRA_BASE_URL: 'https://x.atlassian.net',
        JIRA_USER: 'u',
        JIRA_API_TOKEN: 't',
        JIRA_PROJECT_KEY: 'P',
      },
    };
    mockPreflight.mockReturnValue({ ok: true, env: config.env });
    mockDetectBoard.mockReturnValue(config);

    const ctx = createContext([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await preflight(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(ctx.config).toBe(config);
    expect(ctx.board).toBeDefined();
  });
});
