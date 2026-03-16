import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';

import type { FetchedTicket } from '../types/types.js';
import {
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
}));

vi.mock('~/scripts/board/github/github.js', () => ({
  isValidRepo: vi.fn((r: string) => /^[^/]+\/[^/]+$/.test(r)),
  pingGitHub: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock('~/scripts/board/linear/linear.js', () => ({
  isValidTeamId: vi.fn((id: string) => /^[a-f0-9-]+$/i.test(id)),
  pingLinear: vi.fn(() => Promise.resolve({ ok: true })),
  transitionIssue: vi.fn(() => Promise.resolve(true)),
}));

const { pingJira } = await import('~/scripts/board/jira/jira.js');
const { pingGitHub } = await import('~/scripts/board/github/github.js');
const { pingLinear, transitionIssue: transitionLinearIssue } =
  await import('~/scripts/board/linear/linear.js');
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
    const env = sharedEnv(jiraConfig);
    expect(env.JIRA_BASE_URL).toBe('https://example.atlassian.net');
  });

  it('returns env from GitHub config', () => {
    const env = sharedEnv(githubConfig);
    expect(env.GITHUB_TOKEN).toBe('ghp_abc123');
  });

  it('returns env from Linear config', () => {
    const env = sharedEnv(linearConfig);
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
