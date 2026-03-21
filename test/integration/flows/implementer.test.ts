/**
 * Implementer lifecycle integration tests — GitHub Issues.
 *
 * Tests the once orchestrator through various scenarios:
 * - Happy path: full pipeline completion
 * - Empty queue: no tickets, clean exit
 * - Auth failure: board ping fails, clean exit
 * - Dry-run: exits after ticket fetch, no git operations
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
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { resetUsernameCache } from '~/scripts/board/github/github.js';

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
import {
  githubIssuesAuthFailureHandlers,
  githubIssuesEmptyHandlers,
  githubIssuesHandlers,
} from '../mocks/handlers/github-issues.js';
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

// Mock Claude CLI — simulator creates files + commits instead of spawning claude.
// Default throws if called unexpectedly (early-exit tests should never reach invoke).
const defaultClaudeMock = (): boolean => {
  throw new Error('claudeSessionMock called unexpectedly — pipeline should have exited before invoke phase');
};
let claudeSessionMock: (prompt: string, model?: string) => boolean = defaultClaudeMock;

vi.mock('~/scripts/shared/claude-cli/claude-cli.js', () => ({
  invokeClaudeSession: (prompt: string, model?: string) =>
    claudeSessionMock(prompt, model),
  invokeClaudePrint: () => ({ stdout: 'feasible', ok: true }),
}));

// Mock git push operations — can't push to a non-existent remote
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

// Now import run() — it will use the mocked modules above
const { run } = await import('~/scripts/once/once.js');

// ---------------------------------------------------------------------------
// Shared setup helper
// ---------------------------------------------------------------------------

/** Create a temp repo with .clancy/ scaffold, fake remote, and stubbed env. */
function setupTestRepo(): TempRepoResult {
  const result = createTempRepo();

  // Add a fake remote URL so detectRemote() parses it as GitHub
  execFileSync(
    'git',
    [
      'remote',
      'add',
      'origin',
      'https://github.com/test-owner/test-repo.git',
    ],
    { cwd: result.repoPath, stdio: 'pipe' },
  );

  // Create .clancy/ scaffold with GitHub env vars
  createClancyScaffold(result.repoPath, 'github', githubEnv);

  // Commit the scaffold so the working dir is clean
  execFileSync('git', ['add', '-A'], {
    cwd: result.repoPath,
    stdio: 'pipe',
  });
  execFileSync('git', ['commit', '-m', 'chore: add clancy scaffold'], {
    cwd: result.repoPath,
    stdio: 'pipe',
  });

  // Stub env vars for board detection
  for (const [key, value] of Object.entries(githubEnv)) {
    vi.stubEnv(key, value);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Test suites
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
    resetUsernameCache();
    claudeSessionMock = defaultClaudeMock;
    repo?.cleanup();
    repo = undefined;
  });

  it('completes full pipeline: fetch ticket, create branch, simulate Claude, create PR, log progress', async () => {
    const r = (repo = setupTestRepo());

    // Wire Claude simulator — creates valid TS files + commits
    claudeSessionMock = () => {
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

describe('Implementer lifecycle — GitHub Issues empty queue', () => {
  let repo: TempRepoResult | undefined;
  const server = createIntegrationServer(...githubIssuesEmptyHandlers);

  beforeAll(() => startServer(server));
  afterAll(() => stopServer(server));

  afterEach(() => {
    server.resetHandlers();
    vi.unstubAllEnvs();
    resetUsernameCache();
    claudeSessionMock = defaultClaudeMock;
    repo?.cleanup();
    repo = undefined;
  });

  it('exits cleanly when no tickets are available', async () => {
    const r = (repo = setupTestRepo());

    await withCwd(r.repoPath, () => run(['--skip-feasibility']));

    // Assert: no feature branch was created
    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: r.repoPath,
      encoding: 'utf8',
    });
    expect(branches).not.toContain('feature/');

    // Assert: progress.txt is empty (no ticket was processed)
    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress.trim()).toBe('');
  });
});

describe('Implementer lifecycle — GitHub Issues auth failure', () => {
  let repo: TempRepoResult | undefined;
  const server = createIntegrationServer(...githubIssuesAuthFailureHandlers);

  beforeAll(() => startServer(server));
  afterAll(() => stopServer(server));

  afterEach(() => {
    server.resetHandlers();
    vi.unstubAllEnvs();
    resetUsernameCache();
    claudeSessionMock = defaultClaudeMock;
    repo?.cleanup();
    repo = undefined;
  });

  it('exits cleanly when board auth fails', async () => {
    const r = (repo = setupTestRepo());

    await withCwd(r.repoPath, () => run(['--skip-feasibility']));

    // Assert: no feature branch was created
    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: r.repoPath,
      encoding: 'utf8',
    });
    expect(branches).not.toContain('feature/');

    // Assert: progress.txt is empty (pipeline exited at preflight/ping)
    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress.trim()).toBe('');
  });
});

describe('Implementer lifecycle — dry-run mode', () => {
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
    resetUsernameCache();
    claudeSessionMock = defaultClaudeMock;
    repo?.cleanup();
    repo = undefined;
  });

  it('exits after ticket fetch without creating branches or PRs', async () => {
    const r = (repo = setupTestRepo());

    // Run with --dry-run flag — should exit after showing ticket info
    await withCwd(r.repoPath, () =>
      run(['--dry-run', '--skip-feasibility']),
    );

    // Assert: no feature branch was created
    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: r.repoPath,
      encoding: 'utf8',
    });
    expect(branches).not.toContain('feature/');

    // Assert: progress.txt is empty (dry-run doesn't log progress)
    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress.trim()).toBe('');
  });
});
