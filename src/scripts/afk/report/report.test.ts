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
import { afterEach, describe, expect, it } from 'vitest';

import {
  generateSessionReport,
  parseCostsLog,
  progressTimestampToMs,
} from './report.js';

describe('progressTimestampToMs', () => {
  it('converts a progress timestamp to milliseconds', () => {
    const ms = progressTimestampToMs('2026-03-19 14:30');
    expect(ms).toBe(new Date('2026-03-19T14:30:00Z').getTime());
  });

  it('returns NaN for invalid timestamp', () => {
    expect(progressTimestampToMs('not-a-date')).toBeNaN();
  });
});

describe('parseCostsLog', () => {
  const dirs: string[] = [];

  function makeTempRoot(): string {
    const dir = join(tmpdir(), `clancy-report-test-${randomUUID()}`);
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

  it('parses cost entries after a given timestamp', () => {
    const root = makeTempRoot();
    const now = Date.now();
    const recent = new Date(now + 1000).toISOString();
    const old = new Date(now - 60000).toISOString();

    writeFileSync(
      join(root, '.clancy', 'costs.log'),
      `${old} | OLD-1 | 5min | ~33000 tokens (estimated)\n` +
        `${recent} | NEW-1 | 10min | ~66000 tokens (estimated)\n`,
    );

    const entries = parseCostsLog(root, now);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key).toBe('NEW-1');
  });

  it('returns empty array when costs.log does not exist', () => {
    const root = makeTempRoot();
    const entries = parseCostsLog(root, 0);
    expect(entries).toEqual([]);
  });

  it('skips malformed lines', () => {
    const root = makeTempRoot();
    writeFileSync(
      join(root, '.clancy', 'costs.log'),
      `bad line\n${new Date().toISOString()} | KEY-1 | 3min | ~19800 tokens (estimated)\n`,
    );

    const entries = parseCostsLog(root, 0);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key).toBe('KEY-1');
  });
});

