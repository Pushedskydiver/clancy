import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { appendProgress, formatTimestamp } from './progress.js';

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
