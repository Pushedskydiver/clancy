import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkout,
  currentBranch,
  ensureBranch,
  fetchRemoteBranch,
} from '~/scripts/shared/git-ops/git-ops.js';

import { fetchEpicChildrenStatus } from '../board-ops/board-ops.js';
import { createContext } from '../context/context.js';
import { ensureEpicBranch } from '../deliver/deliver.js';
import { writeLock } from '../lock/lock.js';
import { branchSetup } from './branch-setup.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/git-ops/git-ops.js', () => ({
  checkout: vi.fn(),
  currentBranch: vi.fn(() => 'main'),
  ensureBranch: vi.fn(),
  fetchRemoteBranch: vi.fn(() => true),
}));

vi.mock('../board-ops/board-ops.js', () => ({
  fetchEpicChildrenStatus: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../deliver/deliver.js', () => ({
  ensureEpicBranch: vi.fn(() => true),
}));

vi.mock('../lock/lock.js', () => ({
  writeLock: vi.fn(),
}));

const mockCurrentBranch = vi.mocked(currentBranch);
const mockCheckout = vi.mocked(checkout);
const mockEnsureBranch = vi.mocked(ensureBranch);
const mockFetchRemoteBranch = vi.mocked(fetchRemoteBranch);
const mockFetchChildren = vi.mocked(fetchEpicChildrenStatus);
const mockEnsureEpicBranch = vi.mocked(ensureEpicBranch);
const mockWriteLock = vi.mocked(writeLock);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(overrides: Record<string, unknown> = {}) {
  const ctx = createContext([]);
  ctx.config = { provider: 'jira', env: {} } as never;
  ctx.ticket = {
    key: 'PROJ-1',
    title: 'Test',
    description: 'desc',
    parentInfo: 'PROJ-100',
    blockers: 'None',
  };
  ctx.ticketBranch = 'feature/proj-1';
  ctx.targetBranch = 'epic/proj-100';
  ctx.baseBranch = 'main';
  ctx.hasParent = true;
  Object.assign(ctx, overrides);
  return ctx;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('branchSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentBranch.mockReturnValue('main');
    mockFetchRemoteBranch.mockReturnValue(true);
    mockEnsureEpicBranch.mockReturnValue(true);
    mockFetchChildren.mockResolvedValue(undefined);
  });

  it('sets originalBranch from currentBranch', async () => {
    mockCurrentBranch.mockReturnValue('develop');

    const ctx = makeCtx();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await branchSetup(ctx);
    log.mockRestore();

    expect(ctx.originalBranch).toBe('develop');
  });

  it('creates epic branch for parented ticket', async () => {
    const ctx = makeCtx();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await branchSetup(ctx);
    log.mockRestore();

    expect(mockEnsureEpicBranch).toHaveBeenCalledWith('epic/proj-100', 'main');
    expect(mockCheckout).toHaveBeenCalledWith('epic/proj-100');
    expect(mockCheckout).toHaveBeenCalledWith('feature/proj-1', true);
  });

  it('branches from base for standalone ticket', async () => {
    const ctx = makeCtx({
      hasParent: false,
      ticket: {
        key: 'PROJ-2',
        title: 'Standalone',
        description: '',
        parentInfo: 'none',
        blockers: 'None',
      },
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await branchSetup(ctx);
    log.mockRestore();

    expect(mockEnsureBranch).toHaveBeenCalledWith('main', 'main');
    expect(mockCheckout).toHaveBeenCalledWith('main');
  });

  it('writes lock file and sets lockOwner', async () => {
    const ctx = makeCtx();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await branchSetup(ctx);
    log.mockRestore();

    expect(ctx.lockOwner).toBe(true);
    expect(mockWriteLock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        ticketKey: 'PROJ-1',
        ticketBranch: 'feature/proj-1',
      }),
    );
  });

  it('returns false when epic branch setup fails', async () => {
    mockEnsureEpicBranch.mockReturnValue(false);

    const ctx = makeCtx();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await branchSetup(ctx);
    log.mockRestore();

    expect(result).toBe(false);
    expect(mockCheckout).toHaveBeenCalledWith('main'); // restore original branch
  });

  it('skips epic branch for single-child epic', async () => {
    mockFetchChildren.mockResolvedValue({ total: 1, incomplete: 1 });

    const ctx = makeCtx();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await branchSetup(ctx);
    log.mockRestore();

    expect(ctx.skipEpicBranch).toBe(true);
    expect(ctx.effectiveTarget).toBe('main');
    expect(mockEnsureBranch).toHaveBeenCalledWith('main', 'main');
  });

  it('fetches remote branch for rework', async () => {
    const ctx = makeCtx({ isRework: true, hasParent: false });
    ctx.ticket!.parentInfo = 'none';

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await branchSetup(ctx);
    log.mockRestore();

    expect(mockFetchRemoteBranch).toHaveBeenCalledWith('feature/proj-1');
    expect(mockCheckout).toHaveBeenCalledWith('feature/proj-1');
  });

  it('creates fresh branch when remote rework branch is missing', async () => {
    mockFetchRemoteBranch.mockReturnValue(false);

    const ctx = makeCtx({ isRework: true, hasParent: false });
    ctx.ticket!.parentInfo = 'none';

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await branchSetup(ctx);
    log.mockRestore();

    expect(mockCheckout).toHaveBeenCalledWith('main');
    expect(mockCheckout).toHaveBeenCalledWith('feature/proj-1', true);
  });

  it('continues without crash when writeLock throws', async () => {
    mockWriteLock.mockImplementation(() => {
      throw new Error('disk full');
    });

    const ctx = makeCtx();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await branchSetup(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(ctx.lockOwner).toBeUndefined();
  });
});
