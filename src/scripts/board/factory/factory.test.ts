import { describe, expect, it, vi } from 'vitest';

import type { BoardConfig } from '~/schemas/env.js';

import { createBoard } from './factory.js';

// Mock the board factories
vi.mock('../jira/jira-board.js', () => ({
  createJiraBoard: vi.fn(() => ({ _type: 'jira' })),
}));

vi.mock('../github/github-board.js', () => ({
  createGitHubBoard: vi.fn(() => ({ _type: 'github' })),
}));

vi.mock('../linear/linear-board.js', () => ({
  createLinearBoard: vi.fn(() => ({ _type: 'linear' })),
}));

describe('factory', () => {
  describe('createBoard', () => {
    it('creates a Jira board for jira provider', () => {
      const config: BoardConfig = {
        provider: 'jira',
        env: {
          JIRA_BASE_URL: 'https://example.atlassian.net',
          JIRA_USER: 'user@example.com',
          JIRA_API_TOKEN: 'token',
          JIRA_PROJECT_KEY: 'PROJ',
        },
      };

      const board = createBoard(config) as unknown as { _type: string };
      expect(board._type).toBe('jira');
    });

    it('creates a GitHub board for github provider', () => {
      const config: BoardConfig = {
        provider: 'github',
        env: {
          GITHUB_TOKEN: 'ghp_test',
          GITHUB_REPO: 'owner/repo',
        },
      };

      const board = createBoard(config) as unknown as { _type: string };
      expect(board._type).toBe('github');
    });

    it('creates a Linear board for linear provider', () => {
      const config: BoardConfig = {
        provider: 'linear',
        env: {
          LINEAR_API_KEY: 'lin_test',
          LINEAR_TEAM_ID: 'team-123',
        },
      };

      const board = createBoard(config) as unknown as { _type: string };
      expect(board._type).toBe('linear');
    });

    it('passes jira env to createJiraBoard', async () => {
      const { createJiraBoard } = await import('../jira/jira-board.js');

      const env = {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@example.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
      };

      createBoard({ provider: 'jira', env });
      expect(createJiraBoard).toHaveBeenCalledWith(env);
    });

    it('passes github env to createGitHubBoard', async () => {
      const { createGitHubBoard } = await import('../github/github-board.js');

      const env = {
        GITHUB_TOKEN: 'ghp_test',
        GITHUB_REPO: 'owner/repo',
      };

      createBoard({ provider: 'github', env });
      expect(createGitHubBoard).toHaveBeenCalledWith(env);
    });

    it('passes linear env to createLinearBoard', async () => {
      const { createLinearBoard } = await import('../linear/linear-board.js');

      const env = {
        LINEAR_API_KEY: 'lin_test',
        LINEAR_TEAM_ID: 'team-123',
      };

      createBoard({ provider: 'linear', env });
      expect(createLinearBoard).toHaveBeenCalledWith(env);
    });
  });
});
