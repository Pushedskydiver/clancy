import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  appendProgress,
  countReworkCycles,
  findEntriesWithStatus,
  findLastEntry,
  formatTimestamp,
} from './progress.js';

describe('formatTimestamp', () => {
  it('formats a date as YYYY-MM-DD HH:MM in UTC', () => {
    const date = new Date('2024-01-15T14:05:00Z');
    expect(formatTimestamp(date)).toBe('2024-01-15 14:05');
  });

  it('pads single-digit months and days', () => {
    const date = new Date('2024-03-03T09:07:00Z');
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

  it('includes pr:NNN suffix when prNumber is provided', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-10', 'Add feature', 'PR_CREATED', 42);

    const content = readFileSync(join(root, '.clancy', 'progress.txt'), 'utf8');
    expect(content).toContain('PROJ-10 | Add feature | PR_CREATED | pr:42');
  });

  it('produces backward-compatible format without prNumber', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-10', 'Add feature', 'PR_CREATED');

    const content = readFileSync(join(root, '.clancy', 'progress.txt'), 'utf8');
    expect(content).toContain('PROJ-10 | Add feature | PR_CREATED');
    expect(content).not.toContain('pr:');
  });

  it('includes parent:KEY suffix when parent is provided', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-101', 'Add login', 'PR_CREATED', 42, 'PROJ-100');

    const content = readFileSync(join(root, '.clancy', 'progress.txt'), 'utf8');
    expect(content).toContain(
      'PROJ-101 | Add login | PR_CREATED | pr:42 | parent:PROJ-100',
    );
  });

  it('includes parent:KEY without prNumber', () => {
    const root = makeTempRoot();
    appendProgress(
      root,
      'PROJ-101',
      'Add login',
      'DONE',
      undefined,
      'PROJ-100',
    );

    const content = readFileSync(join(root, '.clancy', 'progress.txt'), 'utf8');
    expect(content).toContain('PROJ-101 | Add login | DONE | parent:PROJ-100');
    expect(content).not.toContain('pr:');
  });

  it('omits parent suffix when parent is not provided', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-10', 'Add feature', 'DONE');

    const content = readFileSync(join(root, '.clancy', 'progress.txt'), 'utf8');
    expect(content).not.toContain('parent:');
  });
});

describe('parseProgressFile (via findLastEntry)', () => {
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

  it('parses pr:NNN field from progress entry', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-5', 'Add login', 'PR_CREATED', 99);

    const entry = findLastEntry(root, 'PROJ-5');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('PR_CREATED');
    expect(entry!.prNumber).toBe(99);
    expect(entry!.summary).toBe('Add login');
  });

  it('handles entries without pr:NNN', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-6', 'Fix bug', 'DONE');

    const entry = findLastEntry(root, 'PROJ-6');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('DONE');
    expect(entry!.prNumber).toBeUndefined();
    expect(entry!.summary).toBe('Fix bug');
  });

  it('parses parent:KEY field from progress entry', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-101', 'Add login', 'PR_CREATED', 42, 'PROJ-100');

    const entry = findLastEntry(root, 'PROJ-101');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('PR_CREATED');
    expect(entry!.prNumber).toBe(42);
    expect(entry!.parent).toBe('PROJ-100');
    expect(entry!.summary).toBe('Add login');
  });

  it('parses parent:KEY without pr:NNN', () => {
    const root = makeTempRoot();
    appendProgress(
      root,
      'PROJ-101',
      'Add login',
      'DONE',
      undefined,
      'PROJ-100',
    );

    const entry = findLastEntry(root, 'PROJ-101');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('DONE');
    expect(entry!.prNumber).toBeUndefined();
    expect(entry!.parent).toBe('PROJ-100');
  });

  it('handles legacy entries without parent field', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-5', 'Old task', 'PR_CREATED', 10);

    const entry = findLastEntry(root, 'PROJ-5');
    expect(entry).toBeDefined();
    expect(entry!.parent).toBeUndefined();
    expect(entry!.prNumber).toBe(10);
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

describe('findEntriesWithStatus', () => {
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

  it('returns empty array when file does not exist', () => {
    const root = makeTempRoot();
    expect(findEntriesWithStatus(root, 'PR_CREATED')).toEqual([]);
  });

  it('returns entries with PR_CREATED status', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'Add login', 'PR_CREATED');

    const result = findEntriesWithStatus(root, 'PR_CREATED');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('PROJ-1');
    expect(result[0]!.status).toBe('PR_CREATED');
    expect(result[0]!.summary).toBe('Add login');
  });

  it('does not return entries where a later entry has a different status', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'Add login', 'PR_CREATED');
    appendProgress(root, 'PROJ-1', 'Add login', 'REWORK');

    const result = findEntriesWithStatus(root, 'PR_CREATED');
    expect(result).toHaveLength(0);
  });

  it('returns multiple entries for different ticket keys', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'Add login', 'PR_CREATED');
    appendProgress(root, 'PROJ-2', 'Fix bug', 'PR_CREATED');
    appendProgress(root, 'PROJ-3', 'Refactor', 'DONE');

    const result = findEntriesWithStatus(root, 'PR_CREATED');
    expect(result).toHaveLength(2);

    const keys = result.map((e) => e.key);
    expect(keys).toContain('PROJ-1');
    expect(keys).toContain('PROJ-2');
  });

  it('returns parent field in entries', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-101', 'Add login', 'PR_CREATED', 42, 'PROJ-100');

    const result = findEntriesWithStatus(root, 'PR_CREATED');
    expect(result).toHaveLength(1);
    expect(result[0]!.parent).toBe('PROJ-100');
    expect(result[0]!.prNumber).toBe(42);
  });

  it('matches status case-sensitively', () => {
    const root = makeTempRoot();
    appendProgress(root, 'PROJ-1', 'Add login', 'PR_CREATED');

    // @ts-expect-error — intentionally passing invalid case to verify case-sensitivity
    expect(findEntriesWithStatus(root, 'pr_created')).toHaveLength(0);
    // @ts-expect-error — intentionally passing invalid case to verify case-sensitivity
    expect(findEntriesWithStatus(root, 'Pr_Created')).toHaveLength(0);
    expect(findEntriesWithStatus(root, 'PR_CREATED')).toHaveLength(1);
  });
});
