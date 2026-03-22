/**
 * GitHub Issues — per-board integration tests.
 *
 * Implementer lifecycle (happy path, empty queue, auth failure, dry-run,
 * stale lock cleanup, AFK resume detection) + board write operations
 * (ensureLabel, addLabel, removeLabel, transitionTicket).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { SetupServer } from 'msw/node';

import type { Board } from '~/scripts/board/board.js';
import { createGitHubBoard } from '~/scripts/board/github/github-board.js';

import {
  type BoardTestConfig,
  type CapturedRequest,
  type TempRepoResult,
  createIntegrationServer,
  createRequestSpy,
  githubConfig,
  githubEnv,
  githubPrHandlers,
  resetMocks,
  setupTestRepo,
  simulateClaudeSuccess,
  startServer,
  withCwd,
  GITHUB_API,
  TEST_LABEL,
  NEW_LABEL,
} from './shared.js';

// ---------------------------------------------------------------------------
// Module mocks — must be at top level (hoisted per-file)
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
// Local reset
// ---------------------------------------------------------------------------

function resetAllMocks(): void {
  resetMocks();
  claudeSessionMock = defaultClaudeMock;
  remoteBranchExistsFn = () => false;
  fetchRemoteBranchFn = () => false;
}

// ---------------------------------------------------------------------------
// Board write operation handler factory
// ---------------------------------------------------------------------------

function createGitHubHandlers(spy: ReturnType<typeof createRequestSpy>): RequestHandler[] {
  return [
    http.get(`${GITHUB_API}/repos/:owner/:repo/labels/:name`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json({ name: TEST_LABEL });
    }),
    http.post(`${GITHUB_API}/repos/:owner/:repo/labels`, async ({ request }) => {
      spy.record('POST', request.url, await request.json());
      return HttpResponse.json({ name: NEW_LABEL }, { status: 201 });
    }),
    http.post(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels`, async ({ request }) => {
      spy.record('POST', request.url, await request.json());
      return HttpResponse.json([{ name: TEST_LABEL }]);
    }),
    http.delete(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels/:name`, ({ request }) => {
      spy.record('DELETE', request.url);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

// ---------------------------------------------------------------------------
// Implementer lifecycle — github
// ---------------------------------------------------------------------------

describe('Implementer lifecycle — github', () => {
  const config: BoardTestConfig = githubConfig;
  let repo: TempRepoResult | undefined;
  const happyServer = createIntegrationServer(...config.handlers);
  const emptyServer = createIntegrationServer(...config.emptyHandlers);
  const authFailServer = createIntegrationServer(...config.authFailureHandlers);
  let activeServer: ReturnType<typeof createIntegrationServer> | undefined;

  afterEach(() => {
    activeServer?.close();
    activeServer = undefined;
    resetAllMocks();
    repo?.cleanup();
    repo = undefined;
  });

  it('happy path: full pipeline completion', async () => {
    activeServer = happyServer;
    startServer(happyServer);

    const r = (repo = setupTestRepo(config.provider, config.env, config.remoteUrl));

    claudeSessionMock = () => {
      simulateClaudeSuccess(r.repoPath, config.simulatorSlug);
      return true;
    };

    await withCwd(r.repoPath, () => run(['--skip-feasibility']));

    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: r.repoPath,
      encoding: 'utf8',
    });
    expect(branches).toContain(config.expectedBranch);

    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress).toContain(config.expectedTicketKey);
    expect(progress).toMatch(/PR_CREATED|PUSHED/);

    const log = execFileSync(
      'git',
      ['log', '--all', '--oneline', '--format=%s'],
      { cwd: r.repoPath, encoding: 'utf8' },
    );
    expect(log).toContain(`feat(${config.simulatorSlug}): implement ticket`);
  });

  it('empty queue: exits cleanly', async () => {
    activeServer = emptyServer;
    startServer(emptyServer);

    const r = (repo = setupTestRepo(config.provider, config.env, config.remoteUrl));

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

    const r = (repo = setupTestRepo(config.provider, config.env, config.remoteUrl));

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

    const r = (repo = setupTestRepo(config.provider, config.env, config.remoteUrl));

    await withCwd(r.repoPath, () => run(['--dry-run', '--skip-feasibility']));

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
});

// ---------------------------------------------------------------------------
// Stale lock cleanup — github
// ---------------------------------------------------------------------------

describe('Stale lock cleanup — github', () => {
  let repo: TempRepoResult | undefined;
  let activeServer: ReturnType<typeof createIntegrationServer> | undefined;

  afterEach(() => {
    activeServer?.close();
    activeServer = undefined;
    resetAllMocks();
    repo?.cleanup();
    repo = undefined;
  });

  it('cleans up stale lock and proceeds normally', async () => {
    const server = createIntegrationServer(
      ...githubConfig.handlers,
    );
    activeServer = server;
    startServer(server);

    const r = (repo = setupTestRepo(
      'github',
      githubEnv,
      'https://github.com/test-owner/test-repo.git',
    ));

    const staleLock = {
      pid: 999999999,
      ticketKey: '#99',
      ticketTitle: 'Old crashed ticket',
      ticketBranch: 'feature/issue-99',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date(Date.now() - 3600_000).toISOString(),
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

    expect(existsSync(join(r.repoPath, '.clancy', 'lock.json'))).toBe(false);

    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: r.repoPath,
      encoding: 'utf8',
    });
    expect(branches).toContain('feature/issue-1');

    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress).toContain('#1');
    expect(progress).toMatch(/PR_CREATED|PUSHED/);
  });
});

// ---------------------------------------------------------------------------
// Resume detection — github (AFK mode)
// ---------------------------------------------------------------------------

describe('Resume detection — github (AFK mode)', () => {
  let repo: TempRepoResult | undefined;
  let activeServer: ReturnType<typeof createIntegrationServer> | undefined;

  afterEach(() => {
    activeServer?.close();
    activeServer = undefined;
    resetAllMocks();
    repo?.cleanup();
    repo = undefined;
  });

  it('resumes crashed session with unpushed commits', async () => {
    const server = createIntegrationServer(
      ...githubConfig.handlers,
    );
    activeServer = server;
    startServer(server);

    const r = (repo = setupTestRepo(
      'github',
      githubEnv,
      'https://github.com/test-owner/test-repo.git',
    ));

    vi.stubEnv('CLANCY_AFK_MODE', '1');

    execFileSync(
      'git',
      ['update-ref', 'refs/remotes/origin/main', 'HEAD'],
      { cwd: r.repoPath, stdio: 'pipe' },
    );

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
    execFileSync('git', ['checkout', 'main'], {
      cwd: r.repoPath,
      stdio: 'pipe',
    });

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

    await withCwd(r.repoPath, () => run(['--skip-feasibility']));

    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress).toContain('#99');
    expect(progress).toContain('RESUMED');

    expect(existsSync(join(r.repoPath, '.clancy', 'lock.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Board write operations — github
// ---------------------------------------------------------------------------

describe('Board write operations — github', () => {
  let board: Board;
  let spy: ReturnType<typeof createRequestSpy>;
  let server: SetupServer;

  beforeEach(() => {
    spy = createRequestSpy();
    server = createIntegrationServer(...createGitHubHandlers(spy));
    startServer(server);
    board = createGitHubBoard(githubEnv);
  });

  afterEach(() => {
    server.close();
    resetAllMocks();
  });

  describe('ensureLabel', () => {
    it('skips creation when label already exists (GET 200)', async () => {
      await board.ensureLabel(TEST_LABEL);

      const gets = spy.captured.filter(
        (r) => r.method === 'GET' && r.url.includes('/labels/'),
      );
      const posts = spy.captured.filter(
        (r) => r.method === 'POST' && r.url.includes('/labels') && !r.url.includes('/issues/'),
      );

      expect(gets).toHaveLength(1);
      expect(posts).toHaveLength(0);
    });

    it('creates label when GET returns 404', async () => {
      server.use(
        http.get(`${GITHUB_API}/repos/:owner/:repo/labels/:name`, () =>
          HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
        ),
      );

      await board.ensureLabel(NEW_LABEL);

      const posts = spy.captured.filter(
        (r) => r.method === 'POST' && r.url.includes('/repos/') && r.url.endsWith('/labels'),
      );

      expect(posts).toHaveLength(1);
      expect(posts[0].body).toEqual({
        name: NEW_LABEL,
        color: '0075ca',
      });
    });

    it('handles 422 gracefully (label already exists race)', async () => {
      server.use(
        http.get(`${GITHUB_API}/repos/:owner/:repo/labels/:name`, () =>
          HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
        ),
        http.post(`${GITHUB_API}/repos/:owner/:repo/labels`, async ({ request }) => {
          spy.record('POST', request.url, await request.json());
          return HttpResponse.json(
            { message: 'Validation Failed' },
            { status: 422 },
          );
        }),
      );

      await expect(board.ensureLabel(NEW_LABEL)).resolves.toBeUndefined();
    });
  });

  describe('addLabel', () => {
    it('calls ensureLabel then POSTs to issue labels endpoint', async () => {
      await board.addLabel('#1', TEST_LABEL);

      const issueLabels = spy.captured.filter(
        (r) => r.method === 'POST' && r.url.includes('/issues/1/labels'),
      );

      expect(issueLabels).toHaveLength(1);
      expect(issueLabels[0].body).toEqual({ labels: [TEST_LABEL] });
    });
  });

  describe('removeLabel', () => {
    it('DELETEs the label from the issue', async () => {
      await board.removeLabel('#1', TEST_LABEL);

      const deletes = spy.captured.filter((r) => r.method === 'DELETE');

      expect(deletes).toHaveLength(1);
      expect(deletes[0].url).toContain(`/issues/1/labels/${encodeURIComponent(TEST_LABEL)}`);
    });

    it('ignores 404 when label is not on the issue', async () => {
      server.use(
        http.delete(
          `${GITHUB_API}/repos/:owner/:repo/issues/:number/labels/:name`,
          ({ request }) => {
            spy.record('DELETE', request.url);
            return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
          },
        ),
      );

      await expect(board.removeLabel('#1', TEST_LABEL)).resolves.toBeUndefined();
    });
  });

  describe('addLabel — edge cases', () => {
    it('does not POST to issue labels endpoint for invalid issue key', async () => {
      await board.addLabel('not-a-number', TEST_LABEL);

      const issueLabels = spy.captured.filter(
        (r) => r.method === 'POST' && r.url.includes('/issues/'),
      );
      expect(issueLabels).toHaveLength(0);
    });
  });

  describe('transitionTicket', () => {
    it('returns false (GitHub Issues has no status transitions)', async () => {
      const result = await board.transitionTicket(
        { key: '#1', title: 'Test', description: '', parentInfo: 'none', blockers: 'None', labels: [], status: 'open' },
        'closed',
      );

      expect(result).toBe(false);
    });
  });
});
