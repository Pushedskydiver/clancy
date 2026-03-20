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

vi.mock('../shortcut/shortcut-board.js', () => ({
  createShortcutBoard: vi.fn(() => ({ _type: 'shortcut' })),
}));

vi.mock('../notion/notion-board.js', () => ({
  createNotionBoard: vi.fn(() => ({ _type: 'notion' })),
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

    it('creates a Shortcut board for shortcut provider', () => {
      const config: BoardConfig = {
        provider: 'shortcut',
        env: {
          SHORTCUT_API_TOKEN: 'sc_test',
        },
      };

      const board = createBoard(config) as unknown as { _type: string };
      expect(board._type).toBe('shortcut');
    });

    it('passes shortcut env to createShortcutBoard', async () => {
      const { createShortcutBoard } =
        await import('../shortcut/shortcut-board.js');

      const env = {
        SHORTCUT_API_TOKEN: 'sc_test',
      };

      createBoard({ provider: 'shortcut', env });
      expect(createShortcutBoard).toHaveBeenCalledWith(env);
    });

    it('creates a Notion board for notion provider', () => {
      const config: BoardConfig = {
        provider: 'notion',
        env: {
          NOTION_TOKEN: 'ntn_test',
          NOTION_DATABASE_ID: 'db-uuid-1234',
        },
      };

      const board = createBoard(config) as unknown as { _type: string };
      expect(board._type).toBe('notion');
    });

    it('passes notion env to createNotionBoard', async () => {
      const { createNotionBoard } = await import('../notion/notion-board.js');

      const env = {
        NOTION_TOKEN: 'ntn_test',
        NOTION_DATABASE_ID: 'db-uuid-1234',
      };

      createBoard({ provider: 'notion', env });
      expect(createNotionBoard).toHaveBeenCalledWith(env);
    });
  });
});
