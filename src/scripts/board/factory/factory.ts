/**
 * Board factory.
 *
 * Creates a Board implementation from a BoardConfig discriminated union.
 */
import type { BoardConfig } from '~/schemas/env.js';

import type { Board } from '../board.js';
import { createGitHubBoard } from '../github/github-board.js';
import { createJiraBoard } from '../jira/jira-board.js';
import { createLinearBoard } from '../linear/linear-board.js';
import { createNotionBoard } from '../notion/notion-board.js';
import { createShortcutBoard } from '../shortcut/shortcut-board.js';

/**
 * Create a Board from a board configuration.
 *
 * @param config - The board configuration (Jira, GitHub, Linear, Shortcut, or Notion).
 * @returns A Board object for the configured provider.
 */
export function createBoard(config: BoardConfig): Board {
  switch (config.provider) {
    case 'jira':
      return createJiraBoard(config.env);
    case 'github':
      return createGitHubBoard(config.env);
    case 'linear':
      return createLinearBoard(config.env);
    case 'shortcut':
      return createShortcutBoard(config.env);
    case 'notion':
      return createNotionBoard(config.env);
  }
}
