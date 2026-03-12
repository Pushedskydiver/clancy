import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import { binaryExists, isGitRepo } from './preflight.js';

vi.mock('node:child_process');
vi.mock('node:fs');

const mockExecFileSync = vi.mocked(execFileSync);

describe('preflight', () => {
  describe('binaryExists', () => {
    it('returns true when binary is found', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''));

      expect(binaryExists('git')).toBe(true);
    });

    it('returns false when binary is not found', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      expect(binaryExists('nonexistent')).toBe(false);
    });
  });

  describe('isGitRepo', () => {
    it('returns true inside a git repo', () => {
      mockExecFileSync.mockReturnValue(Buffer.from('.git'));

      expect(isGitRepo()).toBe(true);
    });

    it('returns false outside a git repo', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not a git repo');
      });

      expect(isGitRepo()).toBe(false);
    });
  });
});
