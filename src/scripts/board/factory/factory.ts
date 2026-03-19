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

/**
 * Create a Board from a board configuration.
 *
 * @param config - The board configuration (Jira, GitHub, or Linear).
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
  }
}
