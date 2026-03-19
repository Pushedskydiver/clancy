import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

const HOOK_PATH = resolve(__dirname, 'clancy-post-compact.js');

/** Create a temp directory to act as a fake project root. */
function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `clancy-post-compact-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Run the hook by piping JSON payload to stdin, return stdout. */
function runHook(payload: Record<string, unknown>): string {
  try {
    return execFileSync('node', [HOOK_PATH], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (err: unknown) {
    // process.exit(0) throws in execFileSync when there's no output
    const e = err as { status?: number; stdout?: string };
    if (e.status === 0) return e.stdout || '';
    return '';
  }
}

const LOCK_DATA = {
  pid: process.pid,
  ticketKey: 'PROJ-42',
  ticketTitle: 'Add post-compact hook',
  ticketBranch: 'feature/proj-42',
  targetBranch: 'main',
  parentKey: 'PROJ-10',
  description: 'Implement the PostCompact hook for context restoration.',
  startedAt: new Date().toISOString(),
};

describe('clancy-post-compact', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('outputs additionalContext with ticket info when lock file exists', () => {
    const clancyDir = join(tmpDir, '.clancy');
    mkdirSync(clancyDir, { recursive: true });
    writeFileSync(join(clancyDir, 'lock.json'), JSON.stringify(LOCK_DATA));

    const raw = runHook({ cwd: tmpDir });
    expect(raw).not.toBe('');

    const output = JSON.parse(raw);
    expect(output.additionalContext).toContain('CONTEXT RESTORED');
    expect(output.additionalContext).toContain('PROJ-42');
    expect(output.additionalContext).toContain('Add post-compact hook');
    expect(output.additionalContext).toContain('feature/proj-42');
    expect(output.additionalContext).toContain('targeting main');
    expect(output.additionalContext).toContain('Parent: PROJ-10');
    expect(output.additionalContext).toContain('Continue your implementation');
  });

  it('exits silently when no lock file exists', () => {
    const raw = runHook({ cwd: tmpDir });
    expect(raw.trim()).toBe('');
  });

  it('exits silently with corrupt lock file', () => {
    const clancyDir = join(tmpDir, '.clancy');
    mkdirSync(clancyDir, { recursive: true });
    writeFileSync(join(clancyDir, 'lock.json'), 'not-valid-json!!!');

    const raw = runHook({ cwd: tmpDir });
    expect(raw.trim()).toBe('');
  });

  it('truncates long descriptions to 2000 chars', () => {
    const longDesc = 'A'.repeat(3000);
    const lock = { ...LOCK_DATA, description: longDesc };
    const clancyDir = join(tmpDir, '.clancy');
    mkdirSync(clancyDir, { recursive: true });
    writeFileSync(join(clancyDir, 'lock.json'), JSON.stringify(lock));

    const raw = runHook({ cwd: tmpDir });
    const output = JSON.parse(raw);
    // The description in context should be truncated
    const descMatch = output.additionalContext.match(/Requirements: (A+)/);
    expect(descMatch).not.toBeNull();
    expect(descMatch![1].length).toBe(2000);
  });

  it('omits parent line when parentKey is "none"', () => {
    const lock = { ...LOCK_DATA, parentKey: 'none' };
    const clancyDir = join(tmpDir, '.clancy');
    mkdirSync(clancyDir, { recursive: true });
    writeFileSync(join(clancyDir, 'lock.json'), JSON.stringify(lock));

    const raw = runHook({ cwd: tmpDir });
    const output = JSON.parse(raw);
    expect(output.additionalContext).not.toContain('Parent:');
  });

  it('omits requirements line when description is empty', () => {
    const lock = { ...LOCK_DATA, description: '' };
    const clancyDir = join(tmpDir, '.clancy');
    mkdirSync(clancyDir, { recursive: true });
    writeFileSync(join(clancyDir, 'lock.json'), JSON.stringify(lock));

    const raw = runHook({ cwd: tmpDir });
    const output = JSON.parse(raw);
    expect(output.additionalContext).not.toContain('Requirements:');
    // Should still have the core context
    expect(output.additionalContext).toContain('PROJ-42');
  });

  it('omits requirements line when description is undefined', () => {
    const { description: _, ...lockNoDesc } = LOCK_DATA;
    const clancyDir = join(tmpDir, '.clancy');
    mkdirSync(clancyDir, { recursive: true });
    writeFileSync(join(clancyDir, 'lock.json'), JSON.stringify(lockNoDesc));

    const raw = runHook({ cwd: tmpDir });
    const output = JSON.parse(raw);
    expect(output.additionalContext).not.toContain('Requirements:');
    expect(output.additionalContext).toContain('PROJ-42');
  });
});
