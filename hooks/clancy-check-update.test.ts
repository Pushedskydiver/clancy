import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK_PATH = path.resolve(__dirname, 'clancy-check-update.js');

/**
 * Run the check-update hook as a child process with a custom cwd.
 * The hook is a SessionStart hook — no stdin/stdout protocol, just side-effects.
 * We set up a temp directory with the required file structure so the hook
 * doesn't exit early (it needs a VERSION file to proceed).
 */
function runHook(cwd: string): { exitCode: number | null } {
  try {
    execFileSync('node', [HOOK_PATH], {
      cwd,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        // Override HOME so the hook finds VERSION in our temp dir
        HOME: cwd,
      },
    });
    return { exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { status?: number };
    return { exitCode: e.status ?? 1 };
  }
}

/**
 * Set up the minimum file structure the hook needs to not exit(0) early:
 * - .claude/commands/clancy/VERSION (so findInstallDir succeeds)
 * - .claude/cache/ (so the cache dir check passes)
 */
function setupMinimalStructure(tmpDir: string): void {
  const clancyDir = path.join(tmpDir, '.claude', 'commands', 'clancy');
  fs.mkdirSync(clancyDir, { recursive: true });
  fs.writeFileSync(path.join(clancyDir, 'VERSION'), '0.5.13');
  fs.mkdirSync(path.join(tmpDir, '.claude', 'cache'), { recursive: true });
}

/** Create a brief file with a date prefix. */
function createBrief(briefsDir: string, filename: string): void {
  fs.writeFileSync(path.join(briefsDir, filename), '# Brief\n');
}

/** Read the stale count from the cache file. Returns null if file doesn't exist. */
function readStaleCount(tmpDir: string): number | null {
  const staleFile = path.join(tmpDir, '.clancy', '.brief-stale-count');
  try {
    return parseInt(fs.readFileSync(staleFile, 'utf8'), 10);
  } catch {
    return null;
  }
}

