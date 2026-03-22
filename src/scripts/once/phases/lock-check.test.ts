import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createContext } from '../context/context.js';
import {
  deleteLock,
  deleteVerifyAttempt,
  isLockStale,
  readLock,
} from '../lock/lock.js';
import { detectResume, executeResume } from '../resume/resume.js';
import { lockCheck } from './lock-check.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../lock/lock.js', () => ({
  readLock: vi.fn(() => undefined),
  writeLock: vi.fn(),
  deleteLock: vi.fn(),
  deleteVerifyAttempt: vi.fn(),
  isLockStale: vi.fn(() => true),
}));

vi.mock('../resume/resume.js', () => ({
  detectResume: vi.fn(() => undefined),
  executeResume: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/shared/preflight/preflight.js', () => ({
  runPreflight: vi.fn(() => ({
    ok: true,
    env: {
      JIRA_BASE_URL: 'https://x.atlassian.net',
      JIRA_USER: 'u',
      JIRA_API_TOKEN: 't',
      JIRA_PROJECT_KEY: 'P',
    },
  })),
}));

vi.mock('~/scripts/shared/env-schema/env-schema.js', () => ({
  detectBoard: vi.fn(() => ({
    provider: 'jira',
    env: {
      JIRA_BASE_URL: 'https://x.atlassian.net',
      JIRA_USER: 'u',
      JIRA_API_TOKEN: 't',
      JIRA_PROJECT_KEY: 'P',
    },
  })),
}));

const mockReadLock = vi.mocked(readLock);
const mockIsLockStale = vi.mocked(isLockStale);
const mockDeleteLock = vi.mocked(deleteLock);
const mockDeleteVerifyAttempt = vi.mocked(deleteVerifyAttempt);
const mockDetectResume = vi.mocked(detectResume);
const mockExecuteResume = vi.mocked(executeResume);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('lockCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLockStale.mockReturnValue(true);
    mockDetectResume.mockReturnValue(undefined);
    mockExecuteResume.mockResolvedValue(true);
    delete process.env.CLANCY_AFK_MODE;
  });

  it('returns true when no lock exists', async () => {
    mockReadLock.mockReturnValue(undefined);
    const ctx = createContext([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await lockCheck(ctx);
    log.mockRestore();
    expect(result).toBe(true);
  });

  it('returns false when another active session is running', async () => {
    mockReadLock.mockReturnValue({
      pid: 99999,
      ticketKey: 'PROJ-1',
      ticketTitle: 'T',
      ticketBranch: 'feature/proj-1',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date().toISOString(),
    });
    mockIsLockStale.mockReturnValue(false);

    const ctx = createContext([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await lockCheck(ctx);
    log.mockRestore();

    expect(result).toBe(false);
  });

  it('cleans up stale lock', async () => {
    const staleLock = {
      pid: 11111,
      ticketKey: 'PROJ-2',
      ticketTitle: 'Stale',
      ticketBranch: 'feature/proj-2',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date().toISOString(),
    };
    mockReadLock.mockReturnValue(staleLock);
    mockIsLockStale.mockReturnValue(true);

    const ctx = createContext([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await lockCheck(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(mockDeleteLock).toHaveBeenCalled();
    expect(mockDeleteVerifyAttempt).toHaveBeenCalled();
  });

  it('auto-resumes in AFK mode and returns false', async () => {
    const staleLock = {
      pid: 11111,
      ticketKey: 'PROJ-3',
      ticketTitle: 'Stale AFK',
      ticketBranch: 'feature/proj-3',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date().toISOString(),
    };
    mockReadLock.mockReturnValue(staleLock);
    mockIsLockStale.mockReturnValue(true);
    mockDetectResume.mockReturnValue({
      branch: 'feature/proj-3',
      hasUncommitted: false,
      hasUnpushed: true,
      alreadyDelivered: false,
    });
    mockExecuteResume.mockResolvedValue(true);

    const ctx = createContext([]);
    // Simulate AFK mode
    (ctx as { isAfk: boolean }).isAfk = true;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await lockCheck(ctx);
    log.mockRestore();

    expect(result).toBe(false);
    expect(mockExecuteResume).toHaveBeenCalled();
  });

  it('does not auto-resume outside AFK mode', async () => {
    const staleLock = {
      pid: 22222,
      ticketKey: 'PROJ-4',
      ticketTitle: 'Stale non-AFK',
      ticketBranch: 'feature/proj-4',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date().toISOString(),
    };
    mockReadLock.mockReturnValue(staleLock);
    mockIsLockStale.mockReturnValue(true);
    mockDetectResume.mockReturnValue({
      branch: 'feature/proj-4',
      hasUncommitted: true,
      hasUnpushed: false,
      alreadyDelivered: false,
    });

    const ctx = createContext([]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await lockCheck(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(mockExecuteResume).not.toHaveBeenCalled();
  });

  it('returns true and skips re-processing when ticket was already delivered', async () => {
    const staleLock = {
      pid: 44444,
      ticketKey: 'PROJ-6',
      ticketTitle: 'Already delivered',
      ticketBranch: 'feature/proj-6',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date().toISOString(),
    };
    mockReadLock.mockReturnValue(staleLock);
    mockIsLockStale.mockReturnValue(true);
    mockDetectResume.mockReturnValue({
      branch: 'feature/proj-6',
      hasUncommitted: false,
      hasUnpushed: false,
      alreadyDelivered: true,
    });

    const ctx = createContext([]);
    (ctx as { isAfk: boolean }).isAfk = true;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await lockCheck(ctx);
    log.mockRestore();

    // Should return true (continue to fresh ticket fetch) without executing resume
    expect(result).toBe(true);
    expect(mockExecuteResume).not.toHaveBeenCalled();
  });

  it('returns true for already-delivered in interactive mode too', async () => {
    const staleLock = {
      pid: 55555,
      ticketKey: 'PROJ-7',
      ticketTitle: 'Already delivered interactive',
      ticketBranch: 'feature/proj-7',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date().toISOString(),
    };
    mockReadLock.mockReturnValue(staleLock);
    mockIsLockStale.mockReturnValue(true);
    mockDetectResume.mockReturnValue({
      branch: 'feature/proj-7',
      hasUncommitted: false,
      hasUnpushed: false,
      alreadyDelivered: true,
    });

    const ctx = createContext([]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await lockCheck(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(mockExecuteResume).not.toHaveBeenCalled();
  });

  it('continues when resume detection throws', async () => {
    const staleLock = {
      pid: 33333,
      ticketKey: 'PROJ-5',
      ticketTitle: 'Resume error',
      ticketBranch: 'feature/proj-5',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date().toISOString(),
    };
    mockReadLock.mockReturnValue(staleLock);
    mockIsLockStale.mockReturnValue(true);
    mockDetectResume.mockImplementation(() => {
      throw new Error('resume failed');
    });

    const ctx = createContext([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await lockCheck(ctx);
    log.mockRestore();

    expect(result).toBe(true);
  });
});
