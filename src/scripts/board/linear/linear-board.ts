/**
 * Linear board factory.
 *
 * Returns a plain object conforming to the Board type, delegating to the
 * existing Linear board functions.
 */
import type { LinearEnv } from '~/schemas/env.js';
import type { FetchedTicket } from '~/scripts/once/types/types.js';

import type { Board, FetchTicketOpts } from '../board.js';
import {
  fetchBlockerStatus as fetchLinearBlockerStatus,
  fetchChildrenStatus as fetchLinearChildrenStatus,
  fetchIssues as fetchLinearIssues,
  isValidTeamId,
  pingLinear,
  transitionIssue as transitionLinearIssue,
} from './linear.js';

/**
 * Create a Board implementation for Linear.
 *
 * @param env - The validated Linear environment variables.
 * @returns A Board object that delegates to Linear API functions.
 */
export function createLinearBoard(env: LinearEnv): Board {
  return {
    async ping() {
      return pingLinear(env.LINEAR_API_KEY);
    },

    validateInputs() {
      if (!isValidTeamId(env.LINEAR_TEAM_ID)) {
        return '✗ LINEAR_TEAM_ID contains invalid characters';
      }
      return undefined;
    },

    async fetchTicket(opts: FetchTicketOpts) {
      const tickets = await this.fetchTickets(opts);
      return tickets[0];
    },

    async fetchTickets(opts: FetchTicketOpts) {
      const tickets = await fetchLinearIssues(
        {
          LINEAR_API_KEY: env.LINEAR_API_KEY,
          LINEAR_TEAM_ID: env.LINEAR_TEAM_ID,
          CLANCY_LABEL: env.CLANCY_LABEL,
        },
        opts.excludeHitl,
      );

      return tickets.map(
        (ticket): FetchedTicket => ({
          key: ticket.key,
          title: ticket.title,
          description: ticket.description,
          parentInfo: ticket.parentIdentifier ?? 'none',
          blockers: 'None',
          linearIssueId: ticket.issueId,
          issueId: ticket.issueId,
        }),
      );
    },

    async fetchBlockerStatus(ticket: FetchedTicket) {
      if (!ticket.issueId) return false;
      return fetchLinearBlockerStatus(env.LINEAR_API_KEY, ticket.issueId);
    },

    async fetchChildrenStatus(parentKey: string, parentId?: string) {
      // parentKey is the identifier (e.g. 'ENG-42') — used for Epic: text search.
      // parentId is the UUID — used for native children API fallback.
      // When parentId is missing, we can still try the Epic: text search.
      // The native fallback will be skipped, which is acceptable since
      // v0.6.0+ children always have Epic: in their description.
      return fetchLinearChildrenStatus(
        env.LINEAR_API_KEY,
        parentId ?? parentKey, // fallback to identifier — text search works, native fallback may not
        parentKey,
      );
    },

    async transitionTicket(ticket: FetchedTicket, status: string) {
      if (!ticket.linearIssueId) return false;
      const ok = await transitionLinearIssue(
        env.LINEAR_API_KEY,
        env.LINEAR_TEAM_ID,
        ticket.linearIssueId,
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
