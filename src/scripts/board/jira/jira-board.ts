/**
 * Jira board factory.
 *
 * Returns a plain object conforming to the Board type, delegating to the
 * existing Jira board functions.
 */
import type { JiraEnv } from '~/schemas/env.js';
import type { FetchedTicket } from '~/scripts/once/types/types.js';

import type { Board, FetchTicketOpts } from '../board.js';
import {
  buildAuthHeader,
  fetchBlockerStatus as fetchJiraBlockerStatus,
  fetchChildrenStatus as fetchJiraChildrenStatus,
  fetchTickets as fetchJiraTickets,
  isSafeJqlValue,
  pingJira,
  transitionIssue as transitionJiraIssue,
} from './jira.js';

/**
 * Create a Board implementation for Jira.
 *
 * @param env - The validated Jira environment variables.
 * @returns A Board object that delegates to Jira API functions.
 */
export function createJiraBoard(env: JiraEnv): Board {
  const auth = buildAuthHeader(env.JIRA_USER, env.JIRA_API_TOKEN);

  return {
    async ping() {
      return pingJira(env.JIRA_BASE_URL, env.JIRA_PROJECT_KEY, auth);
    },

    validateInputs() {
      if (!isSafeJqlValue(env.JIRA_PROJECT_KEY)) {
        return '✗ JIRA_PROJECT_KEY contains invalid characters';
      }
      if (env.CLANCY_LABEL && !isSafeJqlValue(env.CLANCY_LABEL)) {
        return '✗ CLANCY_LABEL contains invalid characters';
      }
      if (env.CLANCY_JQL_STATUS && !isSafeJqlValue(env.CLANCY_JQL_STATUS)) {
        return '✗ CLANCY_JQL_STATUS contains invalid characters';
      }
      return undefined;
    },

    async fetchTicket(opts: FetchTicketOpts) {
      const tickets = await this.fetchTickets(opts);
      return tickets[0];
    },

    async fetchTickets(opts: FetchTicketOpts) {
      const tickets = await fetchJiraTickets(
        env.JIRA_BASE_URL,
        auth,
        env.JIRA_PROJECT_KEY,
        env.CLANCY_JQL_STATUS ?? 'To Do',
        env.CLANCY_JQL_SPRINT,
        env.CLANCY_LABEL,
        opts.excludeHitl,
      );

      return tickets.map((ticket): FetchedTicket => {
        const blockerStr = ticket.blockers.length
          ? `Blocked by: ${ticket.blockers.join(', ')}`
          : 'None';

        return {
          key: ticket.key,
          title: ticket.title,
          description: ticket.description,
          parentInfo: ticket.epicKey ?? 'none',
          blockers: blockerStr,
        };
      });
    },

    async fetchBlockerStatus(ticket: FetchedTicket) {
      return fetchJiraBlockerStatus(env.JIRA_BASE_URL, auth, ticket.key);
    },

    async fetchChildrenStatus(parentKey: string) {
      return fetchJiraChildrenStatus(env.JIRA_BASE_URL, auth, parentKey);
    },

    async transitionTicket(ticket: FetchedTicket, status: string) {
      const ok = await transitionJiraIssue(
        env.JIRA_BASE_URL,
        auth,
        ticket.key,
        status,
      );
      if (ok) console.log(`  → Transitioned to ${status}`);
      return ok;
    },

    sharedEnv() {
      return env;
    },
  };
}
