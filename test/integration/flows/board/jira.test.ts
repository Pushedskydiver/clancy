/**
 * Jira — per-board integration tests.
 *
 * Implementer lifecycle (happy path, empty queue, auth failure, dry-run,
 * blocked ticket skip, epic branch targeting) + board write operations
 * (ensureLabel, addLabel, removeLabel, transitionTicket).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { SetupServer } from 'msw/node';

import type { Board } from '~/scripts/board/board.js';
import { createJiraBoard } from '~/scripts/board/jira/jira-board.js';

import {
  type BoardTestConfig,
  type TempRepoResult,
  createEpicBranch,
  createIntegrationServer,
  createRequestSpy,
  githubGitHostEnv,
  jiraBlockedConfig,
  jiraConfig,
  jiraEnv,
  jiraEpicHandlers,
  resetMocks,
  setupTestRepo,
  simulateClaudeSuccess,
  startServer,
  withCwd,
  JIRA_BASE,
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

function createJiraHandlers(spy: ReturnType<typeof createRequestSpy>): RequestHandler[] {
  return [
    http.get(`${JIRA_BASE}/rest/api/3/issue/:key`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json({
        fields: { labels: [TEST_LABEL] },
      });
    }),
    http.put(`${JIRA_BASE}/rest/api/3/issue/:key`, async ({ request }) => {
      spy.record('PUT', request.url, await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${JIRA_BASE}/rest/api/3/issue/:key/transitions`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json({
        transitions: [
          { id: '31', name: 'In Progress' },
          { id: '41', name: 'Done' },
        ],
      });
    }),
    http.post(`${JIRA_BASE}/rest/api/3/issue/:key/transitions`, async ({ request }) => {
      spy.record('POST', request.url, await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

// ---------------------------------------------------------------------------
// Implementer lifecycle — jira
// ---------------------------------------------------------------------------

describe('Implementer lifecycle — jira', () => {
  const config: BoardTestConfig = jiraConfig;
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
// Blocked ticket skip — jira
// ---------------------------------------------------------------------------

describe('Blocked ticket skip — jira', () => {
  let repo: TempRepoResult | undefined;
  let activeServer: ReturnType<typeof createIntegrationServer> | undefined;

  afterEach(() => {
    activeServer?.close();
    activeServer = undefined;
    resetAllMocks();
    repo?.cleanup();
    repo = undefined;
  });

  it('skips blocked ticket: no branch created', async () => {
    const server = createIntegrationServer(...jiraBlockedConfig.blockedHandlers);
    activeServer = server;
    startServer(server);

    const r = (repo = setupTestRepo(
      jiraBlockedConfig.provider,
      jiraBlockedConfig.env,
      jiraBlockedConfig.remoteUrl,
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
});

// ---------------------------------------------------------------------------
// Epic branch targeting — jira
// ---------------------------------------------------------------------------

describe('Epic branch targeting — jira', () => {
  let repo: TempRepoResult | undefined;
  let activeServer: ReturnType<typeof createIntegrationServer> | undefined;

  afterEach(() => {
    activeServer?.close();
    activeServer = undefined;
    resetAllMocks();
    repo?.cleanup();
    repo = undefined;
  });

  it('PR targets epic branch when ticket has parent', async () => {
    let capturedPrBase: string | undefined;
    const capturingPrHandlers = [
      http.get('https://api.github.com/user', () =>
        HttpResponse.json({ login: 'testuser' }),
      ),
      http.post(
        'https://api.github.com/repos/:owner/:repo/pulls',
        async ({ request }) => {
          const body = (await request.json()) as { base?: string };
          capturedPrBase = body.base;
          return HttpResponse.json(
            {
              number: 1,
              html_url: 'https://github.com/test-owner/test-repo/pull/1',
              state: 'open',
            },
            { status: 201 },
          );
        },
      ),
      http.post(
        'https://api.github.com/repos/:owner/:repo/pulls/:number/requested_reviewers',
        () => HttpResponse.json({}, { status: 201 }),
      ),
    ];

    const server = createIntegrationServer(
      ...jiraEpicHandlers,
      ...capturingPrHandlers,
    );
    activeServer = server;
    startServer(server);

    const jiraWithGitHost = { ...jiraEnv, ...githubGitHostEnv };
    const r = (repo = setupTestRepo(
      'jira',
      jiraWithGitHost,
      'https://github.com/test-owner/test-repo.git',
    ));

    createEpicBranch(r.repoPath, 'test-100');
    execFileSync('git', ['checkout', 'main'], {
      cwd: r.repoPath,
      stdio: 'pipe',
    });

    remoteBranchExistsFn = (branch) => branch.startsWith('epic/');
    fetchRemoteBranchFn = (branch) => branch.startsWith('epic/');

    claudeSessionMock = () => {
      simulateClaudeSuccess(r.repoPath, 'test-1');
      return true;
    };

    await withCwd(r.repoPath, () => run(['--skip-feasibility']));

    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: r.repoPath,
      encoding: 'utf8',
    });
    expect(branches).toContain('feature/test-1');

    const checkAncestry = () =>
      execFileSync(
        'git',
        ['merge-base', '--is-ancestor', 'epic/test-100', 'feature/test-1'],
        { cwd: r.repoPath, stdio: 'pipe' },
      );
    expect(checkAncestry).not.toThrow();

    expect(capturedPrBase).toBe('epic/test-100');

    const progress = readFileSync(
      join(r.repoPath, '.clancy', 'progress.txt'),
      'utf8',
    );
    expect(progress).toContain('TEST-1');
    expect(progress).toMatch(/PR_CREATED|PUSHED/);
  });
});

// ---------------------------------------------------------------------------
// Board write operations — jira
// ---------------------------------------------------------------------------

describe('Board write operations — jira', () => {
  let board: Board;
  let spy: ReturnType<typeof createRequestSpy>;
  let server: SetupServer;

  beforeEach(() => {
    spy = createRequestSpy();
    server = createIntegrationServer(...createJiraHandlers(spy));
    startServer(server);
    board = createJiraBoard(jiraEnv);
  });

  afterEach(() => {
    server.close();
    resetAllMocks();
  });

  describe('ensureLabel', () => {
    it('is a no-op (Jira auto-creates labels)', async () => {
      await board.ensureLabel(TEST_LABEL);

      expect(spy.captured).toHaveLength(0);
    });
  });

  describe('addLabel', () => {
    it('GETs current labels then PUTs updated array', async () => {
      await board.addLabel('TEST-1', NEW_LABEL);

      const gets = spy.captured.filter(
        (r) => r.method === 'GET' && r.url.includes('/issue/TEST-1'),
      );
      const puts = spy.captured.filter((r) => r.method === 'PUT');

      expect(gets).toHaveLength(1);
      expect(puts).toHaveLength(1);
      expect(puts[0].body).toEqual({
        fields: { labels: [TEST_LABEL, NEW_LABEL] },
      });
    });

    it('skips PUT when label already present', async () => {
      await board.addLabel('TEST-1', TEST_LABEL);

      const puts = spy.captured.filter((r) => r.method === 'PUT');
      expect(puts).toHaveLength(0);
    });

    it('makes no HTTP calls for invalid issue key', async () => {
      await board.addLabel('invalid-key', NEW_LABEL);

      expect(spy.captured).toHaveLength(0);
    });
  });

  describe('removeLabel', () => {
    it('GETs current labels then PUTs filtered array', async () => {
      await board.removeLabel('TEST-1', TEST_LABEL);

      const puts = spy.captured.filter((r) => r.method === 'PUT');

      expect(puts).toHaveLength(1);
      expect(puts[0].body).toEqual({
        fields: { labels: [] },
      });
    });

    it('skips PUT when label not present', async () => {
      await board.removeLabel('TEST-1', 'nonexistent');

      const puts = spy.captured.filter((r) => r.method === 'PUT');
      expect(puts).toHaveLength(0);
    });
  });

  describe('transitionTicket', () => {
    it('looks up transition ID then POSTs transition', async () => {
      const result = await board.transitionTicket(
        { key: 'TEST-1', title: 'Test', description: '', parentInfo: 'none', blockers: 'None', labels: [], status: 'To Do' },
        'In Progress',
      );

      expect(result).toBe(true);

      const transitionGets = spy.captured.filter(
        (r) => r.method === 'GET' && r.url.includes('/transitions'),
      );
      const transitionPosts = spy.captured.filter(
        (r) => r.method === 'POST' && r.url.includes('/transitions'),
      );

      expect(transitionGets).toHaveLength(1);
      expect(transitionPosts).toHaveLength(1);
      expect(transitionPosts[0].body).toEqual({
        transition: { id: '31' },
      });
    });

    it('returns false when target status not found in transitions', async () => {
      const result = await board.transitionTicket(
        { key: 'TEST-1', title: 'Test', description: '', parentInfo: 'none', blockers: 'None', labels: [], status: 'To Do' },
        'Nonexistent Status',
      );

      expect(result).toBe(false);
    });
  });
});
