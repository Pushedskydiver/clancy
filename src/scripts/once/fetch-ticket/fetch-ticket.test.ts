import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';

import { fetchTicket } from './fetch-ticket.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/board/jira/jira.js', () => ({
  buildAuthHeader: vi.fn(() => 'Basic auth'),
  fetchTickets: vi.fn(() => Promise.resolve([])),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('~/scripts/board/github/github.js', () => ({
  fetchIssues: vi.fn(() => Promise.resolve([])),
  resolveUsername: vi.fn(() => Promise.resolve('testuser')),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('~/scripts/board/linear/linear.js', () => ({
  fetchIssues: vi.fn(() => Promise.resolve([])),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
}));

const {
  fetchTickets: mockFetchJiraTickets,
  fetchBlockerStatus: mockJiraBlockerStatus,
} = await import('~/scripts/board/jira/jira.js');
const {
  fetchIssues: mockFetchGitHubIssues,
  resolveUsername: mockResolveUsername,
  fetchBlockerStatus: mockGitHubBlockerStatus,
} = await import('~/scripts/board/github/github.js');
const {
  fetchIssues: mockFetchLinearIssues,
  fetchBlockerStatus: mockLinearBlockerStatus,
} = await import('~/scripts/board/linear/linear.js');

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
    vi.mocked(mockFetchJiraTickets).mockResolvedValue([
      {
        key: 'PROJ-10',
        title: 'Add login',
        description: 'Create login page.',
        provider: 'jira',
        epicKey: 'PROJ-1',
        blockers: ['PROJ-5'],
      },
    ]);

    const result = await fetchTicket(jiraConfig);

    expect(result).toEqual({
      key: 'PROJ-10',
      title: 'Add login',
      description: 'Create login page.',
      parentInfo: 'PROJ-1',
      blockers: 'Blocked by: PROJ-5',
      labels: [],
    });
  });

  it('returns Jira ticket with no blockers', async () => {
    vi.mocked(mockFetchJiraTickets).mockResolvedValue([
      {
        key: 'PROJ-11',
        title: 'Clean up',
        description: 'Refactor.',
        provider: 'jira',
        epicKey: 'PROJ-1',
        blockers: [],
      },
    ]);

    const result = await fetchTicket(jiraConfig);
    expect(result?.blockers).toBe('None');
  });

  it('returns Jira ticket with no epic', async () => {
    vi.mocked(mockFetchJiraTickets).mockResolvedValue([
      {
        key: 'PROJ-12',
        title: 'Standalone',
        description: 'No epic.',
        provider: 'jira',
        blockers: [],
      },
    ]);

    const result = await fetchTicket(jiraConfig);
    expect(result?.parentInfo).toBe('none');
  });

  it('returns undefined when Jira has no tickets', async () => {
    vi.mocked(mockFetchJiraTickets).mockResolvedValue([]);
    const result = await fetchTicket(jiraConfig);
    expect(result).toBeUndefined();
  });

  it('returns FetchedTicket from GitHub response with milestone as parent', async () => {
    vi.mocked(mockFetchGitHubIssues).mockResolvedValue([
      {
        key: '#42',
        title: 'Fix bug',
        description: 'Bug description.',
        provider: 'github',
        milestone: 'Sprint 3',
      },
    ]);

    const result = await fetchTicket(githubConfig);

    expect(mockResolveUsername).toHaveBeenCalledWith('ghp_abc123');
    expect(result).toEqual({
      key: '#42',
      title: 'Fix bug',
      description: 'Bug description.',
      parentInfo: 'Sprint 3',
      blockers: 'None',
      labels: [],
    });
  });

  it('returns GitHub ticket with no milestone', async () => {
    vi.mocked(mockFetchGitHubIssues).mockResolvedValue([
      {
        key: '#99',
        title: 'No milestone',
        description: 'Test.',
        provider: 'github',
      },
    ]);

    const result = await fetchTicket(githubConfig);
    expect(result?.parentInfo).toBe('none');
  });

  it('returns undefined when GitHub has no issues', async () => {
    vi.mocked(mockFetchGitHubIssues).mockResolvedValue([]);
    const result = await fetchTicket(githubConfig);
    expect(result).toBeUndefined();
  });

  it('returns FetchedTicket from Linear response', async () => {
    vi.mocked(mockFetchLinearIssues).mockResolvedValue([
      {
        key: 'LIN-5',
        title: 'Linear task',
        description: 'Do something.',
        provider: 'linear',
        parentIdentifier: 'LIN-1',
        issueId: 'uuid-abc',
      },
    ]);

    const result = await fetchTicket(linearConfig);

    expect(result).toEqual({
      key: 'LIN-5',
      title: 'Linear task',
      description: 'Do something.',
      parentInfo: 'LIN-1',
      blockers: 'None',
      linearIssueId: 'uuid-abc',
      issueId: 'uuid-abc',
      labels: [],
    });
  });

  it('returns undefined when Linear has no issues', async () => {
    vi.mocked(mockFetchLinearIssues).mockResolvedValue([]);
    const result = await fetchTicket(linearConfig);
    expect(result).toBeUndefined();
  });
});

// ─── Multi-candidate blocker-aware pickup ─────────────────────────────────

describe('fetchTicket — blocker-aware multi-candidate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns first candidate when it is unblocked', async () => {
    vi.mocked(mockFetchJiraTickets).mockResolvedValue([
      {
        key: 'PROJ-10',
        title: 'First ticket',
        description: 'Desc.',
        provider: 'jira',
        epicKey: 'PROJ-1',
        blockers: [],
      },
    ]);
    vi.mocked(mockJiraBlockerStatus).mockResolvedValue(false);

    const result = await fetchTicket(jiraConfig);

    expect(result).toBeDefined();
    expect(result?.key).toBe('PROJ-10');
  });

  it('skips blocked Jira candidate and returns second unblocked one', async () => {
    vi.mocked(mockFetchJiraTickets).mockResolvedValue([
      {
        key: 'PROJ-10',
        title: 'Blocked ticket',
        description: 'Desc.',
        provider: 'jira',
        epicKey: 'PROJ-1',
        blockers: ['PROJ-5'],
      },
      {
        key: 'PROJ-11',
        title: 'Unblocked ticket',
        description: 'Desc.',
        provider: 'jira',
        epicKey: 'PROJ-1',
        blockers: [],
      },
    ]);

    vi.mocked(mockJiraBlockerStatus)
      .mockResolvedValueOnce(true) // first candidate is blocked
      .mockResolvedValueOnce(false); // second candidate is unblocked

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(jiraConfig);
    log.mockRestore();

    expect(result).toBeDefined();
    expect(result?.key).toBe('PROJ-11');
  });

  it('returns undefined when all Jira candidates are blocked', async () => {
    vi.mocked(mockFetchJiraTickets).mockResolvedValue([
      {
        key: 'PROJ-10',
        title: 'Blocked',
        description: 'Desc.',
        provider: 'jira',
        blockers: ['PROJ-5'],
      },
    ]);
    vi.mocked(mockJiraBlockerStatus).mockResolvedValue(true);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(jiraConfig);
    log.mockRestore();

    expect(result).toBeUndefined();
  });

  it('returns undefined when no candidates in queue', async () => {
    vi.mocked(mockFetchJiraTickets).mockResolvedValue([]);

    const result = await fetchTicket(jiraConfig);

    expect(result).toBeUndefined();
  });

  it('skips blocked GitHub candidate and returns second unblocked one', async () => {
    vi.mocked(mockFetchGitHubIssues).mockResolvedValue([
      {
        key: '#41',
        title: 'Blocked issue',
        description: 'Blocked by #10.',
        provider: 'github',
        milestone: 'Sprint 3',
      },
      {
        key: '#42',
        title: 'Unblocked issue',
        description: 'No blockers.',
        provider: 'github',
        milestone: 'Sprint 3',
      },
    ]);

    vi.mocked(mockGitHubBlockerStatus)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(githubConfig);
    log.mockRestore();

    expect(result).toBeDefined();
    expect(result?.key).toBe('#42');
  });

  it('skips blocked Linear candidate and returns second unblocked one', async () => {
    vi.mocked(mockFetchLinearIssues).mockResolvedValue([
      {
        key: 'LIN-4',
        title: 'Blocked task',
        description: 'Blocked.',
        provider: 'linear',
        parentIdentifier: 'LIN-1',
        issueId: 'uuid-blocked',
      },
      {
        key: 'LIN-5',
        title: 'Unblocked task',
        description: 'Free.',
        provider: 'linear',
        parentIdentifier: 'LIN-1',
        issueId: 'uuid-free',
      },
    ]);

    vi.mocked(mockLinearBlockerStatus)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(linearConfig);
    log.mockRestore();

    expect(result).toBeDefined();
    expect(result?.key).toBe('LIN-5');
  });

  it('returns single unblocked GitHub candidate', async () => {
    vi.mocked(mockFetchGitHubIssues).mockResolvedValue([
      {
        key: '#42',
        title: 'Fix bug',
        description: 'Bug description.',
        provider: 'github',
        milestone: 'Sprint 3',
      },
    ]);
    vi.mocked(mockGitHubBlockerStatus).mockResolvedValue(false);

    const result = await fetchTicket(githubConfig);

    expect(result).toBeDefined();
    expect(result?.key).toBe('#42');
  });

  it('returns single unblocked Linear candidate', async () => {
    vi.mocked(mockFetchLinearIssues).mockResolvedValue([
      {
        key: 'LIN-5',
        title: 'Linear task',
        description: 'Do something.',
        provider: 'linear',
        parentIdentifier: 'LIN-1',
        issueId: 'uuid-abc',
      },
    ]);
    vi.mocked(mockLinearBlockerStatus).mockResolvedValue(false);

    const result = await fetchTicket(linearConfig);

    expect(result).toBeDefined();
    expect(result?.key).toBe('LIN-5');
  });
});

