import { beforeEach, describe, expect, it, vi } from 'vitest';

import { detectBoard } from '~/scripts/shared/env-schema/env-schema.js';
import { runPreflight } from '~/scripts/shared/preflight/preflight.js';

import { pingBoard, validateInputs } from '../board-ops/board-ops.js';
import { createContext } from '../context/context.js';
import { preflight } from './preflight.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/preflight/preflight.js', () => ({
  runPreflight: vi.fn(),
}));

vi.mock('~/scripts/shared/env-schema/env-schema.js', () => ({
  detectBoard: vi.fn(),
}));

vi.mock('../board-ops/board-ops.js', () => ({
  pingBoard: vi.fn(() => Promise.resolve({ ok: true })),
  validateInputs: vi.fn(() => undefined),
}));

const mockPreflight = vi.mocked(runPreflight);
const mockDetectBoard = vi.mocked(detectBoard);
const mockPingBoard = vi.mocked(pingBoard);
const mockValidateInputs = vi.mocked(validateInputs);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPingBoard.mockResolvedValue({ ok: true });
    mockValidateInputs.mockReturnValue(undefined);
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
    mockValidateInputs.mockReturnValue('Invalid project key');

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
    mockPingBoard.mockResolvedValue({ ok: false, error: 'Connection refused' });

    const ctx = createContext([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await preflight(ctx);
    log.mockRestore();

    expect(result).toBe(false);
  });

  it('sets ctx.config on success', async () => {
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
  });
});
