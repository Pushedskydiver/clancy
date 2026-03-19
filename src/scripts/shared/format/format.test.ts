import { describe, expect, it } from 'vitest';

import { formatDuration } from './format.js';

describe('formatDuration', () => {
  it('returns 0s for 0ms', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('returns 30s for 30000ms', () => {
    expect(formatDuration(30_000)).toBe('30s');
  });

  it('returns 1m for 60000ms (exact minute)', () => {
    expect(formatDuration(60_000)).toBe('1m');
  });

  it('returns 1m 30s for 90000ms', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
  });

  it('returns 1h for 3600000ms', () => {
    expect(formatDuration(3_600_000)).toBe('1h');
  });

  it('returns 1h 30m for 5400000ms', () => {
    expect(formatDuration(5_400_000)).toBe('1h 30m');
  });

  it('returns 2h for 7200000ms', () => {
    expect(formatDuration(7_200_000)).toBe('2h');
  });
});