describe('generateSessionReport', () => {
  const dirs: string[] = [];

  function makeTempRoot(): string {
    const dir = join(tmpdir(), `clancy-report-test-${randomUUID()}`);
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

  it('generates report with completed tickets', () => {
    const root = makeTempRoot();
    const loopStart = Date.now() - 30 * 60000;
    const loopEnd = Date.now();

    // Write a progress entry with a timestamp after loopStart
    const ts = new Date(loopStart + 5000);
    const progressTs = `${ts.getUTCFullYear()}-${String(ts.getUTCMonth() + 1).padStart(2, '0')}-${String(ts.getUTCDate()).padStart(2, '0')} ${String(ts.getUTCHours()).padStart(2, '0')}:${String(ts.getUTCMinutes()).padStart(2, '0')}`;
    writeFileSync(
      join(root, '.clancy', 'progress.txt'),
      `${progressTs} | PROJ-101 | Add login form | PR_CREATED | pr:42\n`,
    );

    // Write a cost entry
    const costTs = new Date(loopStart + 10000).toISOString();
    writeFileSync(
      join(root, '.clancy', 'costs.log'),
      `${costTs} | PROJ-101 | 18min | ~120000 tokens (estimated)\n`,
    );

    const report = generateSessionReport(root, loopStart, loopEnd);

    expect(report).toContain('# AFK Session Report');
    expect(report).toContain('Tickets completed: 1');
    expect(report).toContain('Tickets failed: 0');
    expect(report).toContain('\u2713 PROJ-101 — Add login form');
    expect(report).toContain('Duration: 18min');
    expect(report).toContain('Tokens: ~120000 tokens (estimated)');
    expect(report).toContain('PR: #42');
    expect(report).toContain('Status: PR_CREATED');
    expect(report).toContain('Review PRs #42');
  });

  it('generates report with mixed completed and failed tickets', () => {
    const root = makeTempRoot();
    const loopStart = Date.now() - 60 * 60000;
    const loopEnd = Date.now();

    const ts = new Date(loopStart + 5000);
    const progressTs = `${ts.getUTCFullYear()}-${String(ts.getUTCMonth() + 1).padStart(2, '0')}-${String(ts.getUTCDate()).padStart(2, '0')} ${String(ts.getUTCHours()).padStart(2, '0')}:${String(ts.getUTCMinutes()).padStart(2, '0')}`;

    writeFileSync(
      join(root, '.clancy', 'progress.txt'),
      `${progressTs} | PROJ-101 | Add login form | PR_CREATED | pr:42\n` +
        `${progressTs} | PROJ-104 | OAuth2 integration | SKIPPED\n`,
    );

    const report = generateSessionReport(root, loopStart, loopEnd);

    expect(report).toContain('Tickets completed: 1');
    expect(report).toContain('Tickets failed: 1');
    expect(report).toContain('\u2713 PROJ-101');
    expect(report).toContain('\u2717 PROJ-104');
    expect(report).toContain('PROJ-104 needs manual intervention');
  });

  it('generates report with zero tickets (empty session)', () => {
    const root = makeTempRoot();
    const loopStart = Date.now() - 5000;
    const loopEnd = Date.now();

    const report = generateSessionReport(root, loopStart, loopEnd);

    expect(report).toContain('Tickets completed: 0');
    expect(report).toContain('Tickets failed: 0');
    expect(report).toContain('No tickets were processed in this session.');
  });

  it('includes cost data when available', () => {
    const root = makeTempRoot();
    const loopStart = Date.now() - 30 * 60000;
    const loopEnd = Date.now();

    const ts = new Date(loopStart + 5000);
    const progressTs = `${ts.getUTCFullYear()}-${String(ts.getUTCMonth() + 1).padStart(2, '0')}-${String(ts.getUTCDate()).padStart(2, '0')} ${String(ts.getUTCHours()).padStart(2, '0')}:${String(ts.getUTCMinutes()).padStart(2, '0')}`;

    writeFileSync(
      join(root, '.clancy', 'progress.txt'),
      `${progressTs} | PROJ-101 | Add login | PR_CREATED | pr:10\n` +
        `${progressTs} | PROJ-102 | Add logout | DONE\n`,
    );

    const costTs = new Date(loopStart + 10000).toISOString();
    writeFileSync(
      join(root, '.clancy', 'costs.log'),
      `${costTs} | PROJ-101 | 10min | ~66000 tokens (estimated)\n` +
        `${costTs} | PROJ-102 | 15min | ~99000 tokens (estimated)\n`,
    );

    const report = generateSessionReport(root, loopStart, loopEnd);

    expect(report).toContain('Estimated token usage: 165,000');
    expect(report).toContain('Duration: 10min');
    expect(report).toContain('Duration: 15min');
  });

  it('handles missing costs.log gracefully', () => {
    const root = makeTempRoot();
    const loopStart = Date.now() - 10 * 60000;
    const loopEnd = Date.now();

    const ts = new Date(loopStart + 5000);
    const progressTs = `${ts.getUTCFullYear()}-${String(ts.getUTCMonth() + 1).padStart(2, '0')}-${String(ts.getUTCDate()).padStart(2, '0')} ${String(ts.getUTCHours()).padStart(2, '0')}:${String(ts.getUTCMinutes()).padStart(2, '0')}`;

    writeFileSync(
      join(root, '.clancy', 'progress.txt'),
      `${progressTs} | PROJ-201 | Some feature | DONE\n`,
    );

    // No costs.log file
    const report = generateSessionReport(root, loopStart, loopEnd);

    expect(report).toContain('PROJ-201');
    expect(report).not.toContain('Duration:');
    expect(report).not.toContain('Tokens:');
    expect(report).not.toContain('Estimated token usage');
  });

  it('writes to .clancy/session-report.md', () => {
    const root = makeTempRoot();
    const loopStart = Date.now() - 5000;
    const loopEnd = Date.now();

    generateSessionReport(root, loopStart, loopEnd);

    const reportPath = join(root, '.clancy', 'session-report.md');
    expect(existsSync(reportPath)).toBe(true);

    const content = readFileSync(reportPath, 'utf8');
    expect(content).toContain('# AFK Session Report');
  });

  it('includes total duration in summary', () => {
    const root = makeTempRoot();
    const loopStart = Date.now() - 102 * 60000; // 1h 42m
    const loopEnd = Date.now();

    const report = generateSessionReport(root, loopStart, loopEnd);

    expect(report).toContain('Total duration: 1h 42m');
  });
});
