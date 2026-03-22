/**
 * Linear — per-board integration tests.
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
import { createLinearBoard } from '~/scripts/board/linear/linear-board.js';

import {
  type BoardTestConfig,
  type TempRepoResult,
  createIntegrationServer,
  createRequestSpy,
  linearBlockedConfig,
  linearConfig,
  linearEnv,
  resetMocks,
  setupTestRepo,
  simulateClaudeSuccess,
  startServer,
  withCwd,
  LINEAR_API,
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

function createLinearHandlers(spy: ReturnType<typeof createRequestSpy>): RequestHandler[] {
  return [
    http.post(LINEAR_API, async ({ request }) => {
      const body = (await request.json()) as { query: string; variables?: Record<string, unknown> };
      const query = body.query ?? '';

      spy.record('POST', request.url, body);

      if (query.includes('team') && query.includes('labels') && !query.includes('issueLabels')) {
        return HttpResponse.json({
          data: {
            team: {
              labels: { nodes: [{ id: 'label-build-id', name: TEST_LABEL }] },
            },
          },
        });
      }

      if (query.includes('issueLabels')) {
        return HttpResponse.json({
          data: {
            issueLabels: { nodes: [{ id: 'label-build-id', name: TEST_LABEL }] },
          },
        });
      }

      if (query.includes('issueLabelCreate')) {
        return HttpResponse.json({
          data: {
            issueLabelCreate: {
              issueLabel: { id: 'label-new-id' },
              success: true,
            },
          },
        });
      }

      if (query.includes('issueSearch') || (query.includes('issues') && query.includes('identifier'))) {
        return HttpResponse.json({
          data: {
            issueSearch: {
              nodes: [
                {
                  id: 'issue-uuid-001',
                  labels: {
                    nodes: [{ id: 'label-build-id', name: TEST_LABEL }],
                  },
                },
              ],
            },
          },
        });
      }

      if (query.includes('issueUpdate')) {
        return HttpResponse.json({
          data: { issueUpdate: { success: true } },
        });
      }

      if (query.includes('workflowStates')) {
        return HttpResponse.json({
          data: {
            workflowStates: {
              nodes: [
                { id: 'state-1', name: 'Todo', type: 'unstarted' },
                { id: 'state-2', name: 'In Progress', type: 'started' },
                { id: 'state-3', name: 'Done', type: 'completed' },
              ],
            },
          },
        });
      }

      return HttpResponse.json(
        { errors: [{ message: `Unhandled: ${query.slice(0, 80)}` }] },
        { status: 400 },
      );
    }),
  ];
}

// ---------------------------------------------------------------------------
// Implementer lifecycle — linear
// ---------------------------------------------------------------------------

describe('Implementer lifecycle — linear', () => {
  const config: BoardTestConfig = linearConfig;
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
// Blocked ticket skip — linear
// ---------------------------------------------------------------------------

describe('Blocked ticket skip — linear', () => {
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
    const server = createIntegrationServer(...linearBlockedConfig.blockedHandlers);
    activeServer = server;
    startServer(server);

    const r = (repo = setupTestRepo(
      linearBlockedConfig.provider,
      linearBlockedConfig.env,
      linearBlockedConfig.remoteUrl,
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
// Board write operations — linear
// ---------------------------------------------------------------------------

describe('Board write operations — linear', () => {
  let board: Board;
  let spy: ReturnType<typeof createRequestSpy>;
  let server: SetupServer;

  beforeEach(() => {
    spy = createRequestSpy();
    server = createIntegrationServer(...createLinearHandlers(spy));
    startServer(server);
    board = createLinearBoard(linearEnv);
  });

  afterEach(() => {
    server.close();
    resetAllMocks();
  });

  describe('ensureLabel', () => {
    it('finds label in team labels and caches it (no create)', async () => {
      await board.ensureLabel(TEST_LABEL);

      const queries = spy.captured.filter(
        (r) => (r.body as { query: string }).query?.includes('team') &&
               (r.body as { query: string }).query?.includes('labels'),
      );

      expect(queries.length).toBeGreaterThanOrEqual(1);

      const creates = spy.captured.filter(
        (r) => (r.body as { query: string }).query?.includes('issueLabelCreate'),
      );
      expect(creates).toHaveLength(0);
    });

    it('creates label when not found in team or workspace', async () => {
      server.use(
        http.post(LINEAR_API, async ({ request }) => {
          const body = (await request.json()) as { query: string; variables?: Record<string, unknown> };
          const query = body.query ?? '';

          spy.record('POST', request.url, body);

          if (query.includes('team') && query.includes('labels') && !query.includes('issueLabels')) {
            return HttpResponse.json({
              data: { team: { labels: { nodes: [] } } },
            });
          }

          if (query.includes('issueLabels')) {
            return HttpResponse.json({
              data: { issueLabels: { nodes: [] } },
            });
          }

          if (query.includes('issueLabelCreate')) {
            return HttpResponse.json({
              data: {
                issueLabelCreate: {
                  issueLabel: { id: 'label-new-id' },
                  success: true,
                },
              },
            });
          }

          return HttpResponse.json(
            { errors: [{ message: `Unhandled: ${query.slice(0, 80)}` }] },
            { status: 400 },
          );
        }),
      );

      await board.ensureLabel(NEW_LABEL);

      const creates = spy.captured.filter(
        (r) => (r.body as { query: string }).query?.includes('issueLabelCreate'),
      );
      expect(creates).toHaveLength(1);
      expect((creates[0].body as { variables: Record<string, unknown> }).variables).toMatchObject({
        teamId: 'test-team-id',
        name: NEW_LABEL,
      });
    });

    it('second call uses cache — makes zero GraphQL requests', async () => {
      await board.ensureLabel(TEST_LABEL);
      const countAfterFirst = spy.captured.length;

      await board.ensureLabel(TEST_LABEL);
      expect(spy.captured.length).toBe(countAfterFirst);
    });
  });

  describe('addLabel', () => {
    it('skips issueUpdate when label already on issue', async () => {
      await board.addLabel('TEAM-1', TEST_LABEL);

      const updates = spy.captured.filter(
        (r) => (r.body as { query: string }).query?.includes('issueUpdate'),
      );

      // Label is already present on the issue — no update needed
      expect(updates).toHaveLength(0);
    });

    it('appends new label ID when not already on issue', async () => {
      server.use(
        http.post(LINEAR_API, async ({ request }) => {
          const body = (await request.json()) as { query: string; variables?: Record<string, unknown> };
          const query = body.query ?? '';

          spy.record('POST', request.url, body);

          if (query.includes('team') && query.includes('labels') && !query.includes('issueLabels')) {
            return HttpResponse.json({
              data: {
                team: {
                  labels: { nodes: [{ id: 'label-plan-id', name: NEW_LABEL }] },
                },
              },
            });
          }

          if (query.includes('issueSearch') || (query.includes('issues') && query.includes('identifier'))) {
            return HttpResponse.json({
              data: {
                issueSearch: {
                  nodes: [{ id: 'issue-uuid-001', labels: { nodes: [] } }],
                },
              },
            });
          }

          if (query.includes('issueUpdate')) {
            return HttpResponse.json({
              data: { issueUpdate: { success: true } },
            });
          }

          return HttpResponse.json(
            { errors: [{ message: `Unhandled: ${query.slice(0, 80)}` }] },
            { status: 400 },
          );
        }),
      );

      await board.addLabel('TEAM-1', NEW_LABEL);

      const updates = spy.captured.filter(
        (r) => (r.body as { query: string }).query?.includes('issueUpdate'),
      );

      expect(updates).toHaveLength(1);
      expect((updates[0].body as { variables: Record<string, unknown> }).variables).toMatchObject({
        issueId: 'issue-uuid-001',
        labelIds: ['label-plan-id'],
      });
    });
  });

  describe('removeLabel', () => {
    it('resolves issue then sends issueUpdate with filtered label IDs', async () => {
      await board.removeLabel('TEAM-1', TEST_LABEL);

      const updates = spy.captured.filter(
        (r) => (r.body as { query: string }).query?.includes('issueUpdate'),
      );

      expect(updates).toHaveLength(1);
      expect((updates[0].body as { variables: Record<string, unknown> }).variables).toMatchObject({
        issueId: 'issue-uuid-001',
        labelIds: [],
      });
    });

    it('skips update when label not on issue', async () => {
      server.use(
        http.post(LINEAR_API, async ({ request }) => {
          const body = (await request.json()) as { query: string; variables?: Record<string, unknown> };
          const query = body.query ?? '';

          spy.record('POST', request.url, body);

          if (query.includes('issueSearch') || (query.includes('issues') && query.includes('identifier'))) {
            return HttpResponse.json({
              data: {
                issueSearch: {
                  nodes: [{ id: 'issue-uuid-001', labels: { nodes: [] } }],
                },
              },
            });
          }

          return HttpResponse.json(
            { errors: [{ message: `Unhandled: ${query.slice(0, 80)}` }] },
            { status: 400 },
          );
        }),
      );

      await board.removeLabel('TEAM-1', 'nonexistent-label');

      const updates = spy.captured.filter(
        (r) => (r.body as { query: string }).query?.includes('issueUpdate'),
      );
      expect(updates).toHaveLength(0);
    });
  });

  describe('transitionTicket', () => {
    it('looks up workflow state ID then sends issueUpdate', async () => {
      const result = await board.transitionTicket(
        {
          key: 'TEAM-1', title: 'Test', description: '', parentInfo: 'none',
          blockers: 'None', labels: [], status: 'unstarted',
          linearIssueId: 'issue-uuid-001', issueId: 'issue-uuid-001',
        },
        'In Progress',
      );

      expect(result).toBe(true);

      const updates = spy.captured.filter(
        (r) => (r.body as { query: string }).query?.includes('issueUpdate'),
      );
      expect(updates.length).toBeGreaterThanOrEqual(1);
    });
  });
});
