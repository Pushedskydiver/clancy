/**
 * Implementer lifecycle integration tests — GitHub Issues happy path.
 *
 * Imports run() from the once orchestrator and exercises the full 13-phase
 * pipeline with MSW intercepting board API calls and the Claude simulator
 * replacing the Claude CLI invocation.
 *
 * Mock boundaries:
 * - Network: MSW intercepts all fetch() calls
 * - Claude: vi.mock on claude-cli module (simulator creates files + commits)
 * - Preflight: vi.mock on runPreflight (skips binary checks, returns env)
 * - Git push: vi.mock on pushBranch (can't push to fake remote)
 * - Git remote: vi.mock on remoteBranchExists + fetchRemoteBranch
 *
 * Everything else runs real: board detection, Zod validation,
 * git branch operations, prompt building, progress logging.
 * Note: env parsing is re-implemented in the preflight mock (reads .clancy/.env
 * directly) because the real runPreflight also checks binaries and git state.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { simulateClaudeSuccess } from '../helpers/claude-simulator.js';
import { githubEnv } from '../helpers/env-fixtures.js';
import {
  createIntegrationServer,
  startServer,
  stopServer,
} from '../helpers/msw-server.js';
import {
  createClancyScaffold,
  createTempRepo,
  withCwd,
  type TempRepoResult,
} from '../helpers/temp-repo.js';
import { githubIssuesHandlers } from '../mocks/handlers/github-issues.js';
import { githubPrHandlers } from '../mocks/handlers/github-pr.js';

// ---------------------------------------------------------------------------
// Module mocks — must be at top level, before any imports that use them
// ---------------------------------------------------------------------------

// Mock preflight to skip binary checks (which claude, git ls-remote, etc.)
// but still return the real env vars from the temp repo's .clancy/.env
vi.mock('~/scripts/shared/preflight/preflight.js', () => ({
  runPreflight: (projectRoot: string) => {
    // Read the .env file directly — skip binary/git/remote checks
    const envPath = join(projectRoot, '.clancy', '.env');
    if (!existsSync(envPath)) {
      return { ok: false, error: '✗ .clancy/.env not found' };
    }
    const content = readFileSync(envPath, 'utf8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
    return { ok: true, env };
  },
  binaryExists: () => true,
  isGitRepo: () => true,
}));

// Mock Claude CLI — simulator creates files + commits instead of spawning claude
let claudeSessionMock: (prompt: string, model?: string) => boolean;

vi.mock('~/scripts/shared/claude-cli/claude-cli.js', () => ({
  invokeClaudeSession: (prompt: string, model?: string) =>
    claudeSessionMock(prompt, model),
  invokeClaudePrint: () => ({ stdout: 'feasible', ok: true }),
}));

// Mock git push operations — can't push to a non-existent remote
vi.mock('~/scripts/shared/git-ops/git-ops.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/scripts/shared/git-ops/git-ops.js')>();
  return {
    ...original,
    pushBranch: () => true,
    remoteBranchExists: () => false,
    fetchRemoteBranch: () => false,
  };
});

// Now import run() — it will use the mocked modules above
const { run } = await import('~/scripts/once/once.js');

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Implementer lifecycle — GitHub Issues happy path', () => {
  let repo: TempRepoResult | undefined;
  const server = createIntegrationServer(
    ...githubIssuesHandlers,
    ...githubPrHandlers,
  );

  beforeAll(() => startServer(server));
  afterAll(() => stopServer(server));

  afterEach(() => {
    server.resetHandlers();
    vi.unstubAllEnvs();
    repo?.cleanup();
    repo = undefined;
  });

  it('completes full pipeline: fetch ticket, create branch, simulate Claude, create PR, log progress', async () => {
    const r = (repo = createTempRepo());

    // Add a fake remote URL so detectRemote() parses it as GitHub
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/test-owner/test-repo.git'], {
      cwd: r.repoPath,
      stdio: 'pipe',
    });

    // Create .clancy/ scaffold with GitHub env vars
    createClancyScaffold(r.repoPath, 'github', githubEnv);

    // Commit the scaffold so the working dir is clean (preflight warns on uncommitted changes)
    execFileSync('git', ['add', '-A'], { cwd: r.repoPath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'chore: add clancy scaffold'], {
      cwd: r.repoPath,
      stdio: 'pipe',
    });

    // Stub env vars for board detection
    for (const [key, value] of Object.entries(githubEnv)) {
      vi.stubEnv(key, value);
    }

    // Wire Claude simulator — creates valid TS files + commits
    claudeSessionMock = (_prompt: string) => {
      simulateClaudeSuccess(r.repoPath, 'issue-1');
      return true;
    };

    // Run the orchestrator inside the temp repo.
    // --skip-feasibility avoids invokeClaudePrint which would spawn real claude.
    await withCwd(r.repoPath, () => run(['--skip-feasibility']));

    // Assert: feature branch was created (orchestrator checks out back to main after deliver)
    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: r.repoPath,
      encoding: 'utf8',
    });
    expect(branches).toContain('feature/issue-1');

    // Assert: progress.txt has a PR_CREATED entry with the ticket key (#1 for GitHub)
    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress).toContain('#1');
    expect(progress).toContain('PR_CREATED');
    expect(progress).toContain('pr:1');

    // Assert: Claude simulator created the implementation file on the feature branch
    const log = execFileSync(
      'git',
      ['log', '--all', '--oneline', '--format=%s'],
      { cwd: r.repoPath, encoding: 'utf8' },
    );
    expect(log).toContain('feat(issue-1): implement ticket');
  });
});
