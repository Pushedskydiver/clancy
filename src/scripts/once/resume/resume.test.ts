import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sharedEnv } from '~/scripts/shared/env-schema/env-schema.js';
import {
  branchExists,
  checkout,
  hasUncommittedChanges,
  pushBranch,
} from '~/scripts/shared/git-ops/git-ops.js';
import {
  appendProgress,
  findLastEntry,
} from '~/scripts/shared/progress/progress.js';
import { detectRemote } from '~/scripts/shared/remote/remote.js';

import type { LockData } from '../lock/lock.js';
import { attemptPrCreation } from '../pr-creation/pr-creation.js';
import { detectResume, executeResume } from './resume.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/git-ops/git-ops.js', () => ({
  branchExists: vi.fn(),
  checkout: vi.fn(),
  hasUncommittedChanges: vi.fn(),
  pushBranch: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('../pr-creation/pr-creation.js', () => ({
  attemptPrCreation: vi.fn(),
}));

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  appendProgress: vi.fn(),
  findLastEntry: vi.fn(),
}));

vi.mock('~/scripts/shared/pull-request/pr-body/pr-body.js', () => ({
  buildPrBody: vi.fn(() => 'pr body'),
}));

vi.mock('~/scripts/shared/remote/remote.js', () => ({
  detectRemote: vi.fn(() => ({
    host: 'github' as const,
    owner: 'o',
    repo: 'r',
    hostname: 'github.com',
  })),
}));

vi.mock('~/scripts/shared/env-schema/env-schema.js', () => ({
  sharedEnv: vi.fn(() => ({})),
}));

vi.mock('~/utils/ansi/ansi.js', () => ({
  dim: (s: string) => s,
  green: (s: string) => s,
  yellow: (s: string) => s,
}));

// ─── Typed mocks ────────────────────────────────────────────────────────────