// ─── HITL/AFK queue filtering ─────────────────────────────────────────────

describe('fetchTicket — HITL/AFK filtering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('AFK mode: tickets with clancy:hitl label are excluded from queue', async () => {
    vi.mocked(mockFetchJiraTickets).mockResolvedValue([
      {
        key: 'PROJ-20',
        title: 'AFK-safe ticket',
        description: 'Not HITL.',
        provider: 'jira',
        blockers: [],
      },
    ]);
    vi.mocked(mockJiraBlockerStatus).mockResolvedValue(false);

    const result = await fetchTicket(jiraConfig, { isAfk: true });

    expect(result).toBeDefined();
    expect(result?.key).toBe('PROJ-20');
    // Verify the excludeHitl flag was passed through
    expect(mockFetchJiraTickets).toHaveBeenCalledWith(
      expect.any(String), // baseUrl
      expect.any(String), // auth
      'PROJ',
      'To Do',
      undefined, // sprint
      undefined, // label
      true, // excludeHitl
    );
  });

  it('interactive mode: all tickets returned regardless of labels', async () => {
    vi.mocked(mockFetchJiraTickets).mockResolvedValue([
      {
        key: 'PROJ-21',
        title: 'HITL ticket',
        description: 'Needs human input.',
        provider: 'jira',
        blockers: [],
      },
    ]);
    vi.mocked(mockJiraBlockerStatus).mockResolvedValue(false);

    const result = await fetchTicket(jiraConfig);

    expect(result).toBeDefined();
    expect(result?.key).toBe('PROJ-21');
    // Verify excludeHitl is false in interactive mode
    expect(mockFetchJiraTickets).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'PROJ',
      'To Do',
      undefined,
      undefined,
      false, // excludeHitl
    );
  });

  it('AFK mode with GitHub: hitl tickets excluded', async () => {
    vi.mocked(mockFetchGitHubIssues).mockResolvedValue([
      {
        key: '#50',
        title: 'AFK-safe issue',
        description: 'Not HITL.',
        provider: 'github',
      },
    ]);

    const result = await fetchTicket(githubConfig, { isAfk: true });

    expect(result).toBeDefined();
    expect(result?.key).toBe('#50');
    expect(mockFetchGitHubIssues).toHaveBeenCalledWith(
      'ghp_abc123',
      'acme/app',
      undefined, // label
      'testuser', // username
      true, // excludeHitl
    );
  });

  it('AFK mode with Linear: hitl tickets excluded', async () => {
    vi.mocked(mockFetchLinearIssues).mockResolvedValue([
      {
        key: 'LIN-10',
        title: 'AFK-safe task',
        description: 'Not HITL.',
        provider: 'linear',
        issueId: 'uuid-xyz',
      },
    ]);

    const result = await fetchTicket(linearConfig, { isAfk: true });

    expect(result).toBeDefined();
    expect(result?.key).toBe('LIN-10');
    expect(mockFetchLinearIssues).toHaveBeenCalledWith(
      expect.objectContaining({ LINEAR_API_KEY: 'lin_abc' }),
      true, // excludeHitl
    );
  });
});

