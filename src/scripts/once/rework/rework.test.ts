import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';

import {
  buildReworkComment,
  fetchReworkFromPrReview,
  postReworkActions,
} from './rework.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  findEntriesWithStatus: vi.fn(() => []),
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
  checkPrReviewState: vi.fn(() => Promise.resolve(undefined)),
  fetchPrReviewComments: vi.fn(() => Promise.resolve([])),
  postPrComment: vi.fn(() => Promise.resolve(true)),
  requestReview: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/shared/pull-request/gitlab/gitlab.js', () => ({
  checkMrReviewState: vi.fn(() => Promise.resolve(undefined)),
  fetchMrReviewComments: vi.fn(() =>
    Promise.resolve({ comments: [], discussionIds: [] }),
  ),
  postMrNote: vi.fn(() => Promise.resolve(true)),
  resolveDiscussions: vi.fn(() => Promise.resolve(0)),
}));

vi.mock('~/scripts/shared/pull-request/bitbucket/bitbucket.js', () => ({
  checkPrReviewState: vi.fn(() => Promise.resolve(undefined)),
  checkServerPrReviewState: vi.fn(() => Promise.resolve(undefined)),
  fetchPrReviewComments: vi.fn(() => Promise.resolve([])),
  fetchServerPrReviewComments: vi.fn(() => Promise.resolve([])),
  postCloudPrComment: vi.fn(() => Promise.resolve(true)),
  postServerPrComment: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/board/github/github.js', () => ({
  resolveUsername: vi.fn(() => Promise.resolve('testuser')),
}));

vi.mock('~/scripts/shared/branch/branch.js', () => ({
  computeTicketBranch: vi.fn(
    (_provider: string, key: string) =>
      `feature/${key.replace('#', 'issue-').toLowerCase()}`,
  ),
}));

const { findEntriesWithStatus } =
  await import('~/scripts/shared/progress/progress.js');
const {
  checkPrReviewState: mockCheckGitHubPrReviewState,
  fetchPrReviewComments: mockFetchGitHubPrReviewComments,
  postPrComment: mockPostGitHubPrComment,
  requestReview: mockRequestGitHubReview,
} = await import('~/scripts/shared/pull-request/github/github.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const jiraConfig: BoardConfig = {
  provider: 'jira',
  env: {
    JIRA_BASE_URL: 'https://example.atlassian.net',
    JIRA_USER: 'user@test.com',
    JIRA_API_TOKEN: 'token',
    JIRA_PROJECT_KEY: 'PROJ',
    GITHUB_TOKEN: 'ghp_test',
  },
};

// ─── Tests: fetchReworkFromPrReview ──────────────────────────────────────────

