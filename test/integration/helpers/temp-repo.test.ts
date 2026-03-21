import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createClancyScaffold,
  createEpicBranch,
  createTempRepo,
  type TempRepoResult,
} from './temp-repo.js';

describe('temp-repo', () => {
  let repo: TempRepoResult | undefined;

  afterEach(() => {
    repo?.cleanup();
    repo = undefined;
  });

  it('creates a repo with main branch and initial commit', () => {
    const r = (repo = createTempRepo());

    const branch = execSync('git branch --show-current', {
      cwd: r.repoPath,
      encoding: 'utf8',
    }).trim();
    expect(branch).toBe('main');

    const log = execSync('git log --oneline', {
      cwd: r.repoPath,
      encoding: 'utf8',
    }).trim();
    expect(log).toContain('initial scaffold');
  });

  it('creates a custom base branch when requested', () => {
    const r = (repo = createTempRepo({ baseBranch: 'develop' }));

    const branch = execSync('git branch --show-current', {
      cwd: r.repoPath,
      encoding: 'utf8',
    }).trim();
    expect(branch).toBe('develop');
  });

  it('scaffold has valid TypeScript (tsc --noEmit passes)', () => {
    const r = (repo = createTempRepo());

    // Only run tsc if node_modules exists (global setup provides it)
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

  it('creates Clancy scaffold with expected structure', () => {
    const r = (repo = createTempRepo());
    createClancyScaffold(r.repoPath, 'jira', {
      JIRA_BASE_URL: 'https://test.atlassian.net',
      JIRA_USER: 'test@example.com',
    });

    expect(existsSync(join(r.repoPath, '.clancy', '.env'))).toBe(true);
    expect(existsSync(join(r.repoPath, '.clancy', '.env.example'))).toBe(true);
    expect(existsSync(join(r.repoPath, '.clancy', 'progress.txt'))).toBe(true);
    expect(existsSync(join(r.repoPath, '.clancy', 'docs', 'STACK.md'))).toBe(
      true,
    );
    expect(
      existsSync(join(r.repoPath, '.clancy', 'docs', 'CONVENTIONS.md')),
    ).toBe(true);
  });

  it('cleanup removes the directory', () => {
    const r = (repo = createTempRepo());
    const path = r.repoPath;
    expect(existsSync(path)).toBe(true);

    r.cleanup();
    expect(existsSync(path)).toBe(false);
    repo = undefined; // prevent afterEach from double-cleaning
  });

  it('creates epic branch from correct base', () => {
    const r = (repo = createTempRepo());
    createEpicBranch(r.repoPath, 'PROJ-100');

    const branch = execSync('git branch --show-current', {
      cwd: r.repoPath,
      encoding: 'utf8',
    }).trim();
    expect(branch).toBe('epic/proj-100');

    // Verify it branched from main (same commit)
    const mainSha = execSync('git rev-parse main', {
      cwd: r.repoPath,
      encoding: 'utf8',
    }).trim();
    const epicSha = execSync('git rev-parse HEAD', {
      cwd: r.repoPath,
      encoding: 'utf8',
    }).trim();
    expect(epicSha).toBe(mainSha);
  });
});
