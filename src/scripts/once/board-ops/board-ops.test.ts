import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BoardConfig,
  GitHubEnv,
  JiraEnv,
  LinearEnv,
} from '~/scripts/shared/env-schema/env-schema.js';

import type { FetchedTicket } from '../types/types.js';
import {
  fetchEpicChildrenStatus,
  pingBoard,
  sharedEnv,
  transitionToStatus,
  validateInputs,
} from './board-ops.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/board/jira/jira.js', () => ({
  buildAuthHeader: vi.fn(() => 'Basic auth'),
  isSafeJqlValue: vi.fn((v: string) => !/[;'"\\]/.test(v)),
  pingJira: vi.fn(() => Promise.resolve({ ok: true })),
  transitionIssue: vi.fn(() => Promise.resolve(true)),
  fetchChildrenStatus: vi.fn(),
}));

vi.mock('~/scripts/board/github/github.js', () => ({
  isValidRepo: vi.fn((r: string) => /^[^/]+\/[^/]+$/.test(r)),
  pingGitHub: vi.fn(() => Promise.resolve({ ok: true })),
  fetchChildrenStatus: vi.fn(),
}));

vi.mock('~/scripts/board/linear/linear.js', () => ({
  isValidTeamId: vi.fn((id: string) => /^[a-f0-9-]+$/i.test(id)),
  pingLinear: vi.fn(() => Promise.resolve({ ok: true })),
  transitionIssue: vi.fn(() => Promise.resolve(true)),
  fetchChildrenStatus: vi.fn(),
}));

const { pingJira, fetchChildrenStatus: mockJiraChildrenStatus } =
  await import('~/scripts/board/jira/jira.js');
const { pingGitHub, fetchChildrenStatus: mockGitHubChildrenStatus } =
  await import('~/scripts/board/github/github.js');
const {
  pingLinear,
  transitionIssue: transitionLinearIssue,
  fetchChildrenStatus: mockLinearChildrenStatus,
} = await import('~/scripts/board/linear/linear.js');
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

const ticket: FetchedTicket = {
  key: 'PROJ-1',
  title: 'Test ticket',
  description: 'Desc',
  parentInfo: 'none',
  blockers: 'None',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('sharedEnv', () => {
  it('returns env from Jira config', () => {
    const env = sharedEnv(jiraConfig) as JiraEnv;
    expect(env.JIRA_BASE_URL).toBe('https://example.atlassian.net');
  });

  it('returns env from GitHub config', () => {
    const env = sharedEnv(githubConfig) as GitHubEnv;
    expect(env.GITHUB_TOKEN).toBe('ghp_abc123');
  });

  it('returns env from Linear config', () => {
    const env = sharedEnv(linearConfig) as LinearEnv;
    expect(env.LINEAR_API_KEY).toBe('lin_abc');
  });
});

describe('pingBoard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches to pingJira for Jira config', async () => {
    const result = await pingBoard(jiraConfig);
    expect(result.ok).toBe(true);
    expect(pingJira).toHaveBeenCalledWith(
      'https://example.atlassian.net',
      'PROJ',
      'Basic auth',
    );
  });

  it('dispatches to pingGitHub for GitHub config', async () => {
    const result = await pingBoard(githubConfig);
    expect(result.ok).toBe(true);
    expect(pingGitHub).toHaveBeenCalledWith('ghp_abc123', 'acme/app');
  });

  it('dispatches to pingLinear for Linear config', async () => {
    const result = await pingBoard(linearConfig);
    expect(result.ok).toBe(true);
    expect(pingLinear).toHaveBeenCalledWith('lin_abc');
  });
});

describe('validateInputs', () => {
  it('returns undefined for valid Jira config', () => {
    expect(validateInputs(jiraConfig)).toBeUndefined();
  });

  it('rejects invalid Jira project key', () => {
    const bad: BoardConfig = {
      provider: 'jira',
      env: { ...jiraConfig.env, JIRA_PROJECT_KEY: "PROJ'; DROP TABLE" },
    };
    expect(validateInputs(bad)).toContain('JIRA_PROJECT_KEY');
  });

  it('returns undefined for valid GitHub config', () => {
    expect(validateInputs(githubConfig)).toBeUndefined();
  });

  it('rejects invalid GitHub repo format', () => {
    const bad: BoardConfig = {
      provider: 'github',
      env: { ...githubConfig.env, GITHUB_REPO: 'not-a-repo' },
    };
    expect(validateInputs(bad)).toContain('GITHUB_REPO');
  });

  it('returns undefined for valid Linear config', () => {
    expect(validateInputs(linearConfig)).toBeUndefined();
  });

  it('rejects invalid Linear team ID', () => {
    const bad: BoardConfig = {
      provider: 'linear',
      env: { ...linearConfig.env, LINEAR_TEAM_ID: 'bad id!' },
    };
    expect(validateInputs(bad)).toContain('LINEAR_TEAM_ID');
  });
});

