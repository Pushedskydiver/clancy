import { describe, expect, it, vi } from 'vitest';

import {
  buildFeasibilityPrompt,
  checkFeasibility,
  parseFeasibilityResponse,
} from './feasibility.js';

vi.mock('~/scripts/shared/claude-cli/claude-cli.js', () => ({
  invokeClaudePrint: vi.fn(() => ({ stdout: 'FEASIBLE', ok: true })),
}));

describe('buildFeasibilityPrompt', () => {
  it('includes ticket key, title, and description', () => {
    const prompt = buildFeasibilityPrompt({
      key: 'PROJ-1',
      title: 'Add login button',
      description: 'Add a login button to the header.',
    });

    expect(prompt).toContain('[PROJ-1] Add login button');
    expect(prompt).toContain('Add a login button to the header.');
  });
});

describe('parseFeasibilityResponse', () => {
  it('returns feasible for FEASIBLE response', () => {
    expect(parseFeasibilityResponse('FEASIBLE')).toEqual({ feasible: true });
  });

  it('returns feasible for FEASIBLE with extra whitespace', () => {
    expect(parseFeasibilityResponse('  FEASIBLE  \n')).toEqual({
      feasible: true,
    });
  });

  it('returns infeasible with reason', () => {
    const result = parseFeasibilityResponse(
      'INFEASIBLE: requires OneTrust admin access',
    );
    expect(result).toEqual({
      feasible: false,
      reason: 'requires OneTrust admin access',
    });
  });

  it('returns infeasible without reason when none given', () => {
    expect(parseFeasibilityResponse('INFEASIBLE')).toEqual({
      feasible: false,
      reason: undefined,
    });
  });

  it('is case-insensitive', () => {
    expect(parseFeasibilityResponse('infeasible: reason')).toEqual({
      feasible: false,
      reason: 'reason',
    });
  });

  it('fails open on empty output', () => {
    expect(parseFeasibilityResponse('')).toEqual({ feasible: true });
  });

  it('fails open on malformed output', () => {
    expect(parseFeasibilityResponse('I think this is feasible')).toEqual({
      feasible: true,
    });
  });

  it('uses last line of multi-line output', () => {
    const output = 'Some preamble\nINFEASIBLE: needs manual testing';
    expect(parseFeasibilityResponse(output)).toEqual({
      feasible: false,
      reason: 'needs manual testing',
    });
  });
});

describe('checkFeasibility', () => {
  it('returns feasible when Claude says FEASIBLE', async () => {
    const { invokeClaudePrint } =
      await import('~/scripts/shared/claude-cli/claude-cli.js');
    vi.mocked(invokeClaudePrint).mockReturnValue({
      stdout: 'FEASIBLE',
      ok: true,
    });

    const result = checkFeasibility({
      key: 'PROJ-1',
      title: 'Test',
      description: 'desc',
    });
    expect(result).toEqual({ feasible: true });
  });

  it('returns infeasible when Claude says INFEASIBLE', async () => {
    const { invokeClaudePrint } =
      await import('~/scripts/shared/claude-cli/claude-cli.js');
    vi.mocked(invokeClaudePrint).mockReturnValue({
      stdout: 'INFEASIBLE: requires external API',
      ok: true,
    });

    const result = checkFeasibility({
      key: 'PROJ-1',
      title: 'Test',
      description: 'desc',
    });
    expect(result).toEqual({
      feasible: false,
      reason: 'requires external API',
    });
  });

  it('fails open when Claude process fails', async () => {
    const { invokeClaudePrint } =
      await import('~/scripts/shared/claude-cli/claude-cli.js');
    vi.mocked(invokeClaudePrint).mockReturnValue({ stdout: '', ok: false });

    const result = checkFeasibility({
      key: 'PROJ-1',
      title: 'Test',
      description: 'desc',
    });
    expect(result).toEqual({ feasible: true });
  });

  it('passes model to invokeClaudePrint', async () => {
    const { invokeClaudePrint } =
      await import('~/scripts/shared/claude-cli/claude-cli.js');
    vi.mocked(invokeClaudePrint).mockReturnValue({
      stdout: 'FEASIBLE',
      ok: true,
    });

    checkFeasibility(
      { key: 'PROJ-1', title: 'Test', description: 'desc' },
      'sonnet',
    );

    expect(invokeClaudePrint).toHaveBeenCalledWith(
      expect.any(String),
      'sonnet',
    );
  });
});
