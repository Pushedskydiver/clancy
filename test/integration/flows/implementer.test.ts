/**
 * Implementer lifecycle integration tests — all 6 boards.
 *
 * Tests the once orchestrator through various scenarios per board:
 * - Happy path: full pipeline completion
 * - Empty queue: no tickets, clean exit
 * - Auth failure: board ping fails, clean exit
 * - Dry-run: exits after ticket fetch, no git operations
 * - Blocked ticket: skipped when blockers are unresolved
 * - Epic branch targeting: PR targets epic branch, not main
 * - Stale lock cleanup: stale lock.json cleaned up, run proceeds
 *
 * Mock boundaries:
 * - Network: MSW intercepts all fetch() calls
 * - Claude: vi.mock on claude-cli module (simulator creates files + commits)
 * - Preflight: vi.mock on runPreflight (skips binary checks, returns env)
 * - Git push: vi.mock on pushBranch (can't push to fake remote)
 * - Git remote: vi.mock on remoteBranchExists + fetchRemoteBranch (mutable)
 *
 * Everything else runs real: board detection, Zod validation,
 * git branch operations, prompt building, progress logging.
 * Note: env parsing is re-implemented in the preflight mock (reads .clancy/.env
 * directly) because the real runPreflight also checks binaries and git state.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestHandler } from 'msw';

import { resetUsernameCache } from '~/scripts/board/github/github.js';
import {
  resetLabelCache as resetShortcutLabelCache,
  resetWorkflowCache as resetShortcutWorkflowCache,
} from '~/scripts/board/shortcut/shortcut.js';

import { simulateClaudeSuccess } from '../helpers/claude-simulator.js';
import {
  azdoEnv,
  githubEnv,
  jiraEnv,
  linearEnv,
  notionEnv,
  shortcutEnv,
  type BoardProvider,
} from '../helpers/env-fixtures.js';
import { createIntegrationServer, startServer } from '../helpers/msw-server.js';
import {
  createClancyScaffold,
  createEpicBranch,
  createTempRepo,
  withCwd,
  type TempRepoResult,
} from '../helpers/temp-repo.js';
import {
  azdoAuthFailureHandlers,
  azdoBlockedHandlers,
  azdoEmptyHandlers,
  azdoHandlers,
} from '../mocks/handlers/azure-devops.js';
import {
  githubIssuesAuthFailureHandlers,
  githubIssuesEmptyHandlers,
  githubIssuesHandlers,
} from '../mocks/handlers/github-issues.js';
import { githubPrHandlers } from '../mocks/handlers/github-pr.js';
import {
  jiraAuthFailureHandlers,
  jiraBlockedHandlers,
  jiraEmptyHandlers,
  jiraEpicHandlers,
  jiraHandlers,
} from '../mocks/handlers/jira.js';
import {
  linearAuthFailureHandlers,
  linearBlockedHandlers,
  linearEmptyHandlers,
  linearHandlers,
} from '../mocks/handlers/linear.js';
import {
  notionAuthFailureHandlers,
  notionEmptyHandlers,
  notionHandlers,
} from '../mocks/handlers/notion.js';
import {
  shortcutAuthFailureHandlers,
  shortcutBlockedHandlers,
  shortcutEmptyHandlers,
  shortcutHandlers,
} from '../mocks/handlers/shortcut.js';

// ---------------------------------------------------------------------------
// Module mocks — must be at top level, before any imports that use them
// ---------------------------------------------------------------------------

vi.mock('~/scripts/shared/preflight/preflight.js', () => ({
  runPreflight: (projectRoot: string) => {
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

const defaultClaudeMock = (): boolean => {
  throw new Error(
    'claudeSessionMock called unexpectedly — pipeline should have exited before invoke phase',
  );
};
let claudeSessionMock: (prompt: string, model?: string) => boolean =
  defaultClaudeMock;

vi.mock('~/scripts/shared/claude-cli/claude-cli.js', () => ({
  invokeClaudeSession: (prompt: string, model?: string) =>
    claudeSessionMock(prompt, model),
  invokeClaudePrint: () => ({ stdout: 'feasible', ok: true }),
}));

// Mutable git-ops mocks — allow per-test overrides for epic branch scenarios
let remoteBranchExistsFn = (_branch: string): boolean => false;
let fetchRemoteBranchFn = (_branch: string): boolean => false;

vi.mock('~/scripts/shared/git-ops/git-ops.js', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('~/scripts/shared/git-ops/git-ops.js')
    >();
  return {
    ...original,
    pushBranch: () => true,
    remoteBranchExists: (branch: string) => remoteBranchExistsFn(branch),
    fetchRemoteBranch: (branch: string) => fetchRemoteBranchFn(branch),
  };
});

const { run } = await import('~/scripts/once/once.js');

// ---------------------------------------------------------------------------
// Per-board configuration
// ---------------------------------------------------------------------------

type BoardTestConfig = {
  provider: BoardProvider;
  env: Record<string, string>;
  handlers: RequestHandler[];
  emptyHandlers: RequestHandler[];
  authFailureHandlers: RequestHandler[];
  /** The git remote URL to set (determines platform detection for PR creation) */
  remoteUrl: string;
  /** Expected ticket key in progress.txt (e.g. '#1', 'TEST-1', 'TEAM-1') */
  expectedTicketKey: string;
  /** Expected branch name fragment (e.g. 'feature/issue-1', 'feature/test-1') */
  expectedBranch: string;
  /** Slug used for Claude simulator file naming */
  simulatorSlug: string;
};

