/**
 * Lock file management for `.clancy/lock.json`.
 *
 * Prevents double-runs and provides context for hooks
 * (PostCompact, time guard, cost tracker).
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type LockData = {
  pid: number;
  ticketKey: string;
  ticketTitle: string;
  ticketBranch: string;
  targetBranch: string;
  parentKey: string;
  startedAt: string; // ISO 8601
};

export function writeLock(projectRoot: string, data: LockData): void {
  const filePath = join(projectRoot, '.clancy', 'lock.json');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function readLock(projectRoot: string): LockData | undefined {
  const filePath = join(projectRoot, '.clancy', 'lock.json');
  try {
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as LockData;
  } catch {
    return undefined;
  }
}

export function deleteLock(projectRoot: string): void {
  const filePath = join(projectRoot, '.clancy', 'lock.json');
  try {
    unlinkSync(filePath);
  } catch {
    // File may not exist — that's fine
  }
}

export function deleteVerifyAttempt(projectRoot: string): void {
  const filePath = join(projectRoot, '.clancy', 'verify-attempt.txt');
  try {
    unlinkSync(filePath);
  } catch {
    // File may not exist — that's fine
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = no-op, just checks if process exists
    return true;
  } catch (err: unknown) {
    // EPERM means the process exists but we lack permission to signal it — still alive
    if (err instanceof Error && 'code' in err && err.code === 'EPERM')
      return true;
    return false;
  }
}

export function isLockStale(lock: LockData): boolean {
  // If PID is dead, lock is stale
  if (!isPidAlive(lock.pid)) return true;

  // If PID is alive but lock is older than 24 hours, treat as PID reuse.
  // Note: PID reuse can happen faster on busy systems, but 24h is a practical
  // threshold — Clancy sessions never run that long. A false negative here means
  // the user sees "another session is running" and must manually delete lock.json.
  const lockAge = Date.now() - new Date(lock.startedAt).getTime();
  if (Number.isNaN(lockAge)) return true; // Invalid timestamp — can't trust it

  const twentyFourHours = 24 * 60 * 60 * 1000;
  if (lockAge > twentyFourHours) return true;

  return false;
}