describe('transitionToStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches to Jira transition', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await transitionToStatus(jiraConfig, ticket, 'Done');
    log.mockRestore();
    expect(transitionJiraIssue).toHaveBeenCalledWith(
      'https://example.atlassian.net',
      'Basic auth',
      'PROJ-1',
      'Done',
    );
  });

  it('is a no-op for GitHub (no status transitions)', async () => {
    const ghTicket: FetchedTicket = { ...ticket, key: '#42' };
    await transitionToStatus(githubConfig, ghTicket, 'Done');
    // No transition calls expected
    expect(transitionJiraIssue).not.toHaveBeenCalled();
    expect(transitionLinearIssue).not.toHaveBeenCalled();
  });

  it('dispatches to Linear transition when linearIssueId is set', async () => {
    const linTicket: FetchedTicket = {
      ...ticket,
      key: 'LIN-1',
      linearIssueId: 'uuid-123',
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await transitionToStatus(linearConfig, linTicket, 'Done');
    log.mockRestore();
    expect(transitionLinearIssue).toHaveBeenCalledWith(
      'lin_abc',
      'abc-123',
      'uuid-123',
      'Done',
    );
  });

  it('skips Linear transition when linearIssueId is missing', async () => {
    const linTicket: FetchedTicket = { ...ticket, key: 'LIN-2' };
    await transitionToStatus(linearConfig, linTicket, 'Done');
    expect(transitionLinearIssue).not.toHaveBeenCalled();
  });
});

// ─── fetchEpicChildrenStatus — dual-mode dispatch ─────────────────────────

describe('fetchEpicChildrenStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches to Jira fetchChildrenStatus', async () => {
    vi.mocked(mockJiraChildrenStatus).mockResolvedValue({
      total: 5,
      incomplete: 2,
    });

    const result = await fetchEpicChildrenStatus(jiraConfig, 'PROJ-100');

    expect(result).toEqual({ total: 5, incomplete: 2 });
    expect(mockJiraChildrenStatus).toHaveBeenCalledWith(
      'https://example.atlassian.net',
      'Basic auth',
      'PROJ-100',
    );
  });

  it('dispatches to GitHub fetchChildrenStatus', async () => {
    vi.mocked(mockGitHubChildrenStatus).mockResolvedValue({
      total: 3,
      incomplete: 1,
    });

    const result = await fetchEpicChildrenStatus(githubConfig, '#50');

    expect(result).toEqual({ total: 3, incomplete: 1 });
    expect(mockGitHubChildrenStatus).toHaveBeenCalledWith(
      'ghp_abc123',
      'acme/app',
      50,
    );
  });

  it('dispatches to Linear fetchChildrenStatus with parentId', async () => {
    vi.mocked(mockLinearChildrenStatus).mockResolvedValue({
      total: 4,
      incomplete: 0,
    });

    const result = await fetchEpicChildrenStatus(
      linearConfig,
      'ENG-42',
      'linear-uuid-123',
    );

    expect(result).toEqual({ total: 4, incomplete: 0 });
    expect(mockLinearChildrenStatus).toHaveBeenCalledWith(
      'lin_abc',
      'linear-uuid-123',
      'ENG-42',
    );
  });

  it('returns undefined for Linear when no parentId provided', async () => {
    const result = await fetchEpicChildrenStatus(linearConfig, 'ENG-42');

    expect(result).toBeUndefined();
    expect(mockLinearChildrenStatus).not.toHaveBeenCalled();
  });

  it('returns undefined for invalid GitHub parent key', async () => {
    const result = await fetchEpicChildrenStatus(githubConfig, 'not-a-number');

    expect(result).toBeUndefined();
  });

  it('returns undefined when Jira board module returns undefined', async () => {
    vi.mocked(mockJiraChildrenStatus).mockResolvedValue(undefined);

    const result = await fetchEpicChildrenStatus(jiraConfig, 'PROJ-100');

    expect(result).toBeUndefined();
  });

  it('returns zero counts when no children found (Jira)', async () => {
    vi.mocked(mockJiraChildrenStatus).mockResolvedValue({
      total: 0,
      incomplete: 0,
    });

    const result = await fetchEpicChildrenStatus(jiraConfig, 'PROJ-100');

    expect(result).toEqual({ total: 0, incomplete: 0 });
  });

  it('returns zero counts when no children found (GitHub)', async () => {
    vi.mocked(mockGitHubChildrenStatus).mockResolvedValue({
      total: 0,
      incomplete: 0,
    });

    const result = await fetchEpicChildrenStatus(githubConfig, '#50');

    expect(result).toEqual({ total: 0, incomplete: 0 });
  });
});