const boardConfigs: BoardTestConfig[] = [
  {
    provider: 'github',
    env: githubEnv,
    handlers: [...githubIssuesHandlers, ...githubPrHandlers],
    emptyHandlers: githubIssuesEmptyHandlers,
    authFailureHandlers: githubIssuesAuthFailureHandlers,
    remoteUrl: 'https://github.com/test-owner/test-repo.git',
    expectedTicketKey: '#1',
    expectedBranch: 'feature/issue-1',
    simulatorSlug: 'issue-1',
  },
  {
    provider: 'jira',
    env: jiraEnv,
    handlers: [...jiraHandlers, ...githubPrHandlers],
    emptyHandlers: jiraEmptyHandlers,
    authFailureHandlers: jiraAuthFailureHandlers,
    remoteUrl: 'https://github.com/test-owner/test-repo.git',
    expectedTicketKey: 'TEST-1',
    expectedBranch: 'feature/test-1',
    simulatorSlug: 'test-1',
  },
  {
    provider: 'linear',
    env: linearEnv,
    handlers: [...linearHandlers, ...githubPrHandlers],
    emptyHandlers: linearEmptyHandlers,
    authFailureHandlers: linearAuthFailureHandlers,
    remoteUrl: 'https://github.com/test-owner/test-repo.git',
    expectedTicketKey: 'TEAM-1',
    expectedBranch: 'feature/team-1',
    simulatorSlug: 'team-1',
  },
  {
    provider: 'shortcut',
    env: shortcutEnv,
    handlers: [...shortcutHandlers, ...githubPrHandlers],
    emptyHandlers: shortcutEmptyHandlers,
    authFailureHandlers: shortcutAuthFailureHandlers,
    remoteUrl: 'https://github.com/test-owner/test-repo.git',
    expectedTicketKey: 'sc-1',
    expectedBranch: 'feature/sc-1',
    simulatorSlug: 'sc-1',
  },
  {
    provider: 'notion',
    env: notionEnv,
    handlers: [...notionHandlers, ...githubPrHandlers],
    emptyHandlers: notionEmptyHandlers,
    authFailureHandlers: notionAuthFailureHandlers,
    remoteUrl: 'https://github.com/test-owner/test-repo.git',
    expectedTicketKey: 'notion-ab12cd34',
    expectedBranch: 'feature/notion-ab12cd34',
    simulatorSlug: 'notion-ab12cd34',
  },
  {
    provider: 'azdo',
    env: azdoEnv,
    handlers: [...azdoHandlers, ...githubPrHandlers],
    emptyHandlers: azdoEmptyHandlers,
    authFailureHandlers: azdoAuthFailureHandlers,
    remoteUrl: 'https://github.com/test-owner/test-repo.git',
    expectedTicketKey: 'azdo-1',
    expectedBranch: 'feature/azdo-1',
    simulatorSlug: 'azdo-1',
  },
];

// ---------------------------------------------------------------------------
// Blocked ticket configuration (boards with native blocker detection)
// ---------------------------------------------------------------------------

type BlockedTestConfig = {
  provider: BoardProvider;
  env: Record<string, string>;
  blockedHandlers: RequestHandler[];
  remoteUrl: string;
};

