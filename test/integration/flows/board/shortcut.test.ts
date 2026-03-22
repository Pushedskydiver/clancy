/**
 * Shortcut — per-board integration tests.
 *
 * Implementer lifecycle (happy path, empty queue, auth failure, dry-run,
 * blocked ticket skip) + board write operations (ensureLabel, addLabel,
 * removeLabel, transitionTicket).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { SetupServer } from 'msw/node';

import type { Board } from '~/scripts/board/board.js';
import { createShortcutBoard } from '~/scripts/board/shortcut/shortcut-board.js';
import {
  resetLabelCache as resetShortcutLabelCache,
  resetWorkflowCache as resetShortcutWorkflowCache,
} from '~/scripts/board/shortcut/shortcut.js';

import {
  type BoardTestConfig,
  type TempRepoResult,
  createIntegrationServer,
  createRequestSpy,
  shortcutBlockedConfig,
  shortcutConfig,
  shortcutEnv,
  resetMocks,
  setupTestRepo,
  simulateClaudeSuccess,
  startServer,
  withCwd,
  SHORTCUT_BASE,
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

function createShortcutHandlers(spy: ReturnType<typeof createRequestSpy>): RequestHandler[] {
  return [
    http.get(`${SHORTCUT_BASE}/labels`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json([
        { id: 1, name: TEST_LABEL },
        { id: 42, name: NEW_LABEL },
      ]);
    }),
    http.post(`${SHORTCUT_BASE}/labels`, async ({ request }) => {
      spy.record('POST', request.url, await request.json());
      return HttpResponse.json({ id: 99, name: 'new-label' }, { status: 201 });
    }),
    http.get(`${SHORTCUT_BASE}/stories/:id`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json({
        id: 1,
        name: 'Test story',
        label_ids: [1],
        labels: [{ id: 1, name: TEST_LABEL }],
        workflow_state_id: 100,
        story_links: [],
        blocked: false,
      });
    }),
    http.put(`${SHORTCUT_BASE}/stories/:id`, async ({ request }) => {
      spy.record('PUT', request.url, await request.json());
      return HttpResponse.json({ id: 1, name: 'Test story' });
    }),
    http.get(`${SHORTCUT_BASE}/workflows`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json([
        {
          id: 1,
          name: 'Engineering',
          states: [
            { id: 100, name: 'Unstarted', type: 'unstarted' },
            { id: 101, name: 'In Progress', type: 'started' },
            { id: 102, name: 'Done', type: 'done' },
          ],
        },
      ]);
    }),
  ];
}

// ---------------------------------------------------------------------------
// Implementer lifecycle — shortcut
// ---------------------------------------------------------------------------

describe('Implementer lifecycle — shortcut', () => {
  const config: BoardTestConfig = shortcutConfig;
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
// Blocked ticket skip — shortcut
// ---------------------------------------------------------------------------

describe('Blocked ticket skip — shortcut', () => {
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
    const server = createIntegrationServer(...shortcutBlockedConfig.blockedHandlers);
    activeServer = server;
    startServer(server);

    const r = (repo = setupTestRepo(
      shortcutBlockedConfig.provider,
      shortcutBlockedConfig.env,
      shortcutBlockedConfig.remoteUrl,
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
// Board write operations — shortcut
// ---------------------------------------------------------------------------

describe('Board write operations — shortcut', () => {
  let board: Board;
  let spy: ReturnType<typeof createRequestSpy>;
  let server: SetupServer;

  beforeEach(() => {
    resetShortcutWorkflowCache();
    resetShortcutLabelCache();
    spy = createRequestSpy();
    server = createIntegrationServer(...createShortcutHandlers(spy));
    startServer(server);
    board = createShortcutBoard(shortcutEnv);
  });

  afterEach(() => {
    server.close();
    resetAllMocks();
    resetShortcutWorkflowCache();
    resetShortcutLabelCache();
  });

  describe('ensureLabel', () => {
    it('skips creation when label already exists', async () => {
      await board.ensureLabel(TEST_LABEL);

      const posts = spy.captured.filter(
        (r) => r.method === 'POST' && r.url.includes('/labels'),
      );
      expect(posts).toHaveLength(0);
    });

    it('creates label when not found', async () => {
      server.use(
        http.get(`${SHORTCUT_BASE}/labels`, ({ request }) => {
          spy.record('GET', request.url);
          return HttpResponse.json([]);
        }),
      );

      await board.ensureLabel('new-label');

      const posts = spy.captured.filter(
        (r) => r.method === 'POST' && r.url.includes('/labels'),
      );
      expect(posts).toHaveLength(1);
    });
  });

  describe('addLabel', () => {
    it('fetches labels, gets story label IDs, PUTs updated array', async () => {
      await board.addLabel('sc-1', NEW_LABEL);

      const puts = spy.captured.filter((r) => r.method === 'PUT');

      expect(puts).toHaveLength(1);
      expect(puts[0].body).toEqual({ label_ids: [1, 42] });
    });

    it('skips PUT when label already on story', async () => {
      await board.addLabel('sc-1', TEST_LABEL);

      const puts = spy.captured.filter((r) => r.method === 'PUT');
      expect(puts).toHaveLength(0);
    });
  });

  describe('removeLabel', () => {
    it('PUTs story with filtered label IDs', async () => {
      await board.removeLabel('sc-1', TEST_LABEL);

      const puts = spy.captured.filter((r) => r.method === 'PUT');

      expect(puts).toHaveLength(1);
      expect(puts[0].body).toEqual({ label_ids: [] });
    });
  });

  describe('transitionTicket', () => {
    it('resolves workflow state ID then PUTs story', async () => {
      const result = await board.transitionTicket(
        { key: 'sc-1', title: 'Test', description: '', parentInfo: 'none', blockers: 'None', labels: [], status: 'unstarted', issueId: '1' },
        'In Progress',
      );

      expect(result).toBe(true);

      const puts = spy.captured.filter(
        (r) => r.method === 'PUT' && r.url.includes('/stories/'),
      );
      expect(puts).toHaveLength(1);
      expect(puts[0].body).toMatchObject({
        workflow_state_id: 101,
      });
    });

    it('returns false when workflow state not found', async () => {
      const result = await board.transitionTicket(
        { key: 'sc-1', title: 'Test', description: '', parentInfo: 'none', blockers: 'None', labels: [], status: 'unstarted', issueId: '1' },
        'Nonexistent State',
      );

      expect(result).toBe(false);
    });
  });
});
