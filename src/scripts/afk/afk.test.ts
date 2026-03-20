import { describe, expect, it } from 'vitest';

import { checkStopCondition, getQuietSleepMs, parseTime } from './afk.js';

describe('afk', () => {
  describe('checkStopCondition', () => {
    it('stops on "No tickets found"', () => {
      const result = checkStopCondition('No tickets found in the queue');
      expect(result.stop).toBe(true);
      expect(result.reason).toContain('all done');
    });

    it('stops on "No issues found"', () => {
      const result = checkStopCondition('No issues found');
      expect(result.stop).toBe(true);
    });

    it('stops on "All done"', () => {
      const result = checkStopCondition('All done');
      expect(result.stop).toBe(true);
    });

    it('stops on "Ticket skipped"', () => {
      const result = checkStopCondition('Ticket skipped — has blockers');
      expect(result.stop).toBe(true);
      expect(result.reason).toContain('skipped');
    });

    it('stops on preflight failure', () => {
      const result = checkStopCondition(
        '✗ Board credentials missing in .clancy/.env',
      );
      expect(result.stop).toBe(true);
      expect(result.reason).toContain('Preflight');
    });

    it('does not stop on normal output', () => {
      const result = checkStopCondition(
        '→ Checking out feature/proj-123\n✓ Clancy completed PROJ-123',
      );
      expect(result.stop).toBe(false);
    });

    it('does not stop on empty output', () => {
      const result = checkStopCondition('');
      expect(result.stop).toBe(false);
    });
  });

  describe('parseTime', () => {
    it('parses valid HH:MM', () => {
      expect(parseTime('22:00')).toEqual({ hours: 22, minutes: 0 });
    });

    it('parses single-digit hour', () => {
      expect(parseTime('6:00')).toEqual({ hours: 6, minutes: 0 });
    });

    it('returns null for invalid format', () => {
      expect(parseTime('abc')).toBeNull();
      expect(parseTime('25:00')).toBeNull();
      expect(parseTime('12:60')).toBeNull();
      expect(parseTime('')).toBeNull();
    });

    it('trims whitespace', () => {
      expect(parseTime('  08:30  ')).toEqual({ hours: 8, minutes: 30 });
    });
  });

  describe('getQuietSleepMs', () => {
    it('returns 0 when outside same-day quiet window', () => {
      // Quiet: 09:00-17:00, now: 20:00
      const now = new Date('2026-03-20T20:00:00');
      expect(getQuietSleepMs('09:00', '17:00', now)).toBe(0);
    });

    it('returns sleep ms when inside same-day quiet window', () => {
      // Quiet: 09:00-17:00, now: 12:00 (local time)
      const now = new Date(2026, 2, 20, 12, 0, 0);
      const ms = getQuietSleepMs('09:00', '17:00', now);
      // Should sleep ~5 hours (300 minutes)
      expect(ms).toBe(300 * 60000);
    });

    it('handles overnight window — current time after start', () => {
      // Quiet: 22:00-06:00, now: 23:00 (local time)
      const now = new Date(2026, 2, 20, 23, 0, 0);
      const ms = getQuietSleepMs('22:00', '06:00', now);
      // Should sleep ~7 hours (420 minutes)
      expect(ms).toBe(420 * 60000);
    });

    it('handles overnight window — current time before end', () => {
      // Quiet: 22:00-06:00, now: 03:00 (local time)
      const now = new Date(2026, 2, 20, 3, 0, 0);
      const ms = getQuietSleepMs('22:00', '06:00', now);
      // Should sleep ~3 hours (180 minutes)
      expect(ms).toBe(180 * 60000);
    });

    it('returns 0 when outside overnight window', () => {
      // Quiet: 22:00-06:00, now: 12:00 (local time)
      const now = new Date(2026, 2, 20, 12, 0, 0);
      expect(getQuietSleepMs('22:00', '06:00', now)).toBe(0);
    });

    it('returns 0 for invalid time strings', () => {
      const now = new Date(2026, 2, 20, 12, 0, 0);
      expect(getQuietSleepMs('invalid', '06:00', now)).toBe(0);
      expect(getQuietSleepMs('22:00', 'invalid', now)).toBe(0);
    });

    it('returns 0 when start equals end', () => {
      const now = new Date('2026-03-20T12:00:00Z');
      expect(getQuietSleepMs('12:00', '12:00', now)).toBe(0);
    });
  });
});
