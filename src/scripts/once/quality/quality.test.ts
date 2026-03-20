import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QualityData } from './quality.js';
import {
  getQualityData,
  readQualityData,
  recordDelivery,
  recordRework,
  recordVerificationRetry,
} from './quality.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    process.cwd(),
    '.test-tmp',
    `quality-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(tmpDir, '.clancy'), { recursive: true });
});

afterEach(() => {
  // Clean up temp dir (best-effort)
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

function readQualityFile(root: string): QualityData {
  const raw = readFileSync(join(root, '.clancy', 'quality.json'), 'utf8');
  return JSON.parse(raw) as QualityData;
}

function writeQualityFile(root: string, data: QualityData): void {
  writeFileSync(
    join(root, '.clancy', 'quality.json'),
    JSON.stringify(data, null, 2) + '\n',
    'utf8',
  );
}

// ─── readQualityData ────────────────────────────────────────────────────────

describe('readQualityData', () => {
  it('returns empty data when file does not exist', () => {
    const data = readQualityData(tmpDir);

    expect(data.tickets).toEqual({});
    expect(data.summary.totalTickets).toBe(0);
  });

  it('reads existing quality data', () => {
    const existing: QualityData = {
      tickets: {
        'PROJ-1': {
          reworkCycles: 1,
          verificationRetries: 2,
          deliveredAt: '2026-01-01T00:00:00.000Z',
          duration: 60000,
        },
      },
      summary: {
        totalTickets: 1,
        avgReworkCycles: 1,
        avgVerificationRetries: 2,
        avgDuration: 60000,
      },
    };
    writeQualityFile(tmpDir, existing);

    const data = readQualityData(tmpDir);

    expect(data.tickets['PROJ-1']?.reworkCycles).toBe(1);
    expect(data.summary.totalTickets).toBe(1);
  });

  it('returns empty data for corrupted JSON', () => {
    writeFileSync(
      join(tmpDir, '.clancy', 'quality.json'),
      'not valid json',
      'utf8',
    );

    const data = readQualityData(tmpDir);

    expect(data.tickets).toEqual({});
  });
});

// ─── recordRework ───────────────────────────────────────────────────────────

describe('recordRework', () => {
  it('creates entry and increments rework for new ticket', () => {
    recordRework(tmpDir, 'PROJ-1');

    const data = readQualityFile(tmpDir);
    expect(data.tickets['PROJ-1']?.reworkCycles).toBe(1);
    expect(data.summary.totalTickets).toBe(1);
    expect(data.summary.avgReworkCycles).toBe(1);
  });

  it('increments rework for existing ticket', () => {
    recordRework(tmpDir, 'PROJ-1');
    recordRework(tmpDir, 'PROJ-1');

    const data = readQualityFile(tmpDir);
    expect(data.tickets['PROJ-1']?.reworkCycles).toBe(2);
  });

  it('does not crash when .clancy directory does not exist', () => {
    const badRoot = join(tmpDir, 'nonexistent', 'deep', 'path');

    // Should not throw
    expect(() => recordRework(badRoot, 'PROJ-1')).not.toThrow();
  });
});

// ─── recordVerificationRetry ────────────────────────────────────────────────

describe('recordVerificationRetry', () => {
  it('sets verification retries for a ticket', () => {
    recordVerificationRetry(tmpDir, 'PROJ-2', 3);

    const data = readQualityFile(tmpDir);
    expect(data.tickets['PROJ-2']?.verificationRetries).toBe(3);
    expect(data.summary.avgVerificationRetries).toBe(3);
  });

  it('overwrites previous retry count', () => {
    recordVerificationRetry(tmpDir, 'PROJ-2', 1);
    recordVerificationRetry(tmpDir, 'PROJ-2', 5);

    const data = readQualityFile(tmpDir);
    expect(data.tickets['PROJ-2']?.verificationRetries).toBe(5);
  });
});

// ─── recordDelivery ─────────────────────────────────────────────────────────

describe('recordDelivery', () => {
  it('records delivery time and duration', () => {
    vi.useFakeTimers({ now: new Date('2026-03-20T12:00:00Z') });

    recordDelivery(tmpDir, 'PROJ-3', 120000);

    vi.useRealTimers();

    const data = readQualityFile(tmpDir);
    expect(data.tickets['PROJ-3']?.deliveredAt).toBe(
      '2026-03-20T12:00:00.000Z',
    );
    expect(data.tickets['PROJ-3']?.duration).toBe(120000);
    expect(data.summary.avgDuration).toBe(120000);
  });

  it('preserves rework count when recording delivery', () => {
    recordRework(tmpDir, 'PROJ-4');
    recordRework(tmpDir, 'PROJ-4');
    recordDelivery(tmpDir, 'PROJ-4', 60000);

    const data = readQualityFile(tmpDir);
    expect(data.tickets['PROJ-4']?.reworkCycles).toBe(2);
    expect(data.tickets['PROJ-4']?.duration).toBe(60000);
  });
});

// ─── getQualityData ─────────────────────────────────────────────────────────

describe('getQualityData', () => {
  it('returns undefined when no data exists', () => {
    const data = getQualityData(tmpDir);

    expect(data).toBeUndefined();
  });

  it('returns data when tickets have been tracked', () => {
    recordRework(tmpDir, 'PROJ-5');

    const data = getQualityData(tmpDir);

    expect(data).toBeDefined();
    expect(data!.tickets['PROJ-5']).toBeDefined();
  });
});

// ─── Summary computation ────────────────────────────────────────────────────

describe('summary computation', () => {
  it('computes averages across multiple tickets', () => {
    recordRework(tmpDir, 'T-1');
    recordRework(tmpDir, 'T-1');
    recordRework(tmpDir, 'T-2');
    recordVerificationRetry(tmpDir, 'T-1', 1);
    recordVerificationRetry(tmpDir, 'T-2', 3);
    recordDelivery(tmpDir, 'T-1', 100000);
    recordDelivery(tmpDir, 'T-2', 200000);

    const data = readQualityFile(tmpDir);
    expect(data.summary.totalTickets).toBe(2);
    expect(data.summary.avgReworkCycles).toBe(1.5);
    expect(data.summary.avgVerificationRetries).toBe(2);
    expect(data.summary.avgDuration).toBe(150000);
  });

  it('handles tickets without duration in average', () => {
    recordRework(tmpDir, 'T-1');
    recordDelivery(tmpDir, 'T-2', 100000);

    const data = readQualityFile(tmpDir);
    // Only T-2 has duration, so avgDuration = 100000
    expect(data.summary.avgDuration).toBe(100000);
  });
});

// ─── Atomic writes ──────────────────────────────────────────────────────────

describe('atomic writes', () => {
  it('does not leave .tmp file after successful write', () => {
    recordRework(tmpDir, 'PROJ-1');

    const tmpFile = join(tmpDir, '.clancy', 'quality.json.tmp');
    expect(existsSync(tmpFile)).toBe(false);
    expect(existsSync(join(tmpDir, '.clancy', 'quality.json'))).toBe(true);
  });
});
