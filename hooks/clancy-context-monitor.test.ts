import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK_PATH = resolve(__dirname, 'clancy-context-monitor.js');

const SESSION = `test-ctx-monitor-${process.pid}`;

/** Paths the hook reads/writes in tmpdir. */
const bridgePath = join(tmpdir(), `clancy-ctx-${SESSION}.json`);
const warnPath = join(tmpdir(), `clancy-ctx-${SESSION}-warned.json`);

/** A temp project dir for lock.json. */
const projectDir = join(tmpdir(), `clancy-ctx-test-project-${process.pid}`);
const lockDir = join(projectDir, '.clancy');
const lockPath = join(lockDir, 'lock.json');

/** Write the bridge file (context metrics). */
function writeBridge(remaining: number, usedPct: number): void {
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(bridgePath, JSON.stringify({
    remaining_percentage: remaining,
    used_pct: usedPct,
    timestamp: now,
  }));
}

/** Write the lock file with a startedAt timestamp. */
function writeLock(startedAt: string): void {
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    ticketKey: 'TEST-1',
    ticketTitle: 'Test ticket',
    ticketBranch: 'feature/test-1',
    targetBranch: 'main',
    parentKey: '',
    startedAt,
  }));
}

/** Run the hook via execFileSync with stdin piped via `input`. */
function runHook(env: Record<string, string> = {}): string {
  const payload = JSON.stringify({ session_id: SESSION, cwd: projectDir });
  try {
    return execFileSync('node', [HOOK_PATH], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 5000,
    });
  } catch (err: unknown) {
    // process.exit(0) throws in execFileSync when there's no output
    const e = err as { status?: number; stdout?: string };
    if (e.status === 0) return e.stdout || '';
    return '';
  }
}

/** Helper: get additionalContext string or empty. */
function getContext(env: Record<string, string> = {}): string {
  const raw = runHook(env).trim();
  if (!raw) return '';
  try {
    const result = JSON.parse(raw);
    return result?.hookSpecificOutput?.additionalContext ?? '';
  } catch {
    return '';
  }
}

beforeEach(() => {
  // Clean up all state files
  for (const p of [bridgePath, warnPath, lockPath]) {
    if (existsSync(p)) rmSync(p);
  }
  mkdirSync(lockDir, { recursive: true });
});

afterEach(() => {
  for (const p of [bridgePath, warnPath]) {
    if (existsSync(p)) rmSync(p);
  }
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
});

// ── Context guard (existing behaviour) ────────────────────────

describe('context guard', () => {
  it('emits warning when remaining <= 35%', () => {
    writeBridge(30, 70);
    const ctx = getContext();
    expect(ctx).toContain('CONTEXT WARNING');
    expect(ctx).toContain('70%');
  });

  it('emits critical when remaining <= 25%', () => {
    writeBridge(20, 80);
    const ctx = getContext();
    expect(ctx).toContain('CONTEXT CRITICAL');
    expect(ctx).toContain('80%');
  });

  it('emits nothing when remaining > 35%', () => {
    writeBridge(50, 50);
    const ctx = getContext();
    expect(ctx).toBe('');
  });
});

// ── Time guard ────────────────────────────────────────────────

