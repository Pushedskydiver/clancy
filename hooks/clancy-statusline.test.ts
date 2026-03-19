import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK_PATH = resolve(__dirname, 'clancy-statusline.js');

const SESSION = `test-statusline-${process.pid}`;

/** Bridge file written by the hook. */
const bridgePath = join(tmpdir(), `clancy-ctx-${SESSION}.json`);

/** Temp directory for the update-check cache file. */
const fakeClaudeDir = join(tmpdir(), `clancy-statusline-test-${process.pid}`);
const cacheDir = join(fakeClaudeDir, 'cache');
const cacheFile = join(cacheDir, 'clancy-update-check.json');

/** Run the statusline hook with a JSON payload piped to stdin. */
function runHook(
  payload: Record<string, unknown>,
  env: Record<string, string> = {},
): string {
  try {
    return execFileSync('node', [HOOK_PATH], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: fakeClaudeDir, ...env },
      timeout: 5000,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 0) return e.stdout || '';
    return '';
  }
}

/** Strip ANSI escape codes for easier assertion. */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

beforeEach(() => {
  if (existsSync(bridgePath)) rmSync(bridgePath);
  if (existsSync(fakeClaudeDir)) rmSync(fakeClaudeDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(bridgePath)) rmSync(bridgePath);
  if (existsSync(fakeClaudeDir)) rmSync(fakeClaudeDir, { recursive: true });
});

// ── Bridge file writing ──────────────────────────────────────

describe('bridge file', () => {
  it('writes bridge file with context metrics', () => {
    runHook({
      session_id: SESSION,
      context_window: { remaining_percentage: 60 },
    });

    expect(existsSync(bridgePath)).toBe(true);
    const bridge = JSON.parse(readFileSync(bridgePath, 'utf8'));
    expect(bridge.session_id).toBe(SESSION);
    expect(bridge.remaining_percentage).toBe(60);
    expect(typeof bridge.used_pct).toBe('number');
    expect(typeof bridge.timestamp).toBe('number');
  });

  it('normalises remaining_percentage to usable range', () => {
    // 100% remaining → 0% used (after adjusting for 16.5% autocompact buffer)
    runHook({
      session_id: SESSION,
      context_window: { remaining_percentage: 100 },
    });

    const bridge = JSON.parse(readFileSync(bridgePath, 'utf8'));
    expect(bridge.used_pct).toBe(0);
  });

  it('caps used_pct at 100 when remaining is below buffer', () => {
    // 10% remaining is below the 16.5% autocompact buffer → used should be 100
    runHook({
      session_id: SESSION,
      context_window: { remaining_percentage: 10 },
    });

    const bridge = JSON.parse(readFileSync(bridgePath, 'utf8'));
    expect(bridge.used_pct).toBe(100);
  });

  it('computes used_pct correctly for mid-range values', () => {
    // 50% remaining: usableRemaining = ((50 - 16.5) / (100 - 16.5)) * 100 ≈ 40.12
    // used = 100 - 40.12 ≈ 60
    runHook({
      session_id: SESSION,
      context_window: { remaining_percentage: 50 },
    });

    const bridge = JSON.parse(readFileSync(bridgePath, 'utf8'));
    expect(bridge.used_pct).toBe(60);
  });

  it('does not write bridge file when session_id is missing', () => {
    runHook({
      context_window: { remaining_percentage: 60 },
    });

    expect(existsSync(bridgePath)).toBe(false);
  });

  it('does not write bridge file when remaining_percentage is missing', () => {
    runHook({
      session_id: SESSION,
    });

    // Bridge path uses SESSION, but hook won't write because remaining is null
    expect(existsSync(bridgePath)).toBe(false);
  });
});

// ── Statusline output ────────────────────────────────────────