const blockedConfigs: BlockedTestConfig[] = [
  {
    provider: 'jira',
    env: jiraEnv,
    blockedHandlers: jiraBlockedHandlers,
    remoteUrl: 'https://github.com/test-owner/test-repo.git',
  },
  {
    provider: 'linear',
    env: linearEnv,
    blockedHandlers: linearBlockedHandlers,
    remoteUrl: 'https://github.com/test-owner/test-repo.git',
  },
  {
    provider: 'shortcut',
    env: shortcutEnv,
    blockedHandlers: shortcutBlockedHandlers,
    remoteUrl: 'https://github.com/test-owner/test-repo.git',
  },
  {
    provider: 'azdo',
    env: azdoEnv,
    blockedHandlers: azdoBlockedHandlers,
    remoteUrl: 'https://github.com/test-owner/test-repo.git',
  },
];

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

function setupTestRepo(
  board: BoardProvider,
  env: Record<string, string>,
  remoteUrl: string,
): TempRepoResult {
  const result = createTempRepo();

  execFileSync('git', ['remote', 'add', 'origin', remoteUrl], {
    cwd: result.repoPath,
    stdio: 'pipe',
  });

  createClancyScaffold(result.repoPath, board, env);

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
  resetShortcutWorkflowCache();
  resetShortcutLabelCache();
  claudeSessionMock = defaultClaudeMock;
  remoteBranchExistsFn = () => false;
  fetchRemoteBranchFn = () => false;
}

// ---------------------------------------------------------------------------
// Parameterised test suites — core scenarios (all 6 boards)
// ---------------------------------------------------------------------------

describe.each(boardConfigs)(
  'Implementer lifecycle — $provider',
  (config) => {
    let repo: TempRepoResult | undefined;
    const happyServer = createIntegrationServer(...config.handlers);
    const emptyServer = createIntegrationServer(...config.emptyHandlers);
    const authFailServer = createIntegrationServer(
      ...config.authFailureHandlers,
    );

    // Track which server is active so we can stop the right one
    let activeServer: ReturnType<typeof createIntegrationServer> | undefined;

    afterEach(() => {
      activeServer?.close();
      activeServer = undefined;
      resetMocks();
      repo?.cleanup();
      repo = undefined;
    });

    it('happy path: full pipeline completion', async () => {
      activeServer = happyServer;
      startServer(happyServer);

      const r = (repo = setupTestRepo(
        config.provider,
        config.env,
        config.remoteUrl,
      ));

      claudeSessionMock = () => {
        simulateClaudeSuccess(r.repoPath, config.simulatorSlug);
        return true;
      };

      await withCwd(r.repoPath, () => run(['--skip-feasibility']));

      // Assert: feature branch created
      const branches = execFileSync('git', ['branch', '--list'], {
        cwd: r.repoPath,
        encoding: 'utf8',
      });
      expect(branches).toContain(config.expectedBranch);

      // Assert: progress.txt has entry with ticket key and PR/push status
      const progress = readFileSync(
        join(r.repoPath, '.clancy', 'progress.txt'),
        'utf8',
      );
      expect(progress).toContain(config.expectedTicketKey);
      // PRs are only created when a git-host token is present; otherwise
      // pushes are logged as PUSHED, so we allow either outcome here.
      expect(progress).toMatch(/PR_CREATED|PUSHED/);

      // Assert: simulator commit exists
      const log = execFileSync(
        'git',
        ['log', '--all', '--oneline', '--format=%s'],
        { cwd: r.repoPath, encoding: 'utf8' },
      );
      expect(log).toContain(
        `feat(${config.simulatorSlug}): implement ticket`,
      );
    });

    it('empty queue: exits cleanly', async () => {
      activeServer = emptyServer;
      startServer(emptyServer);

      const r = (repo = setupTestRepo(
        config.provider,
        config.env,
        config.remoteUrl,
      ));

      await withCwd(r.repoPath, () => run(['--skip-feasibility']));

      const branches = execFileSync('git', ['branch', '--list'], {
        cwd: r.repoPath,
        encoding: 'utf8',
      });
      expect(branches).not.toContain('feature/');

      const progress = readFileSync(
        join(r.repoPath, '.clancy', 'progress.txt'),
        'utf8',
      );
      expect(progress.trim()).toBe('');
    });

    it('auth failure: exits cleanly', async () => {
      activeServer = authFailServer;
      startServer(authFailServer);

      const r = (repo = setupTestRepo(
        config.provider,
        config.env,
        config.remoteUrl,
      ));

      await withCwd(r.repoPath, () => run(['--skip-feasibility']));

      const branches = execFileSync('git', ['branch', '--list'], {
        cwd: r.repoPath,
        encoding: 'utf8',
      });
      expect(branches).not.toContain('feature/');

      const progress = readFileSync(
        join(r.repoPath, '.clancy', 'progress.txt'),
        'utf8',
      );
      expect(progress.trim()).toBe('');
    });

    it('dry-run: exits after ticket fetch', async () => {
      activeServer = happyServer;
      startServer(happyServer);

      const r = (repo = setupTestRepo(
        config.provider,
        config.env,
        config.remoteUrl,
      ));

      await withCwd(r.repoPath, () =>
        run(['--dry-run', '--skip-feasibility']),
      );

      const branches = execFileSync('git', ['branch', '--list'], {
        cwd: r.repoPath,
        encoding: 'utf8',
      });
      expect(branches).not.toContain('feature/');

      const progress = readFileSync(
        join(r.repoPath, '.clancy', 'progress.txt'),
        'utf8',
      );
      expect(progress.trim()).toBe('');
    });
  },
);

