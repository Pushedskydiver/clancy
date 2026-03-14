import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  appendProgress,
  countReworkCycles,
  findLastEntry,
  formatTimestamp,
} from './progress.js';

describe('formatTimestamp', () => {
  it('formats a date as YYYY-MM-DD HH:MM', () => {
    const date = new Date(2024, 0, 15, 14, 5); // Jan 15, 2024 14:05
    expect(formatTimestamp(date)).toBe('2024-01-15 14:05');
  });

  it('pads single-digit months and days', () => {
    const date = new Date(2024, 2, 3, 9, 7); // Mar 3, 2024 09:07
    expect(formatTimestamp(date)).toBe('2024-03-03 09:07');
  });
});

describe('appendProgress', () => {
  const dirs: string[] = [];

  function makeTempRoot(): string {
    const dir = join(tmpdir(), `clancy-progress-test-${randomUUID()}`);
    mkdirSync(join(dir, '.clancy'), { recursive: true });
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('creates progress.txt and appends entry', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-123', 'Add login page', 'DONE');

    const content = readFileSync(join(root, '.clancy', 'progress.txt'), 'utf8');
    expect(content).toContain('PROJ-123 | Add login page | DONE');
  });

  it('appends multiple entries', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'First', 'DONE');
    appendProgress(root, 'PROJ-2', 'Second', 'SKIPPED');

    const content = readFileSync(join(root, '.clancy', 'progress.txt'), 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('PROJ-1 | First | DONE');
    expect(lines[1]).toContain('PROJ-2 | Second | SKIPPED');
  });

  it('creates .clancy directory if it does not exist', () => {
    const root = join(tmpdir(), `clancy-progress-test-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    dirs.push(root);

    appendProgress(root, '#42', 'Fix bug', 'DONE');

    const content = readFileSync(join(root, '.clancy', 'progress.txt'), 'utf8');
    expect(content).toContain('#42 | Fix bug | DONE');
  });
});

describe('findLastEntry', () => {
  const dirs: string[] = [];

  function makeTempRoot(): string {
    const dir = join(tmpdir(), `clancy-progress-test-${randomUUID()}`);
    mkdirSync(join(dir, '.clancy'), { recursive: true });
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('returns undefined when file does not exist', () => {
    const root = makeTempRoot();
    expect(findLastEntry(root, 'PROJ-1')).toBeUndefined();
  });

  it('returns undefined when key is not found', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'First task', 'DONE');

    expect(findLastEntry(root, 'PROJ-999')).toBeUndefined();
  });

  it('returns the last entry when multiple entries exist for the same key', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'First attempt', 'DONE');
    appendProgress(root, 'PROJ-2', 'Other task', 'DONE');
    appendProgress(root, 'PROJ-1', 'Second attempt', 'REWORK');

    const entry = findLastEntry(root, 'PROJ-1');
    expect(entry).toBeDefined();
    expect(entry!.summary).toBe('Second attempt');
    expect(entry!.status).toBe('REWORK');
    expect(entry!.key).toBe('PROJ-1');
  });

  it('matches keys case-insensitively', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'Some task', 'DONE');

    const entry = findLastEntry(root, 'proj-1');
    expect(entry).toBeDefined();
    expect(entry!.key).toBe('PROJ-1');
  });

  it('handles different statuses', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'Task', 'SKIPPED');

    const entry = findLastEntry(root, 'PROJ-1');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('SKIPPED');
  });
});

describe('countReworkCycles', () => {
  const dirs: string[] = [];

  function makeTempRoot(): string {
    const dir = join(tmpdir(), `clancy-progress-test-${randomUUID()}`);
    mkdirSync(join(dir, '.clancy'), { recursive: true });
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('returns 0 when file does not exist', () => {
    const root = makeTempRoot();
    expect(countReworkCycles(root, 'PROJ-1')).toBe(0);
  });

  it('returns 0 when no REWORK entries exist', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'First', 'DONE');
    appendProgress(root, 'PROJ-1', 'Second', 'SKIPPED');

    expect(countReworkCycles(root, 'PROJ-1')).toBe(0);
  });

  it('returns correct count with mixed statuses', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'Attempt 1', 'DONE');
    appendProgress(root, 'PROJ-1', 'Rework 1', 'REWORK');
    appendProgress(root, 'PROJ-2', 'Other rework', 'REWORK');
    appendProgress(root, 'PROJ-1', 'Rework 2', 'REWORK');
    appendProgress(root, 'PROJ-1', 'Final', 'DONE');

    expect(countReworkCycles(root, 'PROJ-1')).toBe(2);
  });

  it('matches keys case-insensitively', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'Rework', 'REWORK');

    expect(countReworkCycles(root, 'proj-1')).toBe(1);
  });
});
