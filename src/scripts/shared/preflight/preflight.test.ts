import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import { binaryExists, isGitRepo, runPreflight } from './preflight.js';

vi.mock('node:child_process');
vi.mock('node:fs');
vi.mock('~/scripts/shared/env-parser/env-parser.js', () => ({
  loadClancyEnv: () => ({ JIRA_BASE_URL: 'https://test.atlassian.net' }),
}));
vi.mock('~/scripts/shared/git-ops/git-ops.js', () => ({
  hasUncommittedChanges: () => false,
}));

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

  describe('runPreflight connectivity check', () => {
    it('warns when git ls-remote fails', () => {
      mockExecFileSync.mockImplementation((_cmd, args) => {
        const argList = args as string[];
        if (argList?.[0] === 'ls-remote') {
          throw new Error('Could not resolve host');
        }
        return Buffer.from('');
      });

      const result = runPreflight('/tmp/test-project');
      expect(result.ok).toBe(true);
      expect(result.warning).toContain('Could not reach origin');
    });

    it('does not block when git ls-remote fails', () => {
      mockExecFileSync.mockImplementation((_cmd, args) => {
        const argList = args as string[];
        if (argList?.[0] === 'ls-remote') {
          throw new Error('Could not resolve host');
        }
        return Buffer.from('');
      });

      const result = runPreflight('/tmp/test-project');
      expect(result.ok).toBe(true);
    });
  });
});