describe('statusline output', () => {
  it('outputs "Clancy" label with context bar', () => {
    const output = runHook({
      session_id: SESSION,
      context_window: { remaining_percentage: 80 },
    });

    const plain = stripAnsi(output);
    expect(plain).toContain('Clancy');
    expect(plain).toMatch(/\d+%/);
  });

  it('outputs "Clancy" label without bar when no context data', () => {
    const output = runHook({ session_id: SESSION });
    const plain = stripAnsi(output);
    expect(plain).toContain('Clancy');
    expect(plain).not.toMatch(/\d+%/);
  });

  it('uses green colour for low usage (< 50%)', () => {
    const output = runHook({
      session_id: SESSION,
      context_window: { remaining_percentage: 80 },
    });

    // Green ANSI escape: \x1b[32m
    expect(output).toContain('\x1b[32m');
  });

  it('uses yellow colour for medium usage (50-64%)', () => {
    // We need used ≈ 55%. usableRemaining = 45 → remaining = 16.5 + 45*(83.5/100) = ~54.1
    // Let's try remaining = 54: usableRemaining = ((54-16.5)/83.5)*100 ≈ 44.9, used ≈ 55
    const output = runHook({
      session_id: SESSION,
      context_window: { remaining_percentage: 54 },
    });

    // Yellow ANSI escape: \x1b[33m (in the bar, not the update part)
    const plain = stripAnsi(output);
    expect(plain).toMatch(/5[0-9]%/);
    expect(output).toContain('\x1b[33m');
  });

  it('uses orange colour for high usage (65-79%)', () => {
    // Need used ≈ 70%. usableRemaining = 30 → remaining = 16.5 + 30*(83.5/100) = ~41.55
    const output = runHook({
      session_id: SESSION,
      context_window: { remaining_percentage: 42 },
    });

    // Orange ANSI escape: \x1b[38;5;208m
    expect(output).toContain('\x1b[38;5;208m');
  });

  it('uses blinking red with skull for critical usage (>= 80%)', () => {
    // Need used ≈ 85%. usableRemaining = 15 → remaining = 16.5 + 15*(83.5/100) = ~29.0
    const output = runHook({
      session_id: SESSION,
      context_window: { remaining_percentage: 29 },
    });

    // Blinking red: \x1b[5;31m
    expect(output).toContain('\x1b[5;31m');
    expect(output).toContain('\u{1F480}'); // skull emoji
  });
});

// ── Update banner ─────────────────────────────────────────────

describe('update banner', () => {
  it('shows update available banner when cache indicates update', () => {
    writeFileSync(cacheFile, JSON.stringify({ update_available: true }));

    const output = runHook({ session_id: SESSION });
    const plain = stripAnsi(output);
    expect(plain).toContain('/clancy:update');
  });

  it('does not show update banner when no update available', () => {
    writeFileSync(cacheFile, JSON.stringify({ update_available: false }));

    const output = runHook({ session_id: SESSION });
    const plain = stripAnsi(output);
    expect(plain).not.toContain('/clancy:update');
  });

  it('does not show update banner when cache file is missing', () => {
    // Cache file doesn't exist (not created in this test)
    const output = runHook({ session_id: SESSION });
    const plain = stripAnsi(output);
    expect(plain).not.toContain('/clancy:update');
  });

  it('separates update banner and context bar with pipe', () => {
    writeFileSync(cacheFile, JSON.stringify({ update_available: true }));

    const output = runHook({
      session_id: SESSION,
      context_window: { remaining_percentage: 80 },
    });

    const plain = stripAnsi(output);
    expect(plain).toContain('\u2502'); // │ separator
    expect(plain).toContain('/clancy:update');
    expect(plain).toContain('Clancy');
  });
});

// ── Best-effort / fail-open ──────────────────────────────────

describe('best-effort', () => {
  it('exits cleanly on malformed JSON input', () => {
    const result = execFileSync('node', [HOOK_PATH], {
      input: 'not-valid-json',
      encoding: 'utf8',
      timeout: 5000,
    });

    // Should produce no output and not crash (exit 0)
    expect(result).toBe('');
  });

  it('exits cleanly on empty input', () => {
    const result = execFileSync('node', [HOOK_PATH], {
      input: '',
      encoding: 'utf8',
      timeout: 5000,
    });

    expect(result).toBe('');
  });
});