describe('time guard', () => {
  it('emits time warning at 80% of limit', () => {
    writeBridge(50, 50); // context OK — no context warning
    // 25 min ago with 30 min limit = 83%
    const startedAt = new Date(Date.now() - 25 * 60000).toISOString();
    writeLock(startedAt);

    const ctx = getContext();
    expect(ctx).toContain('TIME WARNING');
    expect(ctx).toContain('25min of 30min');
    expect(ctx).not.toContain('CONTEXT');
  });

  it('emits time critical at 100% of limit', () => {
    writeBridge(50, 50);
    // 32 min ago with 30 min limit = 106%
    const startedAt = new Date(Date.now() - 32 * 60000).toISOString();
    writeLock(startedAt);

    const ctx = getContext();
    expect(ctx).toContain('TIME CRITICAL');
    expect(ctx).toContain('32min of 30min');
    expect(ctx).not.toContain('CONTEXT');
  });

  it('emits nothing below 80% of limit', () => {
    writeBridge(50, 50);
    // 10 min ago with 30 min limit = 33%
    const startedAt = new Date(Date.now() - 10 * 60000).toISOString();
    writeLock(startedAt);

    const ctx = getContext();
    expect(ctx).toBe('');
  });

  it('is disabled when CLANCY_TIME_LIMIT=0', () => {
    writeBridge(50, 50);
    // 60 min ago — would be over limit
    const startedAt = new Date(Date.now() - 60 * 60000).toISOString();
    writeLock(startedAt);

    const ctx = getContext({ CLANCY_TIME_LIMIT: '0' });
    expect(ctx).toBe('');
  });

  it('skips when no lock file exists', () => {
    writeBridge(50, 50);
    // Remove lock file
    if (existsSync(lockPath)) rmSync(lockPath);

    const ctx = getContext();
    expect(ctx).toBe('');
  });

  it('skips when lock file has invalid startedAt', () => {
    writeBridge(50, 50);
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      ticketKey: 'TEST-1',
      startedAt: 'not-a-date',
    }));

    const ctx = getContext();
    expect(ctx).toBe('');
  });

  it('respects custom CLANCY_TIME_LIMIT', () => {
    writeBridge(50, 50);
    // 9 min ago with 10 min limit = 90%
    const startedAt = new Date(Date.now() - 9 * 60000).toISOString();
    writeLock(startedAt);

    const ctx = getContext({ CLANCY_TIME_LIMIT: '10' });
    expect(ctx).toContain('TIME WARNING');
    expect(ctx).toContain('9min of 10min');
  });
});

// ── Both warnings fire together ─────────────────────────────

describe('context + time combined', () => {
  it('emits both context and time warnings together', () => {
    writeBridge(30, 70); // triggers context warning
    // 25 min ago with 30 min limit = 83% — triggers time warning
    const startedAt = new Date(Date.now() - 25 * 60000).toISOString();
    writeLock(startedAt);

    const ctx = getContext();
    expect(ctx).toContain('CONTEXT WARNING');
    expect(ctx).toContain('TIME WARNING');
  });

  it('emits context critical + time critical together', () => {
    writeBridge(20, 80); // triggers context critical
    // 35 min ago with 30 min limit = 116% — triggers time critical
    const startedAt = new Date(Date.now() - 35 * 60000).toISOString();
    writeLock(startedAt);

    const ctx = getContext();
    expect(ctx).toContain('CONTEXT CRITICAL');
    expect(ctx).toContain('TIME CRITICAL');
  });
});

// ── Debounce independence ───────────────────────────────────

describe('debounce', () => {
  it('time debounce is independent from context debounce', () => {
    writeBridge(30, 70); // triggers context warning
    const startedAt = new Date(Date.now() - 25 * 60000).toISOString();
    writeLock(startedAt);

    // First call — both fire
    const ctx1 = getContext();
    expect(ctx1).toContain('CONTEXT WARNING');
    expect(ctx1).toContain('TIME WARNING');

    // Calls 2-4 — debounced (neither fires)
    for (let i = 0; i < 3; i++) {
      const ctx = getContext();
      expect(ctx).toBe('');
    }

    // Manually set context debounce to be ready but time debounce not ready
    const warnData = JSON.parse(readFileSync(warnPath, 'utf8'));
    warnData.callsSinceWarn = 5; // context ready to fire
    warnData.timeCallsSinceWarn = 1; // time NOT ready
    writeFileSync(warnPath, JSON.stringify(warnData));

    const ctx5 = getContext();
    // Context should fire, time should not
    expect(ctx5).toContain('CONTEXT WARNING');
    expect(ctx5).not.toContain('TIME');
  });

  it('time severity escalation bypasses time debounce', () => {
    writeBridge(50, 50); // no context warning

    // First call at 80% — warning fires
    const startedAt80 = new Date(Date.now() - 25 * 60000).toISOString();
    writeLock(startedAt80);
    const ctx1 = getContext();
    expect(ctx1).toContain('TIME WARNING');

    // Now escalate to 100% — should fire despite debounce
    const startedAt100 = new Date(Date.now() - 35 * 60000).toISOString();
    writeLock(startedAt100);
    const ctx2 = getContext();
    expect(ctx2).toContain('TIME CRITICAL');
  });
});