const mockBranchExists = vi.mocked(branchExists);
const mockCheckout = vi.mocked(checkout);
const mockHasUncommittedChanges = vi.mocked(hasUncommittedChanges);
const mockPushBranch = vi.mocked(pushBranch);
const mockExecFileSync = vi.mocked(execFileSync);
const mockAttemptPrCreation = vi.mocked(attemptPrCreation);
const mockAppendProgress = vi.mocked(appendProgress);
const mockFindLastEntry = vi.mocked(findLastEntry);
const mockDetectRemote = vi.mocked(detectRemote);
const mockSharedEnv = vi.mocked(sharedEnv);

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeLock(overrides: Partial<LockData> = {}): LockData {
  return {
    pid: process.pid,
    ticketKey: 'PROJ-42',
    ticketTitle: 'Add login page',
    ticketBranch: 'feature/proj-42',
    targetBranch: 'main',
    parentKey: '',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

const githubRemote = {
  host: 'github' as const,
  owner: 'o',
  repo: 'r',
  hostname: 'github.com',
};

/**
 * Helper to build an execFileSync mock that handles rev-parse and log commands.
 * The log handler receives the full args array for custom logic.
 */
function makeExecMock(
  previousBranch: string,
  logHandler: (args: string[]) => string,
) {
  return ((_cmd: unknown, args: unknown) => {
    const argList = args as string[];
    if (argList?.[0] === 'rev-parse') return `${previousBranch}\n`;
    if (argList?.[0] === 'log') return logHandler(argList);
    return '';
  }) as typeof execFileSync;
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();

  // Restore defaults after reset
  mockBranchExists.mockReturnValue(false);
  mockHasUncommittedChanges.mockReturnValue(false);
  mockPushBranch.mockReturnValue(true);
  mockExecFileSync.mockReturnValue('main\n');
  mockDetectRemote.mockReturnValue(githubRemote);
  mockSharedEnv.mockReturnValue({});
});

// ─── detectResume ───────────────────────────────────────────────────────────

describe('detectResume', () => {
  it('returns undefined when branch does not exist', () => {
    mockBranchExists.mockReturnValue(false);

    expect(detectResume(makeLock())).toBeUndefined();
  });

  it('returns resume info with hasUncommitted true when uncommitted changes exist', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(true);
    mockExecFileSync.mockImplementation(makeExecMock('main', () => ''));

    const result = detectResume(makeLock());

    expect(result).toEqual({
      branch: 'feature/proj-42',
      hasUncommitted: true,
      hasUnpushed: false,
      alreadyDelivered: false,
    });
  });

  it('returns resume info with hasUnpushed true when unpushed commits exist', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(false);
    mockExecFileSync.mockImplementation(
      makeExecMock('main', () => 'abc1234 some commit'),
    );

    const result = detectResume(makeLock());

    expect(result).toEqual({
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: true,
      alreadyDelivered: false,
    });
  });

  it('returns resume info with both flags when uncommitted and unpushed exist', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(true);
    mockExecFileSync.mockImplementation(
      makeExecMock('main', () => 'abc1234 some commit'),
    );

    const result = detectResume(makeLock());

    expect(result).toEqual({
      branch: 'feature/proj-42',
      hasUncommitted: true,
      hasUnpushed: true,
      alreadyDelivered: false,
    });
  });

  it('returns undefined when branch exists but has no changes', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(false);
    mockExecFileSync.mockImplementation(makeExecMock('main', () => ''));

    expect(detectResume(makeLock())).toBeUndefined();
  });

  it('returns undefined when rev-parse fails', () => {
    mockBranchExists.mockReturnValue(true);
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    expect(detectResume(makeLock())).toBeUndefined();
  });

  it('returns undefined when checkout fails', () => {
    mockBranchExists.mockReturnValue(true);
    mockExecFileSync.mockReturnValue('main\n');
    mockCheckout.mockImplementation(() => {
      throw new Error('checkout failed');
    });

    expect(detectResume(makeLock())).toBeUndefined();
  });

  it('restores original branch after inspection', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(true);
    mockExecFileSync.mockImplementation(makeExecMock('develop', () => ''));

    detectResume(makeLock());

    // checkout called twice: once for ticket branch, once to restore
    expect(mockCheckout).toHaveBeenCalledTimes(2);
    expect(mockCheckout).toHaveBeenNthCalledWith(1, 'feature/proj-42');
    expect(mockCheckout).toHaveBeenNthCalledWith(2, 'develop');
  });

  it('falls back to target branch comparison when remote branch does not exist', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(false);

    let logCallCount = 0;
    mockExecFileSync.mockImplementation(
      makeExecMock('main', () => {
        logCallCount++;
        if (logCallCount === 1) {
          // First log call (origin/branch..branch) fails — no remote branch
          throw new Error('unknown revision');
        }
        // Second log call (origin/targetBranch..branch) returns commits
        return 'def5678 fallback commit';
      }),
    );

    const result = detectResume(makeLock());

    expect(result).toEqual({
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: true,
      alreadyDelivered: false,
    });
  });

  it('returns alreadyDelivered when branch exists with no local changes but progress shows PR_CREATED', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(false);
    mockExecFileSync.mockImplementation(makeExecMock('main', () => ''));
    mockFindLastEntry.mockReturnValue({
      timestamp: '2026-03-22T10:00:00Z',
      key: 'PROJ-42',
      summary: 'Add login page',
      status: 'PR_CREATED',
      prNumber: 5,
    });

    const result = detectResume(makeLock());

    expect(result).toEqual({
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: false,
      alreadyDelivered: true,
    });
  });

  it('returns alreadyDelivered for PUSHED status in progress', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(false);
    mockExecFileSync.mockImplementation(makeExecMock('main', () => ''));
    mockFindLastEntry.mockReturnValue({
      timestamp: '2026-03-22T10:00:00Z',
      key: 'PROJ-42',
      summary: 'Add login page',
      status: 'PUSHED',
    });

    const result = detectResume(makeLock());

    expect(result).toEqual({
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: false,
      alreadyDelivered: true,
    });
  });

  it('returns alreadyDelivered for REWORK status in progress', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(false);
    mockExecFileSync.mockImplementation(makeExecMock('main', () => ''));
    mockFindLastEntry.mockReturnValue({
      timestamp: '2026-03-22T10:00:00Z',
      key: 'PROJ-42',
      summary: 'Add login page',
      status: 'REWORK',
      prNumber: 7,
    });

    const result = detectResume(makeLock());

    expect(result).toEqual({
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: false,
      alreadyDelivered: true,
    });
  });

  it('returns alreadyDelivered for RESUMED status in progress', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(false);
    mockExecFileSync.mockImplementation(makeExecMock('main', () => ''));
    mockFindLastEntry.mockReturnValue({
      timestamp: '2026-03-22T10:00:00Z',
      key: 'PROJ-42',
      summary: 'Add login page',
      status: 'RESUMED',
    });

    const result = detectResume(makeLock());

    expect(result).toEqual({
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: false,
      alreadyDelivered: true,
    });
  });

  it('returns undefined when branch has no changes and no delivery in progress', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(false);
    mockExecFileSync.mockImplementation(makeExecMock('main', () => ''));
    mockFindLastEntry.mockReturnValue(undefined);

    expect(detectResume(makeLock())).toBeUndefined();
  });

  it('returns undefined when last progress entry is non-delivery status', () => {
    mockBranchExists.mockReturnValue(true);
    mockHasUncommittedChanges.mockReturnValue(false);
    mockExecFileSync.mockImplementation(makeExecMock('main', () => ''));
    mockFindLastEntry.mockReturnValue({
      timestamp: '2026-03-22T10:00:00Z',
      key: 'PROJ-42',
      summary: 'Add login page',
      status: 'PUSH_FAILED',
    });

    expect(detectResume(makeLock())).toBeUndefined();
  });
});

