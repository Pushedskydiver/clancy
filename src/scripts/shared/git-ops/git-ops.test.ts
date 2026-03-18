import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import {
  branchExists,
  diffAgainstBranch,
  fetchRemoteBranch,
  hasUncommittedChanges,
  pushBranch,
  remoteBranchExists,
} from './git-ops.js';

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

  describe('remoteBranchExists', () => {
    it('returns true when remote branch exists', () => {
      mockExecFileSync.mockReturnValue('abc123\trefs/heads/epic/proj-100\n');

      expect(remoteBranchExists('epic/proj-100')).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['ls-remote', '--heads', 'origin', 'epic/proj-100'],
        expect.objectContaining({ encoding: 'utf8' }),
      );
    });

    it('returns false when remote branch does not exist', () => {
      mockExecFileSync.mockReturnValue('');

      expect(remoteBranchExists('nonexistent')).toBe(false);
    });

    it('returns false when ls-remote fails (network error)', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Could not resolve host');
      });

      expect(remoteBranchExists('epic/proj-100')).toBe(false);
    });
  });

  describe('fetchRemoteBranch', () => {
    it('returns true when fetch succeeds', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''));

      expect(fetchRemoteBranch('feature/proj-123')).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['fetch', 'origin', 'feature/proj-123:feature/proj-123'],
        expect.objectContaining({ encoding: 'utf8' }),
      );
    });

    it('returns false when fetch fails (branch does not exist)', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error("couldn't find remote ref");
      });

      expect(fetchRemoteBranch('nonexistent-branch')).toBe(false);
    });
  });

  describe('diffAgainstBranch', () => {
    it('returns stat output', () => {
      mockExecFileSync.mockReturnValue(
        ' src/index.ts | 5 +++++\n 1 file changed, 5 insertions(+)\n',
      );

      const result = diffAgainstBranch('main');
      expect(result).toContain('src/index.ts');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['diff', 'main...HEAD', '--stat'],
        expect.objectContaining({ encoding: 'utf8' }),
      );
    });

    it('returns undefined on error', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('unknown revision');
      });

      expect(diffAgainstBranch('nonexistent')).toBeUndefined();
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