// ---------------------------------------------------------------------------
// Blocked ticket tests (4 boards with native blocker detection)
// ---------------------------------------------------------------------------

describe.each(blockedConfigs)(
  'Blocked ticket skip — $provider',
  (config) => {
    let repo: TempRepoResult | undefined;
    let activeServer: ReturnType<typeof createIntegrationServer> | undefined;

    afterEach(() => {
      activeServer?.close();
      activeServer = undefined;
      resetMocks();
      repo?.cleanup();
      repo = undefined;
    });

    it('skips blocked ticket: no branch created', async () => {
      const server = createIntegrationServer(...config.blockedHandlers);
      activeServer = server;
      startServer(server);

      const r = (repo = setupTestRepo(
        config.provider,
        config.env,
        config.remoteUrl,
      ));

      await withCwd(r.repoPath, () => run(['--skip-feasibility']));

      // Assert: no feature branch created
      const branches = execFileSync('git', ['branch', '--list'], {
        cwd: r.repoPath,
        encoding: 'utf8',
      });
      expect(branches).not.toContain('feature/');

      // Assert: no progress entry (blocked ticket is skipped, not logged)
      const progress = readFileSync(
        join(r.repoPath, '.clancy', 'progress.txt'),
        'utf8',
      );
      expect(progress.trim()).toBe('');
    });
  },
);

// ---------------------------------------------------------------------------
// Epic branch targeting (Jira — tests PR targets epic branch, not main)
// ---------------------------------------------------------------------------

describe('Epic branch targeting — jira', () => {
  let repo: TempRepoResult | undefined;
  let activeServer: ReturnType<typeof createIntegrationServer> | undefined;

  afterEach(() => {
    activeServer?.close();
    activeServer = undefined;
    resetMocks();
    repo?.cleanup();
    repo = undefined;
  });

  it('PR targets epic branch when ticket has parent', async () => {
    const server = createIntegrationServer(
      ...jiraEpicHandlers,
      ...githubPrHandlers,
    );
    activeServer = server;
    startServer(server);

    const r = (repo = setupTestRepo(
      'jira',
      jiraEnv,
      'https://github.com/test-owner/test-repo.git',
    ));

    // Pre-create epic branch (simulates existing epic branch from prior child)
    createEpicBranch(r.repoPath, 'test-100');
    // Switch back to main for the orchestrator
    execFileSync('git', ['checkout', 'main'], {
      cwd: r.repoPath,
      stdio: 'pipe',
    });

    // Override remote mocks: epic branch "exists on remote"
    remoteBranchExistsFn = (branch) => branch.startsWith('epic/');
    fetchRemoteBranchFn = (branch) => branch.startsWith('epic/');

    claudeSessionMock = () => {
      simulateClaudeSuccess(r.repoPath, 'test-1');
      return true;
    };

    await withCwd(r.repoPath, () => run(['--skip-feasibility']));

    // Assert: feature branch created
    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: r.repoPath,
      encoding: 'utf8',
    });
    expect(branches).toContain('feature/test-1');

    // Assert: feature branch was created from epic branch (not main)
    // Check that the feature branch has the epic branch as an ancestor
    const mergeBase = execFileSync(
      'git',
      ['merge-base', '--is-ancestor', 'epic/test-100', 'feature/test-1'],
      { cwd: r.repoPath, stdio: 'pipe' },
    );
    // Command exits 0 if epic/test-100 IS an ancestor of feature/test-1
    // (execFileSync would throw on non-zero exit)
    expect(mergeBase).toBeDefined();

    // Assert: progress.txt has entry
    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress).toContain('TEST-1');
    expect(progress).toMatch(/PR_CREATED|PUSHED/);
  });
});

// ---------------------------------------------------------------------------
// Resume detection (GitHub Issues — AFK mode resumes crashed session)
// ---------------------------------------------------------------------------

