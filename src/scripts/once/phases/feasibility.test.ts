import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkFeasibility } from '~/scripts/shared/feasibility/feasibility.js';
import { appendProgress } from '~/scripts/shared/progress/progress.js';

import { createContext } from '../context/context.js';
import { feasibility } from './feasibility.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/feasibility/feasibility.js', () => ({
  checkFeasibility: vi.fn(() => ({ feasible: true })),
}));

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  appendProgress: vi.fn(),
}));

const mockCheckFeasibility = vi.mocked(checkFeasibility);
const mockAppendProgress = vi.mocked(appendProgress);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('feasibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckFeasibility.mockReturnValue({ feasible: true });
  });

  it('returns true when feasibility passes', () => {
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'T',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = feasibility(ctx);
    log.mockRestore();

    expect(result).toBe(true);
  });

  it('returns false when ticket is not feasible', () => {
    mockCheckFeasibility.mockReturnValue({
      feasible: false,
      reason: 'needs admin',
    });

    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-2',
      title: 'T2',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = feasibility(ctx);
    log.mockRestore();

    expect(result).toBe(false);
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-2',
      'T2',
      'SKIPPED',
    );
  });

  it('skips check for rework tickets', () => {
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-3',
      title: 'T3',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };
    ctx.isRework = true;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = feasibility(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(mockCheckFeasibility).not.toHaveBeenCalled();
  });

  it('skips check when --skip-feasibility is passed', () => {
    const ctx = createContext(['--skip-feasibility']);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-4',
      title: 'T4',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = feasibility(ctx);
    log.mockRestore();

    expect(result).toBe(true);
    expect(mockCheckFeasibility).not.toHaveBeenCalled();
  });
});
