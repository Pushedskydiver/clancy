/**
 * Implementer lifecycle integration tests — all 6 boards.
 *
 * Tests the once orchestrator through various scenarios per board:
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
  createTempRepo,
  withCwd,
  type TempRepoResult,
} from '../helpers/temp-repo.js';
import {
  azdoAuthFailureHandlers,
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
  jiraEmptyHandlers,
  jiraHandlers,
} from '../mocks/handlers/jira.js';
import {
  linearAuthFailureHandlers,
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

// ---------------------------------------------------------------------------
// Parameterised test suites
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
      vi.unstubAllEnvs();
      resetUsernameCache();
      resetShortcutWorkflowCache();
      resetShortcutLabelCache();
      claudeSessionMock = defaultClaudeMock;
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
