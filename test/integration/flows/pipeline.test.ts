/**
 * QA-002b-2: Pipeline label transitions (cross-role).
 *
 * Tests the 3-stage label lifecycle (clancy:brief → clancy:plan → clancy:build)
 * using GitHub Issues (simplest label API). Covers:
 * - Full pipeline: label transitions via Board + orchestrator picks up build ticket
 * - Add-before-remove ordering: verified per transition stage
 * - Plan-label guard: dual-label race condition prevention
 * - Label crash safety: add succeeds but remove fails → no crash
 * - CLANCY_LABEL fallback: backward compat when CLANCY_LABEL_BUILD not set
 *
 * Uses the once orchestrator for the end-to-end flow test, and direct Board
 * calls for the label transition, crash safety, and fallback tests.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { SetupServer } from 'msw/node';

import type { Board } from '~/scripts/board/board.js';
import { createGitHubBoard } from '~/scripts/board/github/github-board.js';
import { resetUsernameCache } from '~/scripts/board/github/github.js';

import { githubEnv } from '../helpers/env-fixtures.js';
import {
  createIntegrationServer,
  startServer,
} from '../helpers/msw-server.js';
import { simulateClaudeSuccess } from '../helpers/claude-simulator.js';
import {
  createClancyScaffold,
  createTempRepo,
  withCwd,
  type TempRepoResult,
} from '../helpers/temp-repo.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';

// ─── Module mocks — must be at top level (hoisted per-file) ─────────────────

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

// ─── Helpers ────────────────────────────────────────────────────────────────

type CapturedRequest = {
  method: string;
  url: string;
  body?: unknown;
};

function createRequestSpy() {
  const captured: CapturedRequest[] = [];
  return {
    captured,
    record(method: string, url: string, body?: unknown) {
      captured.push({ method, url, body });
    },
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

function resetAllMocks(): void {
  vi.unstubAllEnvs();
  resetUsernameCache();
  claudeSessionMock = defaultClaudeMock;
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('Pipeline label transitions', () => {
  // ── Full pipeline: Brief → Plan → Build ───────────────────────────────

  describe('Brief → Plan → Build full pipeline', () => {
    let spy: ReturnType<typeof createRequestSpy>;
    let board: Board;
    let server: SetupServer;
    let repo: TempRepoResult | undefined;

    afterEach(() => {
      server?.close();
      resetAllMocks();
      repo?.cleanup();
      repo = undefined;
    });

    it('transitions labels through all 3 stages then orchestrator picks up build ticket', async () => {
      spy = createRequestSpy();

      // Handlers for label operations + full orchestrator run
      server = createIntegrationServer(
        // Ping
        http.get(`${GITHUB_API}/repos/:owner/:repo`, () =>
          HttpResponse.json({ full_name: 'test-owner/test-repo', private: false }),
        ),
        // Username resolution
        http.get(`${GITHUB_API}/user`, () =>
          HttpResponse.json({ login: 'testuser' }),
        ),
        // Label check (ensureLabel) — return the requested label name
        http.get(`${GITHUB_API}/repos/:owner/:repo/labels/:name`, ({ params }) =>
          HttpResponse.json({ name: params.name }),
        ),
        // Create label (fallback)
        http.post(`${GITHUB_API}/repos/:owner/:repo/labels`, async ({ request }) => {
          spy.record('POST_LABEL', request.url, await request.json());
          return HttpResponse.json({ name: 'clancy:build' }, { status: 201 });
        }),
        // Add label to issue
        http.post(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels`, async ({ request }) => {
          spy.record('ADD_LABEL', request.url, await request.json());
          return HttpResponse.json([{ name: 'clancy:build' }]);
        }),
        // Remove label from issue
        http.delete(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels/:name`, ({ request }) => {
          spy.record('REMOVE_LABEL', request.url);
          return new HttpResponse(null, { status: 204 });
        }),
        // Issue search (returns ticket with clancy:build label)
        http.get(`${GITHUB_API}/repos/:owner/:repo/issues`, () =>
          HttpResponse.json([
            {
              number: 1,
              title: 'Pipeline test ticket',
              body: 'Test the full pipeline.',
              state: 'open',
              labels: [{ name: 'clancy:build' }],
              assignee: { login: 'testuser' },
              user: { login: 'testuser' },
            },
          ]),
        ),
        // Search issues
        http.get(`${GITHUB_API}/search/issues`, () =>
          HttpResponse.json({
            total_count: 1,
            items: [
              {
                number: 1,
                title: 'Pipeline test ticket',
                body: 'Test the full pipeline.',
                state: 'open',
                labels: [{ name: 'clancy:build' }],
                assignee: { login: 'testuser' },
                user: { login: 'testuser' },
              },
            ],
          }),
        ),
        // Single issue
        http.get(`${GITHUB_API}/repos/:owner/:repo/issues/:number`, () =>
          HttpResponse.json({
            number: 1,
            title: 'Pipeline test ticket',
            body: 'Test the full pipeline.',
            state: 'open',
            labels: [{ name: 'clancy:build' }],
            assignee: { login: 'testuser' },
          }),
        ),
        // PR creation
        http.post(`${GITHUB_API}/repos/:owner/:repo/pulls`, () =>
          HttpResponse.json(
            { number: 1, html_url: 'https://github.com/test-owner/test-repo/pull/1', state: 'open' },
            { status: 201 },
          ),
        ),
        // PR review request
        http.post(`${GITHUB_API}/repos/:owner/:repo/pulls/:number/requested_reviewers`, () =>
          HttpResponse.json({}, { status: 201 }),
        ),
      );
      startServer(server);

      board = createGitHubBoard(githubEnv);

      // Stage 1: Brief label
      await board.addLabel('#1', 'clancy:brief');
      const briefAdds = spy.captured.filter(
        (r) => r.method === 'ADD_LABEL' && JSON.stringify(r.body).includes('clancy:brief'),
      );
      expect(briefAdds).toHaveLength(1);

      // Stage 2: Brief → Plan (add-before-remove for crash safety)
      spy.captured.length = 0;
      await board.addLabel('#1', 'clancy:plan');
      await board.removeLabel('#1', 'clancy:brief');

      const planAdds = spy.captured.filter(
        (r) => r.method === 'ADD_LABEL' && JSON.stringify(r.body).includes('clancy:plan'),
      );
      const briefRemoves = spy.captured.filter(
        (r) => r.method === 'REMOVE_LABEL' && r.url.includes('clancy%3Abrief'),
      );
      expect(planAdds).toHaveLength(1);
      expect(briefRemoves).toHaveLength(1);

      // Verify add happened before remove (add-before-remove ordering)
      const addIdx = spy.captured.findIndex((r) => r.method === 'ADD_LABEL');
      const removeIdx = spy.captured.findIndex((r) => r.method === 'REMOVE_LABEL');
      expect(addIdx).toBeLessThan(removeIdx);

      // Stage 3: Plan → Build
      spy.captured.length = 0;
      await board.addLabel('#1', 'clancy:build');
      await board.removeLabel('#1', 'clancy:plan');

      const buildAdds = spy.captured.filter(
        (r) => r.method === 'ADD_LABEL' && JSON.stringify(r.body).includes('clancy:build'),
      );
      const planRemoves = spy.captured.filter(
        (r) => r.method === 'REMOVE_LABEL' && r.url.includes('clancy%3Aplan'),
      );
      expect(buildAdds).toHaveLength(1);
      expect(planRemoves).toHaveLength(1);

      // Verify add-before-remove ordering (Plan → Build)
      const buildAddIdx = spy.captured.findIndex((r) => r.method === 'ADD_LABEL');
      const planRemoveIdx = spy.captured.findIndex((r) => r.method === 'REMOVE_LABEL');
      expect(buildAddIdx).toBeLessThan(planRemoveIdx);

      // Stage 4: Orchestrator picks up the ticket with clancy:build label
      const envWithLabels = {
        ...githubEnv,
        CLANCY_LABEL_BUILD: 'clancy:build',
        CLANCY_LABEL_PLAN: 'clancy:plan',
      };
      const r = (repo = setupTestRepo(
        envWithLabels,
        'https://github.com/test-owner/test-repo.git',
      ));

      claudeSessionMock = () => {
        simulateClaudeSuccess(r.repoPath, 'issue-1');
        return true;
      };

      await withCwd(r.repoPath, () => run(['--skip-feasibility']));

      // Assert: feature branch created
      const branches = execFileSync('git', ['branch', '--list'], {
        cwd: r.repoPath,
        encoding: 'utf8',
      });
      expect(branches).toContain('feature/issue-1');

      // Assert: progress.txt has entry
      const progress = readFileSync(
        join(r.repoPath, '.clancy', 'progress.txt'),
        'utf8',
      );
      expect(progress).toContain('#1');
      expect(progress).toMatch(/PR_CREATED|PUSHED/);
    });
  });

  // ── Plan-label guard ──────────────────────────────────────────────────

  describe('Plan-label guard (dual-label race condition)', () => {
    let server: SetupServer;
    let repo: TempRepoResult | undefined;

    afterEach(() => {
      server?.close();
      resetAllMocks();
      repo?.cleanup();
      repo = undefined;
    });

    it('skips ticket with both clancy:plan and clancy:build labels', async () => {
      server = createIntegrationServer(
        // Ping
        http.get(`${GITHUB_API}/repos/:owner/:repo`, () =>
          HttpResponse.json({ full_name: 'test-owner/test-repo', private: false }),
        ),
        // Username
        http.get(`${GITHUB_API}/user`, () =>
          HttpResponse.json({ login: 'testuser' }),
        ),
        // Issues — ticket has BOTH labels (mid-transition state)
        http.get(`${GITHUB_API}/repos/:owner/:repo/issues`, () =>
          HttpResponse.json([
            {
              number: 1,
              title: 'Dual-label ticket',
              body: 'This ticket is mid-transition.',
              state: 'open',
              labels: [
                { name: 'clancy:plan' },
                { name: 'clancy:build' },
              ],
              assignee: { login: 'testuser' },
              user: { login: 'testuser' },
            },
          ]),
        ),
        // Search issues
        http.get(`${GITHUB_API}/search/issues`, () =>
          HttpResponse.json({
            total_count: 1,
            items: [
              {
                number: 1,
                title: 'Dual-label ticket',
                body: 'This ticket is mid-transition.',
                state: 'open',
                labels: [
                  { name: 'clancy:plan' },
                  { name: 'clancy:build' },
                ],
                assignee: { login: 'testuser' },
                user: { login: 'testuser' },
              },
            ],
          }),
        ),
      );
      startServer(server);

      const envWithLabels = {
        ...githubEnv,
        CLANCY_LABEL_BUILD: 'clancy:build',
        CLANCY_LABEL_PLAN: 'clancy:plan',
      };
      const r = (repo = setupTestRepo(
        envWithLabels,
        'https://github.com/test-owner/test-repo.git',
      ));

      const logSpy = vi.spyOn(console, 'log');

      try {
        await withCwd(r.repoPath, () => run(['--skip-feasibility']));

        // Assert: plan-label guard was the actual skip reason
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('still has plan label'),
        );
      } finally {
        logSpy.mockRestore();
      }

      // Assert: no feature branch created (ticket skipped)
      const branches = execFileSync('git', ['branch', '--list'], {
        cwd: r.repoPath,
        encoding: 'utf8',
      });
      expect(branches).not.toContain('feature/');

      // Assert: empty progress (no ticket picked up)
      const progress = readFileSync(
        join(r.repoPath, '.clancy', 'progress.txt'),
        'utf8',
      );
      expect(progress.trim()).toBe('');
    });

    it('picks up ticket when only clancy:build label is present (plan label removed)', async () => {
      server = createIntegrationServer(
        http.get(`${GITHUB_API}/repos/:owner/:repo`, () =>
          HttpResponse.json({ full_name: 'test-owner/test-repo', private: false }),
        ),
        http.get(`${GITHUB_API}/user`, () =>
          HttpResponse.json({ login: 'testuser' }),
        ),
        // Issue with ONLY clancy:build — transition complete
        http.get(`${GITHUB_API}/repos/:owner/:repo/issues`, () =>
          HttpResponse.json([
            {
              number: 1,
              title: 'Ready ticket',
              body: 'Plan label removed, build only.',
              state: 'open',
              labels: [{ name: 'clancy:build' }],
              assignee: { login: 'testuser' },
              user: { login: 'testuser' },
            },
          ]),
        ),
        http.get(`${GITHUB_API}/search/issues`, () =>
          HttpResponse.json({
            total_count: 1,
            items: [
              {
                number: 1,
                title: 'Ready ticket',
                body: 'Plan label removed, build only.',
                state: 'open',
                labels: [{ name: 'clancy:build' }],
                assignee: { login: 'testuser' },
                user: { login: 'testuser' },
              },
            ],
          }),
        ),
        http.get(`${GITHUB_API}/repos/:owner/:repo/issues/:number`, () =>
          HttpResponse.json({
            number: 1,
            title: 'Ready ticket',
            body: 'Plan label removed, build only.',
            state: 'open',
            labels: [{ name: 'clancy:build' }],
            assignee: { login: 'testuser' },
          }),
        ),
        // Label handlers for orchestrator
        http.get(`${GITHUB_API}/repos/:owner/:repo/labels/:name`, () =>
          HttpResponse.json({ name: 'clancy:build' }),
        ),
        http.post(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels`, () =>
          HttpResponse.json([{ name: 'clancy:build' }]),
        ),
        http.delete(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels/:name`, () =>
          new HttpResponse(null, { status: 204 }),
        ),
        // PR creation
        http.post(`${GITHUB_API}/repos/:owner/:repo/pulls`, () =>
          HttpResponse.json(
            { number: 1, html_url: 'https://github.com/test-owner/test-repo/pull/1', state: 'open' },
            { status: 201 },
          ),
        ),
        http.post(`${GITHUB_API}/repos/:owner/:repo/pulls/:number/requested_reviewers`, () =>
          HttpResponse.json({}, { status: 201 }),
        ),
      );
      startServer(server);

      const envWithLabels = {
        ...githubEnv,
        CLANCY_LABEL_BUILD: 'clancy:build',
        CLANCY_LABEL_PLAN: 'clancy:plan',
      };
      const r = (repo = setupTestRepo(
        envWithLabels,
        'https://github.com/test-owner/test-repo.git',
      ));

      claudeSessionMock = () => {
        simulateClaudeSuccess(r.repoPath, 'issue-1');
        return true;
      };

      await withCwd(r.repoPath, () => run(['--skip-feasibility']));

      // Assert: feature branch created (ticket picked up)
      const branches = execFileSync('git', ['branch', '--list'], {
        cwd: r.repoPath,
        encoding: 'utf8',
      });
      expect(branches).toContain('feature/issue-1');

      // Assert: progress.txt has entry
      const progress = readFileSync(
        join(r.repoPath, '.clancy', 'progress.txt'),
        'utf8',
      );
      expect(progress).toContain('#1');
    });

    it('picks up ticket using CLANCY_LABEL fallback (backward compat)', async () => {
      server = createIntegrationServer(
        http.get(`${GITHUB_API}/repos/:owner/:repo`, () =>
          HttpResponse.json({ full_name: 'test-owner/test-repo', private: false }),
        ),
        http.get(`${GITHUB_API}/user`, () =>
          HttpResponse.json({ login: 'testuser' }),
        ),
        http.get(`${GITHUB_API}/repos/:owner/:repo/issues`, () =>
          HttpResponse.json([
            {
              number: 1,
              title: 'Legacy label ticket',
              body: 'Using CLANCY_LABEL fallback.',
              state: 'open',
              labels: [{ name: 'clancy' }],
              assignee: { login: 'testuser' },
              user: { login: 'testuser' },
            },
          ]),
        ),
        http.get(`${GITHUB_API}/search/issues`, () =>
          HttpResponse.json({
            total_count: 1,
            items: [
              {
                number: 1,
                title: 'Legacy label ticket',
                body: 'Using CLANCY_LABEL fallback.',
                state: 'open',
                labels: [{ name: 'clancy' }],
                assignee: { login: 'testuser' },
                user: { login: 'testuser' },
              },
            ],
          }),
        ),
        http.get(`${GITHUB_API}/repos/:owner/:repo/issues/:number`, () =>
          HttpResponse.json({
            number: 1,
            title: 'Legacy label ticket',
            body: 'Using CLANCY_LABEL fallback.',
            state: 'open',
            labels: [{ name: 'clancy' }],
            assignee: { login: 'testuser' },
          }),
        ),
        http.get(`${GITHUB_API}/repos/:owner/:repo/labels/:name`, () =>
          HttpResponse.json({ name: 'clancy' }),
        ),
        http.post(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels`, () =>
          HttpResponse.json([{ name: 'clancy' }]),
        ),
        http.delete(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels/:name`, () =>
          new HttpResponse(null, { status: 204 }),
        ),
        http.post(`${GITHUB_API}/repos/:owner/:repo/pulls`, () =>
          HttpResponse.json(
            { number: 1, html_url: 'https://github.com/test-owner/test-repo/pull/1', state: 'open' },
            { status: 201 },
          ),
        ),
        http.post(`${GITHUB_API}/repos/:owner/:repo/pulls/:number/requested_reviewers`, () =>
          HttpResponse.json({}, { status: 201 }),
        ),
      );
      startServer(server);

      // Use CLANCY_LABEL (old env var) instead of CLANCY_LABEL_BUILD
      const legacyEnv = {
        ...githubEnv,
        CLANCY_LABEL: 'clancy',
      };
      const r = (repo = setupTestRepo(
        legacyEnv,
        'https://github.com/test-owner/test-repo.git',
      ));

      claudeSessionMock = () => {
        simulateClaudeSuccess(r.repoPath, 'issue-1');
        return true;
      };

      await withCwd(r.repoPath, () => run(['--skip-feasibility']));

      const branches = execFileSync('git', ['branch', '--list'], {
        cwd: r.repoPath,
        encoding: 'utf8',
      });
      expect(branches).toContain('feature/issue-1');
    });
  });

  // ── Label crash safety ────────────────────────────────────────────────

  describe('Label crash safety', () => {
    let spy: ReturnType<typeof createRequestSpy>;
    let board: Board;
    let server: SetupServer;

    afterEach(() => {
      server?.close();
      resetAllMocks();
    });

    it('addLabel succeeds but removeLabel returns 500 — no crash, remove attempted', async () => {
      spy = createRequestSpy();

      let removeCalled = false;

      server = createIntegrationServer(
        // Label check (ensureLabel)
        http.get(`${GITHUB_API}/repos/:owner/:repo/labels/:name`, () =>
          HttpResponse.json({ name: 'clancy:plan' }),
        ),
        // Add label succeeds
        http.post(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels`, async ({ request }) => {
          spy.record('ADD_LABEL', request.url, await request.json());
          return HttpResponse.json([{ name: 'clancy:plan' }, { name: 'clancy:brief' }]);
        }),
        // Remove label fails with 500
        http.delete(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels/:name`, ({ request }) => {
          removeCalled = true;
          spy.record('REMOVE_LABEL', request.url);
          return HttpResponse.json(
            { message: 'Internal Server Error' },
            { status: 500 },
          );
        }),
      );
      startServer(server);

      board = createGitHubBoard(githubEnv);

      // Simulate add-before-remove transition: Brief → Plan
      await board.addLabel('#1', 'clancy:plan');

      // Assert: add succeeded
      const adds = spy.captured.filter((r) => r.method === 'ADD_LABEL');
      expect(adds).toHaveLength(1);

      // Remove fails — should not throw
      await expect(board.removeLabel('#1', 'clancy:brief')).resolves.toBeUndefined();

      // Assert: remove was attempted
      expect(removeCalled).toBe(true);

      // Assert: remove was attempted but failed (crash-safe — add succeeded,
      // remove returned 500, system didn't crash)
      const removes = spy.captured.filter((r) => r.method === 'REMOVE_LABEL');
      expect(removes).toHaveLength(1);
    });

    it('both addLabel and removeLabel succeed in normal flow', async () => {
      spy = createRequestSpy();

      server = createIntegrationServer(
        http.get(`${GITHUB_API}/repos/:owner/:repo/labels/:name`, () =>
          HttpResponse.json({ name: 'clancy:plan' }),
        ),
        http.post(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels`, async ({ request }) => {
          spy.record('ADD_LABEL', request.url, await request.json());
          return HttpResponse.json([{ name: 'clancy:plan' }]);
        }),
        http.delete(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels/:name`, ({ request }) => {
          spy.record('REMOVE_LABEL', request.url);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      startServer(server);

      board = createGitHubBoard(githubEnv);

      // Normal transition: add new label, remove old
      await board.addLabel('#1', 'clancy:plan');
      await board.removeLabel('#1', 'clancy:brief');

      const adds = spy.captured.filter((r) => r.method === 'ADD_LABEL');
      const removes = spy.captured.filter((r) => r.method === 'REMOVE_LABEL');

      expect(adds).toHaveLength(1);
      expect(removes).toHaveLength(1);
    });
  });
});
