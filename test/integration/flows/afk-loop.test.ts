/**
 * AFK loop integration tests — runAfkLoop with in-process runner.
 *
 * Tests the AFK runner through three scenarios:
 * - Processes N tickets then exits at MAX_ITERATIONS
 * - Exits cleanly when queue is empty (stop condition)
 * - Exits on preflight failure stop condition
 *
 * The runner injection (shipped v0.8.2) allows MSW to intercept board API
 * calls by calling run() in-process instead of spawning a child process.
 *
 * Mock boundaries (same as implementer.test.ts):
 * - Network: MSW intercepts all fetch() calls
 * - Claude: vi.mock on claude-cli module (simulator creates files + commits)
 * - Preflight: vi.mock on runPreflight (reads .clancy/.env directly)
 * - Git push: vi.mock on pushBranch
 * - Git remote: vi.mock on remoteBranchExists + fetchRemoteBranch
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type OnceRunnerResult } from '~/scripts/afk/afk.js';
import { resetUsernameCache } from '~/scripts/board/github/github.js';

import { simulateClaudeSuccess } from '../helpers/claude-simulator.js';
import { githubEnv } from '../helpers/env-fixtures.js';
import { createIntegrationServer, startServer } from '../helpers/msw-server.js';
import {
  createClancyScaffold,
  createTempRepo,
  type TempRepoResult,
} from '../helpers/temp-repo.js';
import {
  githubIssuesEmptyHandlers,
  githubIssuesHandlers,
} from '../mocks/handlers/github-issues.js';
import { githubPrHandlers } from '../mocks/handlers/github-pr.js';

// ---------------------------------------------------------------------------
// Module mocks — must be at top level, before any imports that use them
// ---------------------------------------------------------------------------

vi.mock('~/scripts/shared/preflight/preflight.js', () => ({
  runPreflight: (projectRoot: string) => {
    const { existsSync, readFileSync: readSync } = require('node:fs');
    const { join: joinPath } = require('node:path');
    const envPath = joinPath(projectRoot, '.clancy', '.env');
    if (!existsSync(envPath)) {
      return { ok: false, error: '✗ .clancy/.env not found' };
    }
    const content = readSync(envPath, 'utf8');
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

let claudeSessionMock: (prompt: string, model?: string) => boolean = () => {
  throw new Error('claudeSessionMock called unexpectedly');
};

vi.mock('~/scripts/shared/claude-cli/claude-cli.js', () => ({
  invokeClaudeSession: (prompt: string, model?: string) =>
    claudeSessionMock(prompt, model),
  invokeClaudePrint: () => ({ stdout: 'feasible', ok: true }),
}));

vi.mock('~/scripts/shared/git-ops/git-ops.js', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('~/scripts/shared/git-ops/git-ops.js')
    >();
  return {
    ...original,
    pushBranch: () => true,
    remoteBranchExists: () => false,
    fetchRemoteBranch: () => false,
  };
});

const { run } = await import('~/scripts/once/once.js');
const { runAfkLoop } = await import('~/scripts/afk/afk.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an in-process runner that calls run() and captures its stdout.
 *
 * This is the key integration: MSW intercepts HTTP in the current process,
 * so calling run() directly (instead of spawning a subprocess) lets MSW
 * handle board API calls.
 */
function createInProcessRunner(
  repoPath: string,
): () => Promise<OnceRunnerResult> {
  return async () => {
    const originalCwd = process.cwd();
    const originalWrite = process.stdout.write;
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    let captured = '';

    // Capture all stdout/console output
    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    }) as typeof process.stdout.write;
    console.log = (...args: unknown[]) => {
      captured += args.map(String).join(' ') + '\n';
    };
    console.error = (...args: unknown[]) => {
      captured += args.map(String).join(' ') + '\n';
    };
    console.warn = (...args: unknown[]) => {
      captured += args.map(String).join(' ') + '\n';
    };

    try {
      // Reset to main before each iteration (mirrors real AFK: each subprocess
      // starts on main with a clean working tree)
      execFileSync('git', ['checkout', 'main'], {
        cwd: repoPath,
        stdio: 'pipe',
      });
      execFileSync('git', ['checkout', '--', '.'], {
        cwd: repoPath,
        stdio: 'pipe',
      });

      process.chdir(repoPath);
      await run(['--skip-feasibility']);
      return { stdout: captured, error: undefined };
    } catch (error) {
      return {
        stdout: captured,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } finally {
      process.stdout.write = originalWrite;
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      process.chdir(originalCwd);
    }
  };
}

