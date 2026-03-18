import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';

import type { FetchedTicket } from '../types/types.js';
import {
  deliverEpicToBase,
  deliverViaPullRequest,
  ensureEpicBranch,
} from './deliver.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('~/scripts/board/github/github.js', () => ({
  closeIssue: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/board/jira/jira.js', () => ({
  buildAuthHeader: vi.fn(() => 'Basic auth'),
  transitionIssue: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/board/linear/linear.js', () => ({
  transitionIssue: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/shared/git-ops/git-ops.js', () => ({
  branchExists: vi.fn(() => false),
  checkout: vi.fn(),
  fetchRemoteBranch: vi.fn(() => true),
  pushBranch: vi.fn(() => true),
  remoteBranchExists: vi.fn(() => false),
}));

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  appendProgress: vi.fn(),
  findEntriesWithStatus: vi.fn(() => []),
}));

vi.mock('~/scripts/shared/pull-request/pr-body/pr-body.js', () => ({
  buildEpicPrBody: vi.fn(() => 'Epic PR body'),
  buildPrBody: vi.fn(() => 'PR body'),
  isEpicBranch: vi.fn(
    (b: string) => b.startsWith('epic/') || b.startsWith('milestone/'),
  ),
}));

vi.mock('~/scripts/shared/remote/remote.js', () => ({
  buildApiBaseUrl: vi.fn(() => 'https://api.github.com'),
  detectRemote: vi.fn(() => ({
    host: 'github',
    owner: 'owner',
    repo: 'repo',
    hostname: 'github.com',
  })),
}));

vi.mock('~/scripts/shared/pull-request/github/github.js', () => ({
  createPullRequest: vi.fn(() =>
    Promise.resolve({
      ok: true,
      url: 'https://github.com/o/r/pull/1',
      number: 1,
    }),
  ),
}));

vi.mock('~/scripts/shared/pull-request/gitlab/gitlab.js', () => ({
  createMergeRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://gitlab.com/mr/1', number: 1 }),
  ),
}));

vi.mock('~/scripts/shared/pull-request/bitbucket/bitbucket.js', () => ({
  createPullRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://bitbucket.org/pr/1', number: 1 }),
  ),
  createServerPullRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://bb.acme.com/pr/1', number: 1 }),
  ),
}));

vi.mock('~/scripts/shared/format/format.js', () => ({
  formatDuration: vi.fn(() => '1m 30s'),
}));

const {
  branchExists,
  checkout,
  fetchRemoteBranch,
  pushBranch,
  remoteBranchExists,
} = await import('~/scripts/shared/git-ops/git-ops.js');
const { appendProgress } =
  await import('~/scripts/shared/progress/progress.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const jiraConfig: BoardConfig = {
  provider: 'jira',
  env: {
    JIRA_BASE_URL: 'https://example.atlassian.net',
    JIRA_USER: 'user@test.com',
    JIRA_API_TOKEN: 'token',
    JIRA_PROJECT_KEY: 'PROJ',
    CLANCY_STATUS_DONE: 'Done',
    GITHUB_TOKEN: 'ghp_test',
  },
};

const ticket: FetchedTicket = {
  key: 'PROJ-1',
  title: 'Add login',
  description: 'Create login page.',
  parentInfo: 'PROJ-100',
  blockers: 'None',
};

// ─── Tests: ensureEpicBranch ────────────────────────────────────────────────

describe('ensureEpicBranch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches from remote when branch exists on remote', () => {
    vi.mocked(remoteBranchExists).mockReturnValue(true);

    const result = ensureEpicBranch('epic/proj-100', 'main');

    expect(result).toBe(true);
    expect(fetchRemoteBranch).toHaveBeenCalledWith('epic/proj-100');
  });

  it('refuses when local branch exists but not on remote (migration guard)', () => {
    vi.mocked(remoteBranchExists).mockReturnValue(false);
    vi.mocked(branchExists).mockReturnValue(true);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = ensureEpicBranch('epic/proj-100', 'main');
    log.mockRestore();

    expect(result).toBe(false);
  });

  it('creates from origin/baseBranch and pushes when branch does not exist', () => {
    vi.mocked(remoteBranchExists).mockReturnValue(false);
    vi.mocked(branchExists).mockReturnValue(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = ensureEpicBranch('epic/proj-100', 'main');
    log.mockRestore();

    expect(result).toBe(true);
    expect(pushBranch).toHaveBeenCalledWith('epic/proj-100');
  });
});

// ─── Tests: deliverViaPullRequest ────────────────────────────────────────────

describe('deliverViaPullRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pushes branch and creates PR, logs PR_CREATED', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await deliverViaPullRequest(
      jiraConfig,
      ticket,
      'feature/proj-1',
      'main',
      Date.now(),
    );
    log.mockRestore();

    expect(result).toBe(true);
    expect(pushBranch).toHaveBeenCalledWith('feature/proj-1');
    expect(appendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-1',
      'Add login',
      'PR_CREATED',
      1,
      undefined,
    );
  });

  it('passes parent key to appendProgress', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await deliverViaPullRequest(
      jiraConfig,
      ticket,
      'feature/proj-1',
      'epic/proj-100',
      Date.now(),
      false,
      'PROJ-100',
    );
    log.mockRestore();

    expect(appendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-1',
      'Add login',
      'PR_CREATED',
      1,
      'PROJ-100',
    );
  });

  it('returns false and logs PUSH_FAILED when push fails', async () => {
    vi.mocked(pushBranch).mockReturnValue(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await deliverViaPullRequest(
      jiraConfig,
      ticket,
      'feature/proj-1',
      'main',
      Date.now(),
    );
    log.mockRestore();

    expect(result).toBe(false);
    expect(appendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-1',
      'Add login',
      'PUSH_FAILED',
      undefined,
      undefined,
    );
  });

  it('skips progress log when skipLog is true', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await deliverViaPullRequest(
      jiraConfig,
      ticket,
      'feature/proj-1',
      'main',
      Date.now(),
      true,
    );
    log.mockRestore();

    expect(appendProgress).not.toHaveBeenCalled();
  });

  it('checks out target branch after delivery', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await deliverViaPullRequest(
      jiraConfig,
      ticket,
      'feature/proj-1',
      'main',
      Date.now(),
    );
    log.mockRestore();

    expect(checkout).toHaveBeenCalledWith('main');
  });
});

// ─── Tests: deliverEpicToBase ────────────────────────────────────────────────

describe('deliverEpicToBase', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates epic PR and logs EPIC_PR_CREATED', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await deliverEpicToBase(
      jiraConfig,
      'PROJ-100',
      'Customer portal',
      'epic/proj-100',
      'main',
    );
    log.mockRestore();

    expect(result).toBe(true);
    expect(appendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-100',
      'Customer portal',
      'EPIC_PR_CREATED',
      1,
    );
  });
});

// ─── Tests: deliverViaEpicMerge is removed ──────────────────────────────────

describe('deliverViaEpicMerge removal', () => {
  it('does not export deliverViaEpicMerge', async () => {
    const deliver = await import('./deliver.js');
    expect('deliverViaEpicMerge' in deliver).toBe(false);
  });
});
