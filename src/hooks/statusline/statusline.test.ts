import { describe, expect, it } from 'vitest';

import { buildContextBar, buildStatusline, normaliseUsage } from './statusline.js';

describe('statusline', () => {
  describe('normaliseUsage', () => {
    it('returns 0% when fully available', () => {
      expect(normaliseUsage(100)).toBe(0);
    });

    it('returns 100% at the autocompact buffer boundary', () => {
      expect(normaliseUsage(16.5)).toBe(100);
    });

    it('clamps below zero remaining to 100%', () => {
      expect(normaliseUsage(0)).toBe(100);
    });

    it('returns roughly 50% at midpoint', () => {
      // At 58.25% raw remaining: (58.25 - 16.5) / 83.5 * 100 = 50%
      const used = normaliseUsage(58.25);
      expect(used).toBe(50);
    });
  });

  describe('buildContextBar', () => {
    it('uses green for usage below 50%', () => {
      const bar = buildContextBar(30);
      expect(bar).toContain('\x1b[32m'); // green
      expect(bar).toContain('30%');
    });

    it('uses yellow for usage 50-64%', () => {
      const bar = buildContextBar(55);
      expect(bar).toContain('\x1b[33m'); // yellow
      expect(bar).toContain('55%');
    });

    it('uses orange for usage 65-79%', () => {
      const bar = buildContextBar(70);
      expect(bar).toContain('\x1b[38;5;208m'); // orange
      expect(bar).toContain('70%');
    });

    it('uses red blinking skull for usage 80%+', () => {
      const bar = buildContextBar(85);
      expect(bar).toContain('\x1b[5;31m'); // blinking red
      expect(bar).toContain('\uD83D\uDC80'); // skull emoji
      expect(bar).toContain('85%');
    });

    it('has 10 characters in the bar', () => {
      const bar = buildContextBar(50);
      const barChars = bar.match(/[\u2588\u2591]/g);
      expect(barChars).toHaveLength(10);
    });
  });

  describe('buildStatusline', () => {
    it('returns "Clancy" for invalid JSON', () => {
      expect(buildStatusline('not json')).toContain('Clancy');
    });

    it('returns "Clancy" when no context data', () => {
      const result = buildStatusline(JSON.stringify({ session_id: 'test' }));
      expect(result).toContain('Clancy');
    });

    it('includes context bar when context data is present', () => {
      const result = buildStatusline(
        JSON.stringify({
          session_id: 'test',
          context_window: { remaining_percentage: 80 },
        }),
      );
      expect(result).toContain('Clancy');
      expect(result).toMatch(/\d+%/);
    });

    it('includes filled and empty bar characters', () => {
      const result = buildStatusline(
        JSON.stringify({
          session_id: 'test',
          context_window: { remaining_percentage: 58.25 },
        }),
      );
      expect(result).toContain('\u2588'); // filled
      expect(result).toContain('\u2591'); // empty
    });
  });
});
