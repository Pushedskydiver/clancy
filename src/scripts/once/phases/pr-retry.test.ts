import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunContext } from '../context/context.js';
import { prRetry } from './pr-retry.js';

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  findEntriesWithStatus: vi.fn(() => []),
  appendProgress: vi.fn(),
}));

vi.mock('~/scripts/shared/remote/remote.js', () => ({
  detectRemote: vi.fn(() => ({
    host: 'github',
    url: 'https://github.com/test/repo',
  })),
}));

vi.mock('~/scripts/shared/pull-request/pr-body/pr-body.js', () => ({
  buildPrBody: vi.fn(() => 'PR body'),
}));

vi.mock('~/scripts/once/pr-creation/pr-creation.js', () => ({
  attemptPrCreation: vi.fn(() =>
    Promise.resolve({
      ok: true,
      url: 'https://github.com/test/repo/pull/1',
      number: 1,
    }),
  ),
}));

vi.mock('~/scripts/shared/env-schema/env-schema.js', () => ({
  sharedEnv: vi.fn(() => ({})),
}));

function makeCtx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    argv: [],
    dryRun: false,
    skipFeasibility: false,
    startTime: Date.now(),
    cwd: '/test',
    isAfk: false,
    config: {
      provider: 'github' as const,
      env: { GITHUB_TOKEN: 'test', CLANCY_BASE_BRANCH: 'main' },
    } as RunContext['config'],
    ...overrides,
  } as RunContext;
}

describe('prRetry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns true when no PUSHED entries', async () => {
    const { findEntriesWithStatus } =
      await import('~/scripts/shared/progress/progress.js');
    vi.mocked(findEntriesWithStatus).mockReturnValue([]);

    const result = await prRetry(makeCtx());
    expect(result).toBe(true);
  });

  it('skips PUSHED entries that already have PR_CREATED', async () => {
    const { findEntriesWithStatus } =
      await import('~/scripts/shared/progress/progress.js');
    const { attemptPrCreation } =
      await import('~/scripts/once/pr-creation/pr-creation.js');

    vi.mocked(findEntriesWithStatus).mockImplementation((_root, status) => {
      if (status === 'PUSHED')
        return [
          { key: 'issue-1', summary: 'Test', parent: undefined },
        ] as never;
      if (status === 'PR_CREATED')
        return [
          { key: 'issue-1', summary: 'Test', parent: undefined },
        ] as never;
      return [];
    });

    await prRetry(makeCtx());
    expect(attemptPrCreation).not.toHaveBeenCalled();
  });

  it('retries PR creation for PUSHED entries without PR_CREATED', async () => {
    const { findEntriesWithStatus, appendProgress } =
      await import('~/scripts/shared/progress/progress.js');
    const { attemptPrCreation } =
      await import('~/scripts/once/pr-creation/pr-creation.js');

    vi.mocked(findEntriesWithStatus).mockImplementation((_root, status) => {
      if (status === 'PUSHED')
        return [
          { key: 'issue-5', summary: 'Fix bug', parent: undefined },
        ] as never;
      return [];
    });

    vi.mocked(attemptPrCreation).mockResolvedValue({
      ok: true,
      url: 'https://github.com/test/repo/pull/5',
      number: 5,
    });

    await prRetry(makeCtx());

    expect(attemptPrCreation).toHaveBeenCalled();
    expect(appendProgress).toHaveBeenCalledWith(
      '/test',
      'issue-5',
      'Fix bug',
      'PR_CREATED',
      5,
      undefined,
    );
  });

  it('handles PR retry failure gracefully', async () => {
    const { findEntriesWithStatus, appendProgress } =
      await import('~/scripts/shared/progress/progress.js');
    const { attemptPrCreation } =
      await import('~/scripts/once/pr-creation/pr-creation.js');

    vi.mocked(findEntriesWithStatus).mockImplementation((_root, status) => {
      if (status === 'PUSHED')
        return [
          { key: 'issue-7', summary: 'Add feature', parent: undefined },
        ] as never;
      return [];
    });

    vi.mocked(attemptPrCreation).mockResolvedValue({
      ok: false,
      error: 'Network error',
    } as never);

    const result = await prRetry(makeCtx());
    expect(result).toBe(true);
    expect(appendProgress).not.toHaveBeenCalled();
  });

  it('uses epic branch as target for parented tickets', async () => {
    const { findEntriesWithStatus } =
      await import('~/scripts/shared/progress/progress.js');
    const { attemptPrCreation } =
      await import('~/scripts/once/pr-creation/pr-creation.js');

    vi.mocked(findEntriesWithStatus).mockImplementation((_root, status) => {
      if (status === 'PUSHED')
        return [
          { key: 'issue-10', summary: 'Child task', parent: 'issue-5' },
        ] as never;
      return [];
    });

    vi.mocked(attemptPrCreation).mockResolvedValue({
      ok: true,
      url: 'https://github.com/test/repo/pull/10',
      number: 10,
    });

    await prRetry(makeCtx());

    expect(attemptPrCreation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'feature/issue-10',
      'epic/issue-5',
      expect.any(String),
      expect.any(String),
    );
  });

  it('returns true when config is undefined', async () => {
    const result = await prRetry(makeCtx({ config: undefined }));
    expect(result).toBe(true);
  });
});
