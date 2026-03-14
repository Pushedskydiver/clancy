import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardConfig } from '~/schemas/env.js';

import { fetchFeedback } from './feedback.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('~/scripts/board/jira/jira.js', () => ({
  buildAuthHeader: vi.fn(
    (user: string, token: string) => `mocked-${user}:${token}`,
  ),
  fetchComments: vi.fn(),
}));

vi.mock('~/scripts/board/github/github.js', () => ({
  fetchComments: vi.fn(),
}));

vi.mock('~/scripts/board/linear/linear.js', () => ({
  fetchComments: vi.fn(),
}));

// Import mocked functions for assertions
const { buildAuthHeader: mockBuildAuth, fetchComments: mockJiraComments } =
  await import('~/scripts/board/jira/jira.js');
const { fetchComments: mockGitHubComments } =
  await import('~/scripts/board/github/github.js');
const { fetchComments: mockLinearComments } =
  await import('~/scripts/board/linear/linear.js');

// ─── Fixtures ───────────────────────────────────────────────────────────────

const jiraConfig: BoardConfig = {
  provider: 'jira',
  env: {
    JIRA_BASE_URL: 'https://example.atlassian.net',
    JIRA_USER: 'user@example.com',
    JIRA_API_TOKEN: 'tok123',
    JIRA_PROJECT_KEY: 'PROJ',
  },
};

const githubConfig: BoardConfig = {
  provider: 'github',
  env: {
    GITHUB_TOKEN: 'ghp_test',
    GITHUB_REPO: 'acme/app',
  },
};

const linearConfig: BoardConfig = {
  provider: 'linear',
  env: {
    LINEAR_API_KEY: 'lin_test',
    LINEAR_TEAM_ID: 'team-1',
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('fetchFeedback', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });
  describe('jira', () => {
    it('dispatches to Jira fetchComments with auth header', async () => {
      vi.mocked(mockJiraComments).mockResolvedValueOnce([
        'Fix the button',
        'Also fix the form',
      ]);

      const result = await fetchFeedback(jiraConfig, 'PROJ-123');

      expect(mockBuildAuth).toHaveBeenCalledWith('user@example.com', 'tok123');
      expect(mockJiraComments).toHaveBeenCalledWith(
        'https://example.atlassian.net',
        'mocked-user@example.com:tok123',
        'PROJ-123',
        undefined,
      );
      expect(result).toEqual({
        comments: ['Fix the button', 'Also fix the form'],
      });
    });

    it('passes since parameter through', async () => {
      vi.mocked(mockJiraComments).mockResolvedValueOnce(['New comment']);

      await fetchFeedback(jiraConfig, 'PROJ-456', '2026-03-01T00:00:00Z');

      expect(mockJiraComments).toHaveBeenCalledWith(
        'https://example.atlassian.net',
        'mocked-user@example.com:tok123',
        'PROJ-456',
        '2026-03-01T00:00:00Z',
      );
    });

    it('returns empty comments on error', async () => {
      vi.mocked(mockJiraComments).mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await fetchFeedback(jiraConfig, 'PROJ-789');

      expect(result).toEqual({ comments: [] });
    });
  });

  describe('github', () => {
    it('parses issue number from #42 and dispatches', async () => {
      vi.mocked(mockGitHubComments).mockResolvedValueOnce([
        'Please fix the alignment',
      ]);

      const result = await fetchFeedback(githubConfig, '#42');

      expect(mockGitHubComments).toHaveBeenCalledWith(
        'ghp_test',
        'acme/app',
        42,
        undefined,
      );
      expect(result).toEqual({ comments: ['Please fix the alignment'] });
    });

    it('passes since parameter through', async () => {
      vi.mocked(mockGitHubComments).mockResolvedValueOnce([]);

      await fetchFeedback(githubConfig, '#10', '2026-03-01T00:00:00Z');

      expect(mockGitHubComments).toHaveBeenCalledWith(
        'ghp_test',
        'acme/app',
        10,
        '2026-03-01T00:00:00Z',
      );
    });

    it('returns empty comments when ticket key is not a valid issue number', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await fetchFeedback(githubConfig, 'not-a-number');

      expect(result).toEqual({ comments: [] });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not parse GitHub issue number'),
      );

      warnSpy.mockRestore();
    });

    it('returns empty comments on error', async () => {
      vi.mocked(mockGitHubComments).mockRejectedValueOnce(
        new Error('API down'),
      );

      const result = await fetchFeedback(githubConfig, '#99');

      expect(result).toEqual({ comments: [] });
    });
  });

  describe('linear', () => {
    it('dispatches with issueId and returns comments', async () => {
      vi.mocked(mockLinearComments).mockResolvedValueOnce([
        'The tests are failing',
      ]);

      const result = await fetchFeedback(
        linearConfig,
        'ENG-42',
        undefined,
        'uuid-123',
      );

      expect(mockLinearComments).toHaveBeenCalledWith(
        'lin_test',
        'uuid-123',
        undefined,
      );
      expect(result).toEqual({ comments: ['The tests are failing'] });
    });

    it('passes since parameter through', async () => {
      vi.mocked(mockLinearComments).mockResolvedValueOnce([]);

      await fetchFeedback(
        linearConfig,
        'ENG-10',
        '2026-03-01T00:00:00Z',
        'uuid-456',
      );

      expect(mockLinearComments).toHaveBeenCalledWith(
        'lin_test',
        'uuid-456',
        '2026-03-01T00:00:00Z',
      );
    });

    it('warns and returns empty when no issueId provided', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await fetchFeedback(linearConfig, 'ENG-42');

      expect(result).toEqual({ comments: [] });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Linear issueId required'),
      );
      expect(mockLinearComments).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('returns empty comments on error', async () => {
      vi.mocked(mockLinearComments).mockRejectedValueOnce(
        new Error('GraphQL error'),
      );

      const result = await fetchFeedback(
        linearConfig,
        'ENG-99',
        undefined,
        'uuid-789',
      );

      expect(result).toEqual({ comments: [] });
    });
  });
});
