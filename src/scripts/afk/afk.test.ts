import { describe, expect, it } from 'vitest';

import { checkStopCondition } from './afk.js';

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
});