function setupTestRepo(
  env: Record<string, string>,
  remoteUrl: string,
): TempRepoResult {
  const result = createTempRepo();

  execFileSync('git', ['remote', 'add', 'origin', remoteUrl], {
    cwd: result.repoPath,
    stdio: 'pipe',
  });

  createClancyScaffold(result.repoPath, 'github', env);

  // Create a dummy clancy-once.js (runAfkLoop checks it exists)
  writeFileSync(
    join(result.repoPath, '.clancy', 'clancy-once.js'),
    '// placeholder — runner injection bypasses this\n',
  );

  execFileSync('git', ['add', '-A'], {
    cwd: result.repoPath,
    stdio: 'pipe',
  });
  execFileSync('git', ['commit', '-m', 'chore: add clancy scaffold'], {
    cwd: result.repoPath,
    stdio: 'pipe',
  });

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }

  return result;
}

function resetMocks(): void {
  vi.unstubAllEnvs();
  resetUsernameCache();
  claudeSessionMock = () => {
    throw new Error('claudeSessionMock called unexpectedly');
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AFK loop — github', () => {
  let repo: TempRepoResult | undefined;
  let activeServer: ReturnType<typeof createIntegrationServer> | undefined;

  afterEach(() => {
    activeServer?.close();
    activeServer = undefined;
    resetMocks();
    repo?.cleanup();
    repo = undefined;
  });

  it('processes N tickets then exits at MAX_ITERATIONS', async () => {
    const server = createIntegrationServer(
      ...githubIssuesHandlers,
      ...githubPrHandlers,
    );
    activeServer = server;
    startServer(server);

    const r = (repo = setupTestRepo(
      githubEnv,
      'https://github.com/test-owner/test-repo.git',
    ));

    let callCount = 0;
    claudeSessionMock = () => {
      callCount++;
      simulateClaudeSuccess(r.repoPath, `issue-1`);
      return true;
    };

    const runner = createInProcessRunner(r.repoPath);
    const scriptDir = join(r.repoPath, '.clancy');

    await runAfkLoop(scriptDir, 2, runner);

    // Assert: runner was called twice (MAX_ITERATIONS=2)
    expect(callCount).toBe(2);

    // Assert: progress.txt has entries
    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress).toContain('#1');
  });

  it('exits cleanly on empty queue', async () => {
    const server = createIntegrationServer(...githubIssuesEmptyHandlers);
    activeServer = server;
    startServer(server);

    const r = (repo = setupTestRepo(
      githubEnv,
      'https://github.com/test-owner/test-repo.git',
    ));

    const runner = createInProcessRunner(r.repoPath);
    const scriptDir = join(r.repoPath, '.clancy');

    await runAfkLoop(scriptDir, 5, runner);

    // Assert: no feature branches created
    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: r.repoPath,
      encoding: 'utf8',
    });
    expect(branches).not.toContain('feature/');

    // Assert: progress.txt is empty (no tickets processed)
    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress.trim()).toBe('');
  });

  it('stops on preflight failure', async () => {
    // No MSW server needed — preflight will fail before any HTTP calls
    const r = (repo = setupTestRepo(
      githubEnv,
      'https://github.com/test-owner/test-repo.git',
    ));

    // Delete .clancy/.env to trigger preflight failure
    unlinkSync(join(r.repoPath, '.clancy', '.env'));

    const runner = createInProcessRunner(r.repoPath);
    const scriptDir = join(r.repoPath, '.clancy');

    // Runner should stop after first iteration (preflight failure → stop condition)
    await runAfkLoop(scriptDir, 5, runner);

    // Assert: no feature branches created
    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: r.repoPath,
      encoding: 'utf8',
    });
    expect(branches).not.toContain('feature/');

    // Assert: progress.txt is empty
    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress.trim()).toBe('');
  });
});
