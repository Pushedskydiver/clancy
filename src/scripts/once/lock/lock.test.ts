import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LockData } from './lock.js';
import {
  deleteLock,
  deleteVerifyAttempt,
  isLockStale,
  isPidAlive,
  readLock,
  writeLock,
} from './lock.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const dirs: string[] = [];

function makeTempRoot(): string {
  const dir = join(tmpdir(), `clancy-lock-test-${randomUUID()}`);
  mkdirSync(join(dir, '.clancy'), { recursive: true });
  dirs.push(dir);
  return dir;
}

function makeLockData(overrides: Partial<LockData> = {}): LockData {
  return {
    pid: process.pid,
    ticketKey: 'PROJ-42',
    ticketTitle: 'Add login page',
    ticketBranch: 'feature/proj-42',
    targetBranch: 'main',
    parentKey: '',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
  vi.restoreAllMocks();
});

// ─── writeLock ───────────────────────────────────────────────────────────────

describe('writeLock', () => {
  it('creates the file with correct JSON', () => {
    const root = makeTempRoot();
    const data = makeLockData();

    writeLock(root, data);

    const content = readFileSync(join(root, '.clancy', 'lock.json'), 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(data);
  });

  it('creates .clancy directory if it does not exist', () => {
    const root = join(tmpdir(), `clancy-lock-test-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    dirs.push(root);

    writeLock(root, makeLockData());

    expect(existsSync(join(root, '.clancy', 'lock.json'))).toBe(true);
  });
});

// ─── readLock ────────────────────────────────────────────────────────────────

describe('readLock', () => {
  it('reads lock data correctly', () => {
    const root = makeTempRoot();
    const data = makeLockData();
    writeLock(root, data);

    const result = readLock(root);

    expect(result).toEqual(data);
  });

  it('returns undefined for missing file', () => {
    const root = makeTempRoot();

    expect(readLock(root)).toBeUndefined();
  });

  it('returns undefined for corrupt JSON', () => {
    const root = makeTempRoot();
    writeFileSync(join(root, '.clancy', 'lock.json'), '{ bad json', 'utf8');

    expect(readLock(root)).toBeUndefined();
  });
});

// ─── deleteLock ──────────────────────────────────────────────────────────────

describe('deleteLock', () => {
  it('removes the file', () => {
    const root = makeTempRoot();
    writeLock(root, makeLockData());

    deleteLock(root);

    expect(existsSync(join(root, '.clancy', 'lock.json'))).toBe(false);
  });

  it('is safe when file does not exist', () => {
    const root = makeTempRoot();

    expect(() => deleteLock(root)).not.toThrow();
  });
});

// ─── deleteVerifyAttempt ─────────────────────────────────────────────────────

describe('deleteVerifyAttempt', () => {
  it('removes the file', () => {
    const root = makeTempRoot();
    writeFileSync(join(root, '.clancy', 'verify-attempt.txt'), '1', 'utf8');

    deleteVerifyAttempt(root);

    expect(existsSync(join(root, '.clancy', 'verify-attempt.txt'))).toBe(false);
  });

  it('is safe when file does not exist', () => {
    const root = makeTempRoot();

    expect(() => deleteVerifyAttempt(root)).not.toThrow();
  });
});

// ─── isPidAlive ──────────────────────────────────────────────────────────────

describe('isPidAlive', () => {
  it('returns true for current process', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('returns false for a dead PID', () => {
    expect(isPidAlive(999999)).toBe(false);
  });
});

// ─── isLockStale ─────────────────────────────────────────────────────────────

describe('isLockStale', () => {
  it('returns true when PID is dead', () => {
    const lock = makeLockData({ pid: 999999 });

    expect(isLockStale(lock)).toBe(true);
  });

  it('returns true when lock is older than 24 hours', () => {
    const twentyFiveHoursAgo = new Date(
      Date.now() - 25 * 60 * 60 * 1000,
    ).toISOString();
    const lock = makeLockData({ startedAt: twentyFiveHoursAgo });

    // PID is alive (process.pid) but lock is stale by age
    expect(isLockStale(lock)).toBe(true);
  });

  it('returns false when PID is alive and lock is recent', () => {
    const lock = makeLockData();

    expect(isLockStale(lock)).toBe(false);
  });
});
