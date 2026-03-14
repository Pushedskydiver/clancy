import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import { branchExists, hasUncommittedChanges, pushBranch } from './git-ops.js';

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

  describe('pushBranch', () => {
    it('returns true when push succeeds', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''));

      expect(pushBranch('feature/proj-123')).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['push', '-u', 'origin', 'feature/proj-123'],
        expect.objectContaining({ encoding: 'utf8' }),
      );
    });

    it('returns false when push fails', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('permission denied');
      });

      expect(pushBranch('feature/proj-123')).toBe(false);
    });
  });
});
