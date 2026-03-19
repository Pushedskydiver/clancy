/**
 * GitHub Issues board factory.
 *
 * Returns a plain object conforming to the Board type, delegating to the
 * existing GitHub board functions.
 */
import type { GitHubEnv } from '~/schemas/env.js';
import type { FetchedTicket } from '~/scripts/once/types/types.js';

import type { Board, FetchTicketOpts } from '../board.js';
import {
  fetchBlockerStatus as fetchGitHubBlockerStatus,
  fetchChildrenStatus as fetchGitHubChildrenStatus,
  fetchIssues as fetchGitHubIssues,
  isValidRepo,
  pingGitHub,
  resolveUsername,
} from './github.js';

/**
 * Create a Board implementation for GitHub Issues.
 *
 * @param env - The validated GitHub environment variables.
 * @returns A Board object that delegates to GitHub API functions.
 */
export function createGitHubBoard(env: GitHubEnv): Board {
  return {
    async ping() {
      return pingGitHub(env.GITHUB_TOKEN, env.GITHUB_REPO);
    },

    validateInputs() {
      if (!isValidRepo(env.GITHUB_REPO)) {
        return '✗ GITHUB_REPO format is invalid — expected owner/repo';
      }
      return undefined;
    },

    async fetchTicket(opts: FetchTicketOpts) {
      const tickets = await this.fetchTickets(opts);
      return tickets[0];
    },

    async fetchTickets(opts: FetchTicketOpts) {
      const username = await resolveUsername(env.GITHUB_TOKEN);
      const tickets = await fetchGitHubIssues(
        env.GITHUB_TOKEN,
        env.GITHUB_REPO,
        env.CLANCY_LABEL,
        username,
        opts.excludeHitl,
      );

      return tickets.map(
        (ticket): FetchedTicket => ({
          key: ticket.key,
          title: ticket.title,
          description: ticket.description,
          parentInfo: ticket.milestone ?? 'none',
          blockers: 'None',
        }),
      );
    },

    async fetchBlockerStatus(ticket: FetchedTicket) {
      const issueNumber = parseInt(ticket.key.replace('#', ''), 10);
      if (Number.isNaN(issueNumber)) return false;
      return fetchGitHubBlockerStatus(
        env.GITHUB_TOKEN,
        env.GITHUB_REPO,
        issueNumber,
        ticket.description,
      );
    },

    async fetchChildrenStatus(parentKey: string) {
      const issueNumber = parseInt(parentKey.replace('#', ''), 10);
      if (Number.isNaN(issueNumber)) return undefined;
      return fetchGitHubChildrenStatus(
        env.GITHUB_TOKEN,
        env.GITHUB_REPO,
        issueNumber,
      );
    },

    async transitionTicket() {
      // GitHub Issues only has open/closed — status transitions not applicable.
      // closeIssue is called separately after merge.
      return false;
    },

    sharedEnv() {
      return env;
    },
  };
}
