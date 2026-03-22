/**
 * Notion — per-board integration tests.
 *
 * Implementer lifecycle (happy path, empty queue, auth failure, dry-run)
 * + board write operations (ensureLabel, addLabel, removeLabel,
 * transitionTicket).
 *
 * Note: Notion has no native blocker detection, so no blocked ticket test.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { SetupServer } from 'msw/node';

import type { Board } from '~/scripts/board/board.js';
import { createNotionBoard } from '~/scripts/board/notion/notion-board.js';

import {
  type BoardTestConfig,
  type TempRepoResult,
  createIntegrationServer,
  createRequestSpy,
  notionConfig,
  notionEnv,
  resetMocks,
  setupTestRepo,
  simulateClaudeSuccess,
  startServer,
  withCwd,
  NOTION_BASE,
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

function createNotionHandlers(spy: ReturnType<typeof createRequestSpy>): RequestHandler[] {
  const page = {
    id: 'ab12cd34-5678-9abc-def0-123456789abc',
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'Test page' }] },
      Status: { type: 'status', status: { name: 'Not started' } },
      Labels: {
        type: 'multi_select',
        multi_select: [{ name: TEST_LABEL }],
      },
    },
  };

  return [
    http.post(`${NOTION_BASE}/v1/databases/:id/query`, async ({ request }) => {
      spy.record('POST', request.url, await request.json());
      return HttpResponse.json({
        results: [page],
        has_more: false,
        next_cursor: null,
      });
    }),
    http.patch(`${NOTION_BASE}/v1/pages/:id`, async ({ request }) => {
      spy.record('PATCH', request.url, await request.json());
      return HttpResponse.json(page);
    }),
  ];
}

// ---------------------------------------------------------------------------
// Implementer lifecycle — notion
// ---------------------------------------------------------------------------

describe('Implementer lifecycle — notion', () => {
  const config: BoardTestConfig = notionConfig;
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
// Board write operations — notion
// ---------------------------------------------------------------------------

describe('Board write operations — notion', () => {
  let board: Board;
  let spy: ReturnType<typeof createRequestSpy>;
  let server: SetupServer;

  beforeEach(() => {
    spy = createRequestSpy();
    server = createIntegrationServer(...createNotionHandlers(spy));
    startServer(server);
    board = createNotionBoard(notionEnv);
  });

  afterEach(() => {
    server.close();
    resetAllMocks();
  });

  describe('ensureLabel', () => {
    it('is a no-op (Notion auto-creates multi_select options)', async () => {
      await board.ensureLabel(TEST_LABEL);

      expect(spy.captured).toHaveLength(0);
    });
  });

  describe('addLabel', () => {
    it('queries database for page then PATCHes with appended label', async () => {
      await board.addLabel('notion-ab12cd34', NEW_LABEL);

      const patches = spy.captured.filter((r) => r.method === 'PATCH');

      expect(patches).toHaveLength(1);
      expect(patches[0].body).toMatchObject({
        properties: {
          Labels: {
            multi_select: expect.arrayContaining([
              { name: TEST_LABEL },
              { name: NEW_LABEL },
            ]),
          },
        },
      });
    });

    it('skips PATCH when label already present', async () => {
      await board.addLabel('notion-ab12cd34', TEST_LABEL);

      const patches = spy.captured.filter((r) => r.method === 'PATCH');
      expect(patches).toHaveLength(0);
    });
  });

  describe('removeLabel', () => {
    it('PATCHes page with filtered multi_select', async () => {
      await board.removeLabel('notion-ab12cd34', TEST_LABEL);

      const patches = spy.captured.filter((r) => r.method === 'PATCH');

      expect(patches).toHaveLength(1);
      expect(patches[0].body).toMatchObject({
        properties: {
          Labels: { multi_select: [] },
        },
      });
    });
  });

  describe('transitionTicket', () => {
    it('PATCHes page with status property', async () => {
      const result = await board.transitionTicket(
        {
          key: 'notion-ab12cd34', title: 'Test', description: '', parentInfo: 'none',
          blockers: 'None', labels: [], status: 'To-do',
          issueId: 'ab12cd34-5678-9abc-def0-123456789abc',
        },
        'In Progress',
      );

      expect(result).toBe(true);

      const patches = spy.captured.filter((r) => r.method === 'PATCH');
      expect(patches).toHaveLength(1);
      expect(patches[0].body).toMatchObject({
        properties: {
          Status: { status: { name: 'In Progress' } },
        },
      });
    });
  });
});