// ─── executeResume ──────────────────────────────────────────────────────────

describe('executeResume', () => {
  it('commits and pushes when hasUncommitted is true', async () => {
    const lock = makeLock();
    const resumeInfo = {
      branch: 'feature/proj-42',
      hasUncommitted: true,
      hasUnpushed: false,
      alreadyDelivered: false,
    };
    mockAttemptPrCreation.mockResolvedValue({
      ok: true,
      url: 'https://github.com/o/r/pull/5',
      number: 5,
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await executeResume(
      { provider: 'jira', env: {} } as never,
      lock,
      resumeInfo,
    );
    log.mockRestore();

    expect(result).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['add', '-A'], {
      encoding: 'utf8',
    });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'fix(PROJ-42): resume after crash'],
      { encoding: 'utf8' },
    );
    expect(mockPushBranch).toHaveBeenCalledWith('feature/proj-42');
  });

  it('pushes without committing when only hasUnpushed is true', async () => {
    const lock = makeLock();
    const resumeInfo = {
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: true,
      alreadyDelivered: false,
    };
    mockAttemptPrCreation.mockResolvedValue({
      ok: true,
      url: 'https://github.com/o/r/pull/7',
      number: 7,
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await executeResume(
      { provider: 'jira', env: {} } as never,
      lock,
      resumeInfo,
    );
    log.mockRestore();

    expect(result).toBe(true);
    expect(mockExecFileSync).not.toHaveBeenCalledWith(
      'git',
      ['add', '-A'],
      expect.anything(),
    );
    expect(mockPushBranch).toHaveBeenCalledWith('feature/proj-42');
  });

  it('returns false when push fails', async () => {
    mockPushBranch.mockReturnValue(false);
    const lock = makeLock();
    const resumeInfo = {
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: true,
      alreadyDelivered: false,
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await executeResume(
      { provider: 'jira', env: {} } as never,
      lock,
      resumeInfo,
    );
    log.mockRestore();

    expect(result).toBe(false);
  });

  it('returns false when commit fails', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('commit failed');
    });
    const lock = makeLock();
    const resumeInfo = {
      branch: 'feature/proj-42',
      hasUncommitted: true,
      hasUnpushed: false,
      alreadyDelivered: false,
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await executeResume(
      { provider: 'jira', env: {} } as never,
      lock,
      resumeInfo,
    );
    log.mockRestore();

    expect(result).toBe(false);
  });

  it('logs RESUMED progress entry with PR number on success', async () => {
    const lock = makeLock({ parentKey: 'PROJ-10' });
    const resumeInfo = {
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: true,
      alreadyDelivered: false,
    };
    mockAttemptPrCreation.mockResolvedValue({
      ok: true,
      url: 'https://github.com/o/r/pull/12',
      number: 12,
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await executeResume(
      { provider: 'jira', env: {} } as never,
      lock,
      resumeInfo,
    );
    log.mockRestore();

    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-42',
      'Add login page',
      'RESUMED',
      12,
      'PROJ-10',
    );
  });

  it('logs RESUMED without PR number when PR creation fails', async () => {
    const lock = makeLock();
    const resumeInfo = {
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: true,
      alreadyDelivered: false,
    };
    mockAttemptPrCreation.mockResolvedValue({
      ok: false,
      error: 'PR creation failed',
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await executeResume(
      { provider: 'jira', env: {} } as never,
      lock,
      resumeInfo,
    );
    log.mockRestore();

    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-42',
      'Add login page',
      'RESUMED',
      undefined,
      undefined,
    );
  });

  it('logs RESUMED without PR when remote host is unsupported', async () => {
    mockDetectRemote.mockReturnValue({ host: 'none' });
    const lock = makeLock();
    const resumeInfo = {
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: true,
      alreadyDelivered: false,
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await executeResume(
      { provider: 'jira', env: {} } as never,
      lock,
      resumeInfo,
    );
    log.mockRestore();

    expect(mockAttemptPrCreation).not.toHaveBeenCalled();
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-42',
      'Add login page',
      'RESUMED',
      undefined,
      undefined,
    );
  });

  it('skips PR creation for azure remote', async () => {
    mockDetectRemote.mockReturnValue({
      host: 'azure',
      url: 'https://dev.azure.com/org/repo',
    });
    const lock = makeLock();
    const resumeInfo = {
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: true,
      alreadyDelivered: false,
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await executeResume(
      { provider: 'jira', env: {} } as never,
      lock,
      resumeInfo,
    );
    log.mockRestore();

    expect(mockAttemptPrCreation).not.toHaveBeenCalled();
  });

  it('switches back to target branch after resume', async () => {
    const lock = makeLock({ targetBranch: 'develop' });
    const resumeInfo = {
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: true,
      alreadyDelivered: false,
    };
    mockAttemptPrCreation.mockResolvedValue({
      ok: false,
      error: 'failed',
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await executeResume(
      { provider: 'jira', env: {} } as never,
      lock,
      resumeInfo,
    );
    log.mockRestore();

    // Last checkout call should be to target branch
    const checkoutCalls = mockCheckout.mock.calls;
    expect(checkoutCalls[checkoutCalls.length - 1]).toEqual(['develop']);
  });

  it('passes parentKey undefined when lock has empty parentKey', async () => {
    const lock = makeLock({ parentKey: '' });
    const resumeInfo = {
      branch: 'feature/proj-42',
      hasUncommitted: false,
      hasUnpushed: true,
      alreadyDelivered: false,
    };
    mockAttemptPrCreation.mockResolvedValue({
      ok: true,
      url: 'https://github.com/o/r/pull/3',
      number: 3,
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await executeResume(
      { provider: 'jira', env: {} } as never,
      lock,
      resumeInfo,
    );
    log.mockRestore();

    // lock.parentKey || undefined should resolve to undefined
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-42',
      'Add login page',
      'RESUMED',
      3,
      undefined,
    );
  });
});