/** Format a date as YYYY-MM-DD. */
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Get a date N days ago. */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clancy-check-update-'));
  // The hook uses process.cwd() for .clancy/ paths
  // and os.homedir() for .claude/ paths (VERSION file).
  // We set HOME=tmpDir and cwd=tmpDir so both resolve to the same temp dir.
  setupMinimalStructure(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('clancy-check-update — stale brief detection', () => {
  // ── No briefs directory ───────────────────────────────────────

  describe('no .clancy/briefs/ directory', () => {
    it('does not write stale count file', () => {
      runHook(tmpDir);
      expect(readStaleCount(tmpDir)).toBeNull();
    });

    it('clears existing stale cache file if briefs dir is removed', () => {
      // Pre-create the stale count file as if it existed from a previous run
      const clancyDir = path.join(tmpDir, '.clancy');
      fs.mkdirSync(clancyDir, { recursive: true });
      fs.writeFileSync(path.join(clancyDir, '.brief-stale-count'), '3');

      runHook(tmpDir);
      expect(readStaleCount(tmpDir)).toBeNull();
    });
  });

  // ── Empty briefs directory ────────────────────────────────────

  describe('empty .clancy/briefs/ directory', () => {
    it('writes stale count of 0', () => {
      fs.mkdirSync(path.join(tmpDir, '.clancy', 'briefs'), { recursive: true });

      runHook(tmpDir);
      expect(readStaleCount(tmpDir)).toBe(0);
    });
  });

  // ── Stale brief (older than 7 days) ──────────────────────────

  describe('unapproved brief older than 7 days', () => {
    it('counts as stale', () => {
      const briefsDir = path.join(tmpDir, '.clancy', 'briefs');
      fs.mkdirSync(briefsDir, { recursive: true });

      const oldDate = formatDate(daysAgo(10));
      createBrief(briefsDir, `${oldDate}-refactor-auth.md`);

      runHook(tmpDir);
      expect(readStaleCount(tmpDir)).toBe(1);
    });
  });

  // ── Recent brief (within 7 days) ─────────────────────────────

  describe('unapproved brief within 7 days', () => {
    it('is not counted as stale', () => {
      const briefsDir = path.join(tmpDir, '.clancy', 'briefs');
      fs.mkdirSync(briefsDir, { recursive: true });

      const recentDate = formatDate(daysAgo(3));
      createBrief(briefsDir, `${recentDate}-add-feature.md`);

      runHook(tmpDir);
      expect(readStaleCount(tmpDir)).toBe(0);
    });
  });

  // ── Approved brief (has .approved marker) ─────────────────────

  describe('brief with .md.approved marker', () => {
    it('is not counted as stale even if old', () => {
      const briefsDir = path.join(tmpDir, '.clancy', 'briefs');
      fs.mkdirSync(briefsDir, { recursive: true });

      const oldDate = formatDate(daysAgo(14));
      const briefName = `${oldDate}-approved-feature.md`;
      createBrief(briefsDir, briefName);
      // Create the .approved marker
      fs.writeFileSync(path.join(briefsDir, `${briefName}.approved`), '');

      runHook(tmpDir);
      expect(readStaleCount(tmpDir)).toBe(0);
    });
  });

  // ── Feedback files excluded ───────────────────────────────────

  describe('.feedback.md files', () => {
    it('are excluded from stale count', () => {
      const briefsDir = path.join(tmpDir, '.clancy', 'briefs');
      fs.mkdirSync(briefsDir, { recursive: true });

      const oldDate = formatDate(daysAgo(10));
      createBrief(briefsDir, `${oldDate}-some-brief.feedback.md`);

      runHook(tmpDir);
      expect(readStaleCount(tmpDir)).toBe(0);
    });
  });

  // ── Multiple stale briefs ─────────────────────────────────────

  describe('multiple stale briefs', () => {
    it('counts all unapproved briefs older than 7 days', () => {
      const briefsDir = path.join(tmpDir, '.clancy', 'briefs');
      fs.mkdirSync(briefsDir, { recursive: true });

      // 3 stale briefs (old, unapproved)
      createBrief(briefsDir, `${formatDate(daysAgo(10))}-brief-one.md`);
      createBrief(briefsDir, `${formatDate(daysAgo(20))}-brief-two.md`);
      createBrief(briefsDir, `${formatDate(daysAgo(30))}-brief-three.md`);

      // 1 recent brief (not stale)
      createBrief(briefsDir, `${formatDate(daysAgo(2))}-recent-brief.md`);

      // 1 old but approved brief (not stale)
      const approvedName = `${formatDate(daysAgo(15))}-approved-brief.md`;
      createBrief(briefsDir, approvedName);
      fs.writeFileSync(path.join(briefsDir, `${approvedName}.approved`), '');

      // 1 old feedback file (excluded)
      createBrief(briefsDir, `${formatDate(daysAgo(12))}-something.feedback.md`);

      runHook(tmpDir);
      expect(readStaleCount(tmpDir)).toBe(3);
    });
  });

  // ── Corrupt/invalid date in filename ──────────────────────────

  describe('corrupt or invalid date in filename', () => {
    it('skips files without a valid date prefix', () => {
      const briefsDir = path.join(tmpDir, '.clancy', 'briefs');
      fs.mkdirSync(briefsDir, { recursive: true });

      // No date prefix
      createBrief(briefsDir, 'no-date-prefix.md');
      // Invalid date
      createBrief(briefsDir, '9999-99-99-invalid-date.md');
      // Partial date
      createBrief(briefsDir, '2025-01-brief.md');

      // One valid stale brief to confirm counting still works
      createBrief(briefsDir, `${formatDate(daysAgo(10))}-valid-stale.md`);

      runHook(tmpDir);
      expect(readStaleCount(tmpDir)).toBe(1);
    });
  });

  // ── Edge case: exactly 7 days old ─────────────────────────────

  describe('brief exactly on the boundary', () => {
    it('brief from exactly 7 days ago is not stale (needs to be older than 7 days)', () => {
      const briefsDir = path.join(tmpDir, '.clancy', 'briefs');
      fs.mkdirSync(briefsDir, { recursive: true });

      // The hook compares now - fileDate > sevenDays (strict >)
      // A file dated exactly 7 days ago at T00:00:00Z will be slightly more than 7 days
      // from "now" (which is later in the day), so it WILL be counted as stale.
      // But a file dated 6 days ago will not be.
      const sixDaysAgo = formatDate(daysAgo(6));
      createBrief(briefsDir, `${sixDaysAgo}-recent-enough.md`);

      runHook(tmpDir);
      expect(readStaleCount(tmpDir)).toBe(0);
    });
  });
});
