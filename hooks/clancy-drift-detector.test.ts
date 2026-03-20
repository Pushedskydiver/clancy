import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK_PATH = resolve(__dirname, 'clancy-drift-detector.js');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { versionsDiffer } = require(HOOK_PATH);

/** Run the hook with stdin input, return stdout. */
function runHook(
  payload: Record<string, unknown>,
): string {
  try {
    return execFileSync('node', [HOOK_PATH], {
      encoding: 'utf8',
      input: JSON.stringify(payload),
      timeout: 5000,
    });
  } catch {
    return '';
  }
}

describe('clancy-drift-detector', () => {
  const testSession = `test-drift-${Date.now()}`;
  const testDir = join(tmpdir(), `clancy-drift-test-${Date.now()}`);
  const clancyDir = join(testDir, '.clancy');
  const claudeDir = join(testDir, '.claude', 'commands', 'clancy');

  beforeEach(() => {
    // Clean debounce flag
    const flagPath = join(tmpdir(), `clancy-drift-${testSession}`);
    if (existsSync(flagPath)) rmSync(flagPath);

    mkdirSync(clancyDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    const flagPath = join(tmpdir(), `clancy-drift-${testSession}`);
    if (existsSync(flagPath)) rmSync(flagPath);
  });

  describe('versionsDiffer', () => {
    it('returns true for different versions', () => {
      expect(versionsDiffer('0.7.4', '0.8.0')).toBe(true);
    });

    it('returns false for same versions', () => {
      expect(versionsDiffer('0.8.0', '0.8.0')).toBe(false);
    });

    it('returns false when either is null', () => {
      expect(versionsDiffer(null, '0.8.0')).toBe(false);
      expect(versionsDiffer('0.8.0', null)).toBe(false);
    });

    it('trims whitespace', () => {
      expect(versionsDiffer('0.8.0 ', ' 0.8.0')).toBe(false);
    });
  });

  describe('hook execution', () => {
    it('exits silently when no session_id', () => {
      const output = runHook({});
      expect(output).toBe('');
    });

    it('exits silently when no version.json exists', () => {
      const session = `no-version-${Date.now()}`;
      const output = runHook({ session_id: session, cwd: testDir });
      expect(output).toBe('');
    });

    it('warns when versions differ', () => {
      const session = `diff-${Date.now()}`;
      writeFileSync(
        join(clancyDir, 'version.json'),
        JSON.stringify({ version: '0.7.4', installedAt: new Date().toISOString() }),
      );
      writeFileSync(join(claudeDir, 'VERSION'), '0.8.0');

      const output = runHook({ session_id: session, cwd: testDir });
      expect(output).toContain('DRIFT WARNING');
      expect(output).toContain('0.7.4');
      expect(output).toContain('0.8.0');
    });

    it('exits silently when versions match', () => {
      const session = `match-${Date.now()}`;
      writeFileSync(
        join(clancyDir, 'version.json'),
        JSON.stringify({ version: '0.8.0', installedAt: new Date().toISOString() }),
      );
      writeFileSync(join(claudeDir, 'VERSION'), '0.8.0');

      const output = runHook({ session_id: session, cwd: testDir });
      expect(output).toBe('');
    });

    it('debounces — second call in same session exits silently', () => {
      const session = `debounce-${Date.now()}`;
      writeFileSync(
        join(clancyDir, 'version.json'),
        JSON.stringify({ version: '0.7.4', installedAt: new Date().toISOString() }),
      );
      writeFileSync(join(claudeDir, 'VERSION'), '0.8.0');

      // First call warns
      const output1 = runHook({ session_id: session, cwd: testDir });
      expect(output1).toContain('DRIFT WARNING');

      // Second call is silent (debounced)
      const output2 = runHook({ session_id: session, cwd: testDir });
      expect(output2).toBe('');
    });
  });
});
