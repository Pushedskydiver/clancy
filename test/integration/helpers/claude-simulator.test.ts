import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createSequencedClaudeMock,
  simulateClaudeFailure,
  simulateClaudeSuccess,
} from './claude-simulator.js';
import { createTempRepo, type TempRepoResult } from './temp-repo.js';

describe('claude-simulator', () => {
  let repo: TempRepoResult | undefined;

  afterEach(() => {
    repo?.cleanup();
    repo = undefined;
  });

  describe('simulateClaudeSuccess', () => {
    it('creates files, commits, and returns SHA', () => {
      const r = (repo = createTempRepo());
      const sha = simulateClaudeSuccess(r.repoPath, 'TEST-1');

      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(existsSync(join(r.repoPath, 'src', 'test-1.ts'))).toBe(true);
    });

    it('commit message matches conventional format', () => {
      const r = (repo = createTempRepo());
      simulateClaudeSuccess(r.repoPath, 'PROJ-42');

      const msg = execSync('git log -1 --pretty=%s', {
        cwd: r.repoPath,
        encoding: 'utf8',
      }).trim();
      expect(msg).toBe('feat(PROJ-42): implement ticket');
    });

    it('created files pass tsc --noEmit', () => {
      const r = (repo = createTempRepo());
      simulateClaudeSuccess(r.repoPath, 'TEST-1');

      if (existsSync(join(r.repoPath, 'node_modules'))) {
        expect(() =>
          execSync('npx tsc --noEmit', {
            cwd: r.repoPath,
            stdio: 'pipe',
            timeout: 30_000,
          }),
        ).not.toThrow();
      }
    });

    it('accepts custom files override', () => {
      const r = (repo = createTempRepo());
      simulateClaudeSuccess(r.repoPath, 'TEST-1', {
        files: {
          'src/custom.ts': 'export const x = 1;\n',
        },
      });

      expect(existsSync(join(r.repoPath, 'src', 'custom.ts'))).toBe(true);
      expect(existsSync(join(r.repoPath, 'src', 'test-1.ts'))).toBe(false);
    });
  });

  describe('simulateClaudeFailure', () => {
    it('creates files with errors and returns SHA', () => {
      const r = (repo = createTempRepo());
      const sha = simulateClaudeFailure(r.repoPath, 'TEST-2');

      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(existsSync(join(r.repoPath, 'src', 'test-2.ts'))).toBe(true);
    });

    it('created files fail tsc --noEmit', () => {
      const r = (repo = createTempRepo());
      simulateClaudeFailure(r.repoPath, 'TEST-2');

      if (existsSync(join(r.repoPath, 'node_modules'))) {
        expect(() =>
          execSync('npx tsc --noEmit', {
            cwd: r.repoPath,
            stdio: 'pipe',
            timeout: 30_000,
          }),
        ).toThrow();
      }
    });
  });

  describe('createSequencedClaudeMock', () => {
    it('calls failure then success in sequence', () => {
      const r = (repo = createTempRepo());
      const mock = createSequencedClaudeMock([
        { type: 'failure', repoPath: r.repoPath, ticketKey: 'TEST-3' },
        { type: 'success', repoPath: r.repoPath, ticketKey: 'TEST-3' },
      ]);

      // First call — failure
      const result1 = mock('implement ticket', undefined);
      expect(result1).toBe(true);

      // Second call — success (creates a second commit)
      const result2 = mock('fix issues from verification gate', undefined);
      expect(result2).toBe(true);

      // Should have 3 commits: scaffold + failure + success
      const count = execSync('git rev-list --count HEAD', {
        cwd: r.repoPath,
        encoding: 'utf8',
      }).trim();
      expect(parseInt(count, 10)).toBe(3);
    });
  });
});
