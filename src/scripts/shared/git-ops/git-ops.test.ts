import { execSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import { branchExists, hasUncommittedChanges } from './git-ops.js';

vi.mock('node:child_process');

const mockExecSync = vi.mocked(execSync);

describe('git-ops', () => {
  describe('hasUncommittedChanges', () => {
    it('returns false when working directory is clean', () => {
      mockExecSync.mockReturnValue(Buffer.from(''));

      expect(hasUncommittedChanges()).toBe(false);
    });

    it('returns true when there are changes', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('changes detected');
      });

      expect(hasUncommittedChanges()).toBe(true);
    });
  });

  describe('branchExists', () => {
    it('returns true when branch exists', () => {
      mockExecSync.mockReturnValue(Buffer.from(''));

      expect(branchExists('main')).toBe(true);
    });

    it('returns false when branch does not exist', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a ref');
      });

      expect(branchExists('nonexistent')).toBe(false);
    });
  });
});
