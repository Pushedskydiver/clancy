import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import { branchExists, hasUncommittedChanges } from './git-ops.js';

vi.mock('node:child_process');

const mockExecFileSync = vi.mocked(execFileSync);

describe('git-ops', () => {
  describe('hasUncommittedChanges', () => {
    it('returns false when working directory is clean', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''));

      expect(hasUncommittedChanges()).toBe(false);
    });

    it('returns true when there are changes', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('changes detected');
      });

      expect(hasUncommittedChanges()).toBe(true);
    });
  });

  describe('branchExists', () => {
    it('returns true when branch exists', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''));

      expect(branchExists('main')).toBe(true);
    });

    it('returns false when branch does not exist', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not a ref');
      });

      expect(branchExists('nonexistent')).toBe(false);
    });
  });
});
