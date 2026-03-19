import { describe, expect, it, vi } from 'vitest';

import { createContext } from '../context/context.js';
import { dryRun } from './dry-run.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('dryRun', () => {
  it('returns true when not in dry-run mode', () => {
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'T',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };
    ctx.ticketBranch = 'feature/proj-1';
    ctx.targetBranch = 'main';

    const result = dryRun(ctx);
    expect(result).toBe(true);
  });

  it('returns false in dry-run mode and prints ticket info', () => {
    const ctx = createContext(['--dry-run']);
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

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = dryRun(ctx);
    log.mockRestore();

    expect(result).toBe(false);
  });

  it('shows rework mode in dry-run output', () => {
    const ctx = createContext(['--dry-run']);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-2',
      title: 'Rework',
      description: '',
      parentInfo: 'none',
      blockers: 'None',
    };
    ctx.ticketBranch = 'feature/proj-2';
    ctx.targetBranch = 'main';
    ctx.isRework = true;

    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    dryRun(ctx);
    log.mockRestore();

    expect(logs.some((l) => l.includes('Rework'))).toBe(true);
  });

  it('uses Milestone label for github provider', () => {
    const ctx = createContext(['--dry-run']);
    ctx.config = { provider: 'github', env: {} } as never;
    ctx.ticket = {
      key: '#1',
      title: 'T',
      description: '',
      parentInfo: 'none',
      blockers: 'None',
    };
    ctx.ticketBranch = 'feature/issue-1';
    ctx.targetBranch = 'main';

    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    dryRun(ctx);
    log.mockRestore();

    expect(logs.some((l) => l.includes('Milestone'))).toBe(true);
  });
});