// ─── Pipeline label filtering ─────────────────────────────────────────────

describe('fetchTicket — pipeline label filtering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses CLANCY_LABEL_BUILD for Jira queue filtering with fallback to CLANCY_LABEL', async () => {
    const config: BoardConfig = {
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        CLANCY_LABEL_BUILD: 'clancy:build',
      },
    };

    vi.mocked(mockFetchJiraTickets).mockResolvedValue([]);
    await fetchTicket(config);

    expect(mockFetchJiraTickets).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'PROJ',
      'To Do',
      undefined,
      'clancy:build', // uses CLANCY_LABEL_BUILD
      false,
    );
  });

  it('falls back to CLANCY_LABEL when CLANCY_LABEL_BUILD is not set (Jira)', async () => {
    const config: BoardConfig = {
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        CLANCY_LABEL: 'clancy',
      },
    };

    vi.mocked(mockFetchJiraTickets).mockResolvedValue([]);
    await fetchTicket(config);

    expect(mockFetchJiraTickets).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'PROJ',
      'To Do',
      undefined,
      'clancy', // falls back to CLANCY_LABEL
      false,
    );
  });

  it('uses CLANCY_LABEL_BUILD for GitHub queue filtering', async () => {
    const config: BoardConfig = {
      provider: 'github',
      env: {
        GITHUB_TOKEN: 'ghp_abc123',
        GITHUB_REPO: 'acme/app',
        CLANCY_LABEL_BUILD: 'clancy:build',
      },
    };

    vi.mocked(mockFetchGitHubIssues).mockResolvedValue([]);
    await fetchTicket(config);

    expect(mockFetchGitHubIssues).toHaveBeenCalledWith(
      'ghp_abc123',
      'acme/app',
      'clancy:build', // uses CLANCY_LABEL_BUILD
      'testuser',
      false,
    );
  });

  it('uses CLANCY_LABEL_BUILD for Linear queue filtering', async () => {
    const config: BoardConfig = {
      provider: 'linear',
      env: {
        LINEAR_API_KEY: 'lin_abc',
        LINEAR_TEAM_ID: 'abc-123',
        CLANCY_LABEL_BUILD: 'clancy:build',
      },
    };

    vi.mocked(mockFetchLinearIssues).mockResolvedValue([]);
    await fetchTicket(config);

    expect(mockFetchLinearIssues).toHaveBeenCalledWith(
      expect.objectContaining({ CLANCY_LABEL: 'clancy:build' }),
      false,
    );
  });

  it('skips candidate with plan label (dual-label AFK race guard)', async () => {
    const config: BoardConfig = {
      provider: 'github',
      env: {
        GITHUB_TOKEN: 'ghp_abc123',
        GITHUB_REPO: 'acme/app',
        CLANCY_LABEL_BUILD: 'clancy:build',
        CLANCY_LABEL_PLAN: 'clancy:plan',
      },
    };

    vi.mocked(mockFetchGitHubIssues).mockResolvedValue([
      {
        key: '#41',
        title: 'Has both labels',
        description: 'Dual label.',
        provider: 'github',
        labels: ['clancy:build', 'clancy:plan'],
      },
      {
        key: '#42',
        title: 'Only build label',
        description: 'Clean.',
        provider: 'github',
        labels: ['clancy:build'],
      },
    ]);
    vi.mocked(mockGitHubBlockerStatus).mockResolvedValue(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(config);
    log.mockRestore();

    expect(result).toBeDefined();
    expect(result?.key).toBe('#42');
  });

  it('returns candidate when no plan label is configured', async () => {
    vi.mocked(mockFetchGitHubIssues).mockResolvedValue([
      {
        key: '#41',
        title: 'Has some labels',
        description: 'Desc.',
        provider: 'github',
        labels: ['clancy:build', 'some-label'],
      },
    ]);
    vi.mocked(mockGitHubBlockerStatus).mockResolvedValue(false);

    const result = await fetchTicket(githubConfig);

    expect(result).toBeDefined();
    expect(result?.key).toBe('#41');
  });

  it('skips Jira candidate with plan label (fallback to CLANCY_PLAN_LABEL)', async () => {
    const config: BoardConfig = {
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        CLANCY_PLAN_LABEL: 'needs-refinement',
      },
    };

    vi.mocked(mockFetchJiraTickets).mockResolvedValue([
      {
        key: 'PROJ-10',
        title: 'Still being planned',
        description: 'Desc.',
        provider: 'jira',
        blockers: [],
        labels: ['needs-refinement', 'clancy'],
      },
      {
        key: 'PROJ-11',
        title: 'Ready to build',
        description: 'Desc.',
        provider: 'jira',
        blockers: [],
        labels: ['clancy'],
      },
    ]);
    vi.mocked(mockJiraBlockerStatus).mockResolvedValue(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(config);
    log.mockRestore();

    expect(result).toBeDefined();
    expect(result?.key).toBe('PROJ-11');
  });

  it('returns undefined when all candidates have plan label', async () => {
    const config: BoardConfig = {
      provider: 'github',
      env: {
        GITHUB_TOKEN: 'ghp_abc123',
        GITHUB_REPO: 'acme/app',
        CLANCY_LABEL_PLAN: 'clancy:plan',
      },
    };

    vi.mocked(mockFetchGitHubIssues).mockResolvedValue([
      {
        key: '#41',
        title: 'Still planning',
        description: 'Desc.',
        provider: 'github',
        labels: ['clancy:plan'],
      },
    ]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await fetchTicket(config);
    log.mockRestore();

    expect(result).toBeUndefined();
  });
});