describe('Resume detection — github (AFK mode)', () => {
  let repo: TempRepoResult | undefined;
  let activeServer: ReturnType<typeof createIntegrationServer> | undefined;

  afterEach(() => {
    activeServer?.close();
    activeServer = undefined;
    resetMocks();
    repo?.cleanup();
    repo = undefined;
  });

  it('resumes crashed session with unpushed commits', async () => {
    const server = createIntegrationServer(
      ...githubIssuesHandlers,
      ...githubPrHandlers,
    );
    activeServer = server;
    startServer(server);

    const r = (repo = setupTestRepo(
      'github',
      githubEnv,
      'https://github.com/test-owner/test-repo.git',
    ));

    // Enable AFK mode (required for auto-resume)
    vi.stubEnv('CLANCY_AFK_MODE', '1');

    // Create a fake origin/main ref so git log origin/main..branch works
    execFileSync(
      'git',
      ['update-ref', 'refs/remotes/origin/main', 'HEAD'],
      { cwd: r.repoPath, stdio: 'pipe' },
    );

    // Create a feature branch with a commit (simulates crash after Claude
    // committed but before push/PR)
    execFileSync('git', ['checkout', '-b', 'feature/issue-99'], {
      cwd: r.repoPath,
      stdio: 'pipe',
    });
    writeFileSync(
      join(r.repoPath, 'src', 'crash-recovery.ts'),
      'export const recovered = true;\n',
    );
    execFileSync('git', ['add', 'src/crash-recovery.ts'], {
      cwd: r.repoPath,
      stdio: 'pipe',
    });
    execFileSync(
      'git',
      ['commit', '-m', 'feat(#99): implement ticket'],
      { cwd: r.repoPath, stdio: 'pipe' },
    );
    // Switch back to main
    execFileSync('git', ['checkout', 'main'], {
      cwd: r.repoPath,
      stdio: 'pipe',
    });

    // Write stale lock pointing to the feature branch
    const staleLock = {
      pid: 999999999,
      ticketKey: '#99',
      ticketTitle: 'Crashed ticket',
      ticketBranch: 'feature/issue-99',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date(Date.now() - 3600_000).toISOString(),
    };
    writeFileSync(
      join(r.repoPath, '.clancy', 'lock.json'),
      JSON.stringify(staleLock, null, 2),
    );

    // No Claude mock needed — resume doesn't invoke Claude
    await withCwd(r.repoPath, () => run(['--skip-feasibility']));

    // Assert: progress.txt has RESUMED entry for the crashed ticket
    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress).toContain('#99');
    expect(progress).toContain('RESUMED');

    // Assert: lock file cleaned up (stale lock deleted in lockCheck,
    // run exits after resume — no new lock created)
    expect(existsSync(join(r.repoPath, '.clancy', 'lock.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stale lock cleanup (GitHub Issues — tests lock.json with dead PID)
// ---------------------------------------------------------------------------

describe('Stale lock cleanup — github', () => {
  let repo: TempRepoResult | undefined;
  let activeServer: ReturnType<typeof createIntegrationServer> | undefined;

  afterEach(() => {
    activeServer?.close();
    activeServer = undefined;
    resetMocks();
    repo?.cleanup();
    repo = undefined;
  });

  it('cleans up stale lock and proceeds normally', async () => {
    const server = createIntegrationServer(
      ...githubIssuesHandlers,
      ...githubPrHandlers,
    );
    activeServer = server;
    startServer(server);

    const r = (repo = setupTestRepo(
      'github',
      githubEnv,
      'https://github.com/test-owner/test-repo.git',
    ));

    // Write a stale lock file with a non-existent PID
    const staleLock = {
      pid: 999999999,
      ticketKey: '#99',
      ticketTitle: 'Old crashed ticket',
      ticketBranch: 'feature/issue-99',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
    };
    writeFileSync(
      join(r.repoPath, '.clancy', 'lock.json'),
      JSON.stringify(staleLock, null, 2),
    );

    claudeSessionMock = () => {
      simulateClaudeSuccess(r.repoPath, 'issue-1');
      return true;
    };

    await withCwd(r.repoPath, () => run(['--skip-feasibility']));

    // Assert: stale lock was cleaned up (lock.json deleted after run)
    expect(existsSync(join(r.repoPath, '.clancy', 'lock.json'))).toBe(false);

    // Assert: normal execution proceeded — feature branch created
    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: r.repoPath,
      encoding: 'utf8',
    });
    expect(branches).toContain('feature/issue-1');

    // Assert: progress entry for new ticket (not the stale one)
    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress).toContain('#1');
    expect(progress).toMatch(/PR_CREATED|PUSHED/);
  });
});