describe('fetchReworkFromPrReview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns undefined when no progress entries exist', async () => {
    vi.mocked(findEntriesWithStatus).mockReturnValue([]);
    const result = await fetchReworkFromPrReview(jiraConfig);
    expect(result).toBeUndefined();
  });

  it('returns undefined when PR has no changes requested', async () => {
    vi.mocked(findEntriesWithStatus).mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-1',
        summary: 'Test',
        status: 'PR_CREATED',
      },
    ]);
    vi.mocked(mockCheckGitHubPrReviewState).mockResolvedValue({
      changesRequested: false,
      prNumber: 1,
      prUrl: 'https://github.com/o/r/pull/1',
    });

    const result = await fetchReworkFromPrReview(jiraConfig);
    expect(result).toBeUndefined();
  });

  it('returns rework ticket when changes are requested', async () => {
    vi.mocked(findEntriesWithStatus).mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-500',
        summary: 'PR rework',
        status: 'PR_CREATED',
      },
    ]);
    vi.mocked(mockCheckGitHubPrReviewState).mockResolvedValue({
      changesRequested: true,
      prNumber: 99,
      prUrl: 'https://github.com/o/r/pull/99',
      reviewers: ['alice'],
    });
    vi.mocked(mockFetchGitHubPrReviewComments).mockResolvedValue([
      'Fix the validation logic',
    ]);

    const result = await fetchReworkFromPrReview(jiraConfig);

    expect(result).toBeDefined();
    expect(result!.ticket.key).toBe('PROJ-500');
    expect(result!.feedback).toEqual(['Fix the validation logic']);
    expect(result!.prNumber).toBe(99);
    expect(result!.reviewers).toEqual(['alice']);
  });

  it('preserves parent info from progress entry', async () => {
    vi.mocked(findEntriesWithStatus).mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-101',
        summary: 'Child ticket',
        status: 'PR_CREATED',
        prNumber: 42,
        parent: 'PROJ-100',
      },
    ]);
    vi.mocked(mockCheckGitHubPrReviewState).mockResolvedValue({
      changesRequested: true,
      prNumber: 42,
      prUrl: 'https://github.com/o/r/pull/42',
      reviewers: ['bob'],
    });
    vi.mocked(mockFetchGitHubPrReviewComments).mockResolvedValue([
      'Fix the test',
    ]);

    const result = await fetchReworkFromPrReview(jiraConfig);

    expect(result).toBeDefined();
    expect(result!.ticket.parentInfo).toBe('PROJ-100');
  });

  it('defaults parentInfo to none when parent not in progress entry', async () => {
    vi.mocked(findEntriesWithStatus).mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-5',
        summary: 'Standalone',
        status: 'PR_CREATED',
      },
    ]);
    vi.mocked(mockCheckGitHubPrReviewState).mockResolvedValue({
      changesRequested: true,
      prNumber: 10,
      prUrl: 'https://github.com/o/r/pull/10',
      reviewers: [],
    });
    vi.mocked(mockFetchGitHubPrReviewComments).mockResolvedValue(['Fix it']);

    const result = await fetchReworkFromPrReview(jiraConfig);

    expect(result).toBeDefined();
    expect(result!.ticket.parentInfo).toBe('none');
  });

  it('returns undefined when checkPrReviewState returns undefined', async () => {
    vi.mocked(findEntriesWithStatus).mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-1',
        summary: 'Test',
        status: 'PR_CREATED',
      },
    ]);
    vi.mocked(mockCheckGitHubPrReviewState).mockResolvedValue(undefined);

    const result = await fetchReworkFromPrReview(jiraConfig);
    expect(result).toBeUndefined();
  });
});

// ─── Tests: buildReworkComment ───────────────────────────────────────────────

describe('buildReworkComment', () => {
  it('returns generic message when feedback is empty', () => {
    const comment = buildReworkComment([]);
    expect(comment).toBe(
      '[clancy] Rework pushed addressing reviewer feedback.',
    );
  });

  it('includes feedback items in the comment', () => {
    const comment = buildReworkComment([
      'Fix the validation logic',
      'Add null check',
    ]);
    expect(comment).toContain('[clancy]');
    expect(comment).toContain('2 feedback items');
    expect(comment).toContain('Fix the validation logic');
    expect(comment).toContain('Add null check');
  });

  it('truncates to 3 items with ellipsis', () => {
    const comment = buildReworkComment([
      'Item 1',
      'Item 2',
      'Item 3',
      'Item 4',
    ]);
    expect(comment).toContain('4 feedback items');
    expect(comment).toContain('Item 1');
    expect(comment).toContain('Item 2');
    expect(comment).toContain('Item 3');
    expect(comment).not.toContain('Item 4');
    expect(comment).toContain('...');
  });

  it('uses singular "item" for single feedback', () => {
    const comment = buildReworkComment(['Fix it']);
    expect(comment).toContain('1 feedback item.');
    expect(comment).not.toContain('items');
  });
});

// ─── Tests: postReworkActions ────────────────────────────────────────────────

describe('postReworkActions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts a comment on GitHub PR', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await postReworkActions(jiraConfig, 99, ['Fix it']);
    log.mockRestore();

    expect(mockPostGitHubPrComment).toHaveBeenCalledWith(
      'ghp_test',
      'owner/repo',
      99,
      expect.stringContaining('[clancy]'),
      'https://api.github.com',
    );
  });

  it('re-requests review from GitHub reviewers', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await postReworkActions(jiraConfig, 77, ['Fix tests'], undefined, [
      'alice',
      'bob',
    ]);
    log.mockRestore();

    expect(mockRequestGitHubReview).toHaveBeenCalledWith(
      'ghp_test',
      'owner/repo',
      77,
      ['alice', 'bob'],
      'https://api.github.com',
    );
  });

  it('does not re-request review when no reviewers', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await postReworkActions(jiraConfig, 99, ['Fix it']);
    log.mockRestore();

    expect(mockRequestGitHubReview).not.toHaveBeenCalled();
  });
});
