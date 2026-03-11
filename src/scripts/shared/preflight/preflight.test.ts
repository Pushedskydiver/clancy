import { execSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import { binaryExists, isGitRepo } from './preflight.js';

vi.mock('node:child_process');
vi.mock('node:fs');

const mockExecSync = vi.mocked(execSync);

describe('preflight', () => {
  describe('binaryExists', () => {
    it('returns true when binary is found', () => {
      mockExecSync.mockReturnValue(Buffer.from(''));

      expect(binaryExists('git')).toBe(true);
    });

    it('returns false when binary is not found', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      expect(binaryExists('nonexistent')).toBe(false);
    });
  });

  describe('isGitRepo', () => {
    it('returns true inside a git repo', () => {
      mockExecSync.mockReturnValue(Buffer.from('.git'));

      expect(isGitRepo()).toBe(true);
    });

    it('returns false outside a git repo', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repo');
      });

      expect(isGitRepo()).toBe(false);
    });
  });
});
