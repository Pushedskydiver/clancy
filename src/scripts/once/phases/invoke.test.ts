import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeClaudeSession } from '~/scripts/shared/claude-cli/claude-cli.js';
import { diffAgainstBranch } from '~/scripts/shared/git-ops/git-ops.js';
import {
  buildPrompt,
  buildReworkPrompt,
} from '~/scripts/shared/prompt/prompt.js';

import { createContext } from '../context/context.js';
import { invoke } from './invoke.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/claude-cli/claude-cli.js', () => ({
  invokeClaudeSession: vi.fn(() => true),
}));

vi.mock('~/scripts/shared/git-ops/git-ops.js', () => ({
  diffAgainstBranch: vi.fn(() => 'diff output'),
}));

vi.mock('~/scripts/shared/prompt/prompt.js', () => ({
  buildPrompt: vi.fn(() => 'fresh prompt'),
  buildReworkPrompt: vi.fn(() => 'rework prompt'),
}));

const mockInvoke = vi.mocked(invokeClaudeSession);
const mockBuildPrompt = vi.mocked(buildPrompt);
const mockBuildReworkPrompt = vi.mocked(buildReworkPrompt);
const mockDiff = vi.mocked(diffAgainstBranch);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('invoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReturnValue(true);
  });

  afterEach(() => {
    delete process.env.CLANCY_ONCE_ACTIVE;
  });

  function makeCtx(overrides: Record<string, unknown> = {}) {
    const ctx = createContext([]);
    ctx.config = {
      provider: 'jira',
      env: { CLANCY_TDD: 'false' },
    } as never;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'T',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };
    ctx.targetBranch = 'main';
    Object.assign(ctx, overrides);
    return ctx;
  }

  it('returns true when Claude session succeeds', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = invoke(makeCtx());
    log.mockRestore();

    expect(result).toBe(true);
    expect(mockBuildPrompt).toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalled();
  });

  it('returns false when Claude session fails', () => {
    mockInvoke.mockReturnValue(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = invoke(makeCtx());
    log.mockRestore();

    expect(result).toBe(false);
  });

  it('uses rework prompt when isRework is true', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    invoke(makeCtx({ isRework: true, prFeedback: ['fix tests'] }));
    log.mockRestore();

    expect(mockBuildReworkPrompt).toHaveBeenCalled();
    expect(mockDiff).toHaveBeenCalledWith('main');
    expect(mockBuildPrompt).not.toHaveBeenCalled();
  });

  it('sets and clears CLANCY_ONCE_ACTIVE', () => {
    let envDuringCall: string | undefined;
    mockInvoke.mockImplementation(() => {
      envDuringCall = process.env.CLANCY_ONCE_ACTIVE;
      return true;
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    invoke(makeCtx());
    log.mockRestore();

    expect(envDuringCall).toBe('1');
    expect(process.env.CLANCY_ONCE_ACTIVE).toBeUndefined();
  });

  it('clears CLANCY_ONCE_ACTIVE even when Claude throws', () => {
    mockInvoke.mockImplementation(() => {
      throw new Error('boom');
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => invoke(makeCtx())).toThrow('boom');
    log.mockRestore();

    expect(process.env.CLANCY_ONCE_ACTIVE).toBeUndefined();
  });

  it('passes tdd flag from config', () => {
    const ctx = makeCtx();
    (ctx.config as { env: Record<string, string> }).env.CLANCY_TDD = 'true';

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    invoke(ctx);
    log.mockRestore();

    expect(mockBuildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ tdd: true }),
    );
  });
});
