import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appendCostEntry } from './cost.js';

describe('appendCostEntry', () => {
  const dirs: string[] = [];

  function makeTempRoot(): string {
    const dir = join(tmpdir(), `clancy-cost-test-${randomUUID()}`);
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('creates costs.log and writes an entry', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.clancy'), { recursive: true });

    const startedAt = new Date(Date.now() - 5 * 60000).toISOString();
    appendCostEntry(root, 'PROJ-101', startedAt);

    const content = readFileSync(join(root, '.clancy', 'costs.log'), 'utf8');
    expect(content).toContain('PROJ-101');
    expect(content).toContain('tokens (estimated)');
  });

  it('entry format matches: ISO timestamp | key | Nmin | ~N tokens (estimated)', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.clancy'), { recursive: true });

    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    appendCostEntry(root, 'TICKET-42', fiveMinAgo);

    const content = readFileSync(join(root, '.clancy', 'costs.log'), 'utf8');
    const line = content.trim();
    // Format: ISO | KEY | Nmin | ~N tokens (estimated)
    expect(line).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z \| TICKET-42 \| \d+min \| ~\d+ tokens \(estimated\)$/,
    );
  });

  it('calculates duration from startedAt to now', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.clancy'), { recursive: true });

    const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
    appendCostEntry(root, 'PROJ-1', tenMinAgo);

    const content = readFileSync(join(root, '.clancy', 'costs.log'), 'utf8');
    expect(content).toContain('10min');
  });

  it('applies custom token rate correctly', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.clancy'), { recursive: true });

    const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
    appendCostEntry(root, 'PROJ-2', tenMinAgo, 1000);

    const content = readFileSync(join(root, '.clancy', 'costs.log'), 'utf8');
    // 10 min * 1000 tokens/min = 10000 tokens
    expect(content).toContain('~10000 tokens (estimated)');
  });

  it('uses default token rate of 6600', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.clancy'), { recursive: true });

    const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
    appendCostEntry(root, 'PROJ-3', tenMinAgo);

    const content = readFileSync(join(root, '.clancy', 'costs.log'), 'utf8');
    // 10 min * 6600 tokens/min = 66000 tokens
    expect(content).toContain('~66000 tokens (estimated)');
  });

  it('appends multiple entries without overwriting', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.clancy'), { recursive: true });

    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    const twoMinAgo = new Date(Date.now() - 2 * 60000).toISOString();

    appendCostEntry(root, 'PROJ-A', fiveMinAgo);
    appendCostEntry(root, 'PROJ-B', twoMinAgo);

    const content = readFileSync(join(root, '.clancy', 'costs.log'), 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('PROJ-A');
    expect(lines[1]).toContain('PROJ-B');
  });

  it('produces 0min duration for invalid startedAt (does not crash)', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.clancy'), { recursive: true });

    appendCostEntry(root, 'BAD-1', 'not-a-date');

    const content = readFileSync(join(root, '.clancy', 'costs.log'), 'utf8');
    expect(content).toContain('BAD-1');
    expect(content).toContain('0min');
    expect(content).toContain('~0 tokens (estimated)');
  });

  it('creates .clancy directory if missing', () => {
    const root = makeTempRoot();
    // Intentionally NOT creating .clancy directory

    const startedAt = new Date(Date.now() - 3 * 60000).toISOString();
    appendCostEntry(root, 'PROJ-NEW', startedAt);

    const content = readFileSync(join(root, '.clancy', 'costs.log'), 'utf8');
    expect(content).toContain('PROJ-NEW');
  });
});
