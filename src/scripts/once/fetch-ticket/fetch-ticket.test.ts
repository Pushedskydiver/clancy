import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';

import { fetchTicket } from './fetch-ticket.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/board/jira/jira.js', () => ({
  buildAuthHeader: vi.fn(() => 'Basic auth'),
  fetchTicket: vi.fn(),
}));

vi.mock('~/scripts/board/github/github.js', () => ({
  fetchIssue: vi.fn(),
  resolveUsername: vi.fn(() => Promise.resolve('testuser')),
}));

vi.mock('~/scripts/board/linear/linear.js', () => ({
  fetchIssue: vi.fn(),
}));

const { fetchTicket: mockFetchJira } =
  await import('~/scripts/board/jira/jira.js');
const { fetchIssue: mockFetchGitHub, resolveUsername: mockResolveUsername } =
  await import('~/scripts/board/github/github.js');
const { fetchIssue: mockFetchLinear } =
  await import('~/scripts/board/linear/linear.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const jiraConfig: BoardConfig = {
  provider: 'jira',
  env: {
    JIRA_BASE_URL: 'https://example.atlassian.net',
    JIRA_USER: 'user@test.com',
    JIRA_API_TOKEN: 'token',
    JIRA_PROJECT_KEY: 'PROJ',
  },
};

const githubConfig: BoardConfig = {
  provider: 'github',
  env: {
    GITHUB_TOKEN: 'ghp_abc123',
    GITHUB_REPO: 'acme/app',
  },
};

const linearConfig: BoardConfig = {
  provider: 'linear',
  env: {
    LINEAR_API_KEY: 'lin_abc',
    LINEAR_TEAM_ID: 'abc-123',
  },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('fetchTicket', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns FetchedTicket from Jira response', async () => {
    vi.mocked(mockFetchJira).mockResolvedValue({
      key: 'PROJ-10',
      title: 'Add login',
      description: 'Create login page.',
      provider: 'jira',
      epicKey: 'PROJ-1',
      blockers: ['PROJ-5'],
    });

    const result = await fetchTicket(jiraConfig);

    expect(result).toEqual({
      key: 'PROJ-10',
      title: 'Add login',
      description: 'Create login page.',
      parentInfo: 'PROJ-1',
      blockers: 'Blocked by: PROJ-5',
    });
  });

  it('returns Jira ticket with no blockers', async () => {
    vi.mocked(mockFetchJira).mockResolvedValue({
      key: 'PROJ-11',
      title: 'Clean up',
      description: 'Refactor.',
      provider: 'jira',
      epicKey: 'PROJ-1',
      blockers: [],
    });

    const result = await fetchTicket(jiraConfig);
    expect(result?.blockers).toBe('None');
  });

  it('returns Jira ticket with no epic', async () => {
    vi.mocked(mockFetchJira).mockResolvedValue({
      key: 'PROJ-12',
      title: 'Standalone',
      description: 'No epic.',
      provider: 'jira',
      blockers: [],
    });

    const result = await fetchTicket(jiraConfig);
    expect(result?.parentInfo).toBe('none');
  });

  it('returns undefined when Jira has no tickets', async () => {
    vi.mocked(mockFetchJira).mockResolvedValue(undefined);
    const result = await fetchTicket(jiraConfig);
    expect(result).toBeUndefined();
  });

  it('returns FetchedTicket from GitHub response with milestone as parent', async () => {
    vi.mocked(mockFetchGitHub).mockResolvedValue({
      key: '#42',
      title: 'Fix bug',
      description: 'Bug description.',
      provider: 'github',
      milestone: 'Sprint 3',
    });

    const result = await fetchTicket(githubConfig);

    expect(mockResolveUsername).toHaveBeenCalledWith('ghp_abc123');
    expect(result).toEqual({
      key: '#42',
      title: 'Fix bug',
      description: 'Bug description.',
      parentInfo: 'Sprint 3',
      blockers: 'None',
    });
  });

  it('returns GitHub ticket with no milestone', async () => {
    vi.mocked(mockFetchGitHub).mockResolvedValue({
      key: '#99',
      title: 'No milestone',
      description: 'Test.',
      provider: 'github',
    });

    const result = await fetchTicket(githubConfig);
    expect(result?.parentInfo).toBe('none');
  });

  it('returns undefined when GitHub has no issues', async () => {
    vi.mocked(mockFetchGitHub).mockResolvedValue(undefined);
    const result = await fetchTicket(githubConfig);
    expect(result).toBeUndefined();
  });

  it('returns FetchedTicket from Linear response', async () => {
    vi.mocked(mockFetchLinear).mockResolvedValue({
      key: 'LIN-5',
      title: 'Linear task',
      description: 'Do something.',
      provider: 'linear',
      parentIdentifier: 'LIN-1',
      issueId: 'uuid-abc',
    });

    const result = await fetchTicket(linearConfig);

    expect(result).toEqual({
      key: 'LIN-5',
      title: 'Linear task',
      description: 'Do something.',
      parentInfo: 'LIN-1',
      blockers: 'None',
      linearIssueId: 'uuid-abc',
      issueId: 'uuid-abc',
    });
  });

  it('returns undefined when Linear has no issues', async () => {
    vi.mocked(mockFetchLinear).mockResolvedValue(undefined);
    const result = await fetchTicket(linearConfig);
    expect(result).toBeUndefined();
  });
});
