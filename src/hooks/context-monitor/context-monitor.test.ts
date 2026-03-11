import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runContextMonitor } from './context-monitor.js';

vi.mock('node:fs');
vi.mock('node:os', () => ({ tmpdir: () => '/tmp' }));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

function makeBridgeMetrics(
  remaining: number,
  usedPct: number,
  stale = false,
): string {
  return JSON.stringify({
    session_id: 'test-session',
    remaining_percentage: remaining,
    used_pct: usedPct,
    timestamp: stale
      ? Math.floor(Date.now() / 1000) - 120
      : Math.floor(Date.now() / 1000),
  });
}

describe('context-monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined when no session_id', () => {
    expect(runContextMonitor('{}')).toBeUndefined();
  });

  it('returns undefined when bridge file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = runContextMonitor(
      JSON.stringify({ session_id: 'test-session' }),
    );

    expect(result).toBeUndefined();
  });

  it('returns undefined when metrics are stale', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeBridgeMetrics(30, 70, true));

    const result = runContextMonitor(
      JSON.stringify({ session_id: 'test-session' }),
    );

    expect(result).toBeUndefined();
  });

  it('returns undefined when remaining is above warning threshold', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeBridgeMetrics(40, 60));

    const result = runContextMonitor(
      JSON.stringify({ session_id: 'test-session' }),
    );

    expect(result).toBeUndefined();
  });

  it('emits warning when remaining <= 35%', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = p.toString();

      // Bridge file exists, debounce file does not
      return path.endsWith('.json') && !path.includes('-warned');
    });
    mockReadFileSync.mockReturnValue(makeBridgeMetrics(33, 67));

    const result = runContextMonitor(
      JSON.stringify({ session_id: 'test-session' }),
    );

    expect(result).toBeDefined();
    expect(result!.hookSpecificOutput.additionalContext).toContain(
      'CONTEXT WARNING',
    );
    expect(result!.hookSpecificOutput.additionalContext).toContain('67%');
  });

  it('emits critical when remaining <= 25%', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = p.toString();

      return path.endsWith('.json') && !path.includes('-warned');
    });
    mockReadFileSync.mockReturnValue(makeBridgeMetrics(20, 80));

    const result = runContextMonitor(
      JSON.stringify({ session_id: 'test-session' }),
    );

    expect(result).toBeDefined();
    expect(result!.hookSpecificOutput.additionalContext).toContain(
      'CONTEXT CRITICAL',
    );
    expect(result!.hookSpecificOutput.additionalContext).toContain('80%');
  });

  it('debounces after first warning', () => {
    // Both bridge and debounce files exist
    mockExistsSync.mockReturnValue(true);

    mockReadFileSync.mockImplementation((p) => {
      const path = p.toString();

      if (path.includes('-warned')) {
        return JSON.stringify({
          callsSinceWarn: 1,
          lastLevel: 'warning',
        });
      }

      return makeBridgeMetrics(33, 67);
    });

    const result = runContextMonitor(
      JSON.stringify({ session_id: 'test-session' }),
    );

    // Should be debounced (callsSinceWarn + 1 = 2, which is < 5)
    expect(result).toBeUndefined();
  });

  it('bypasses debounce on severity escalation', () => {
    mockExistsSync.mockReturnValue(true);

    mockReadFileSync.mockImplementation((p) => {
      const path = p.toString();

      if (path.includes('-warned')) {
        return JSON.stringify({
          callsSinceWarn: 1,
          lastLevel: 'warning',
        });
      }

      // Critical level (remaining <= 25)
      return makeBridgeMetrics(20, 80);
    });

    const result = runContextMonitor(
      JSON.stringify({ session_id: 'test-session' }),
    );

    // Should bypass debounce because severity escalated from warning to critical
    expect(result).toBeDefined();
    expect(result!.hookSpecificOutput.additionalContext).toContain(
      'CONTEXT CRITICAL',
    );
  });

  it('writes debounce state file', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = p.toString();

      return path.endsWith('.json') && !path.includes('-warned');
    });
    mockReadFileSync.mockReturnValue(makeBridgeMetrics(33, 67));

    runContextMonitor(JSON.stringify({ session_id: 'test-session' }));

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      join('/tmp', 'clancy-ctx-test-session-warned.json'),
      expect.any(String),
    );
  });

  it('returns undefined for invalid JSON', () => {
    expect(runContextMonitor('not json')).toBeUndefined();
  });
});
