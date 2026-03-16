import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';

import type { FetchedTicket } from '../types/types.js';
import { deliverViaEpicMerge, deliverViaPullRequest } from './deliver.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

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
  checkout: vi.fn(),
  deleteBranch: vi.fn(),
  pushBranch: vi.fn(() => true),
  squashMerge: vi.fn(() => true),
}));

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  appendProgress: vi.fn(),
}));

vi.mock('~/scripts/shared/pull-request/pr-body/pr-body.js', () => ({
  buildPrBody: vi.fn(() => 'PR body'),
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

const { checkout, deleteBranch, pushBranch, squashMerge } =
  await import('~/scripts/shared/git-ops/git-ops.js');
const { appendProgress } =
  await import('~/scripts/shared/progress/progress.js');
const { closeIssue } = await import('~/scripts/board/github/github.js');
const { transitionIssue: transitionJiraIssue } =
  await import('~/scripts/board/jira/jira.js');

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

const githubConfig: BoardConfig = {
  provider: 'github',
  env: {
    GITHUB_TOKEN: 'ghp_abc123',
    GITHUB_REPO: 'acme/app',
  },
};

const ticket: FetchedTicket = {
  key: 'PROJ-1',
  title: 'Add login',
  description: 'Create login page.',
  parentInfo: 'PROJ-100',
  blockers: 'None',
};

const ghTicket: FetchedTicket = {
  key: '#42',
  title: 'Fix bug',
  description: 'Bug description.',
  parentInfo: 'Sprint 3',
  blockers: 'None',
};

// ─── Tests: deliverViaEpicMerge ──────────────────────────────────────────────

describe('deliverViaEpicMerge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('squash merges, deletes branch, and logs DONE', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await deliverViaEpicMerge(
      jiraConfig,
      ticket,
      'feature/proj-1',
      'epic/proj-100',
    );
    log.mockRestore();

    expect(checkout).toHaveBeenCalledWith('epic/proj-100');
    expect(squashMerge).toHaveBeenCalledWith(
      'feature/proj-1',
      'feat(PROJ-1): Add login',
    );
    expect(deleteBranch).toHaveBeenCalledWith('feature/proj-1');
    expect(appendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-1',
      'Add login',
      'DONE',
    );
  });

  it('transitions Jira ticket to Done when CLANCY_STATUS_DONE is set', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await deliverViaEpicMerge(
      jiraConfig,
      ticket,
      'feature/proj-1',
      'epic/proj-100',
    );
    log.mockRestore();

    expect(transitionJiraIssue).toHaveBeenCalled();
  });

  it('closes GitHub issue after epic merge', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await deliverViaEpicMerge(
      githubConfig,
      ghTicket,
      'feature/issue-42',
      'milestone/sprint-3',
    );
    log.mockRestore();

    expect(closeIssue).toHaveBeenCalledWith('ghp_abc123', 'acme/app', 42);
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

  it('skips progress log on push failure when skipLog is true', async () => {
    vi.mocked(pushBranch).mockReturnValue(false);

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
