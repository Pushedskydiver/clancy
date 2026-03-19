import {
  fetchBlockerStatus as fetchGitHubBlockerStatus,
  fetchIssues as fetchGitHubIssues,
  resolveUsername,
} from '~/scripts/board/github/github.js';
import {
  buildAuthHeader,
  fetchBlockerStatus as fetchJiraBlockerStatus,
  fetchTickets as fetchJiraTickets,
} from '~/scripts/board/jira/jira.js';
import {
  fetchBlockerStatus as fetchLinearBlockerStatus,
  fetchIssues as fetchLinearIssues,
} from '~/scripts/board/linear/linear.js';
import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';

import type { FetchedTicket } from '../types/types.js';

/** Options for ticket fetching behaviour. */
export type FetchTicketOptions = {
  /** If `true`, excludes tickets with the `clancy:hitl` label. */
  isAfk?: boolean;
};

/** Whether the current run is in AFK mode (set by the AFK runner). */
function detectAfkMode(opts?: FetchTicketOptions): boolean {
  return opts?.isAfk ?? process.env.CLANCY_AFK_MODE === '1';
}

// ─── Board-specific candidate fetch ──────────────────────────────────────────

/**
 * Fetch candidate tickets from the board.
 *
 * @param config - The board configuration.
 * @param excludeHitl - Whether to exclude `clancy:hitl` labelled tickets.
 * @returns Array of normalised candidate tickets.
 */
async function fetchCandidates(
  config: BoardConfig,
  excludeHitl: boolean,
): Promise<FetchedTicket[]> {
  // Provider-specific API calls + field mapping — not a Board concern
  // because each board returns different raw shapes that need normalising.
  switch (config.provider) {
    case 'jira': {
      const { env } = config;
      const auth = buildAuthHeader(env.JIRA_USER, env.JIRA_API_TOKEN);
      const tickets = await fetchJiraTickets(
        env.JIRA_BASE_URL,
        auth,
        env.JIRA_PROJECT_KEY,
        env.CLANCY_JQL_STATUS ?? 'To Do',
        env.CLANCY_JQL_SPRINT,
        env.CLANCY_LABEL,
        excludeHitl,
      );

      return tickets.map((ticket) => {
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
    }

    case 'github': {
      const { env } = config;
      const username = await resolveUsername(env.GITHUB_TOKEN);
      const tickets = await fetchGitHubIssues(
        env.GITHUB_TOKEN,
        env.GITHUB_REPO,
        env.CLANCY_LABEL,
        username,
        excludeHitl,
      );

      return tickets.map((ticket) => ({
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
        parentInfo: ticket.milestone ?? 'none',
        blockers: 'None',
      }));
    }

    case 'linear': {
      const { env } = config;
      const tickets = await fetchLinearIssues(
        {
          LINEAR_API_KEY: env.LINEAR_API_KEY,
          LINEAR_TEAM_ID: env.LINEAR_TEAM_ID,
          CLANCY_LABEL: env.CLANCY_LABEL,
        },
        excludeHitl,
      );

      return tickets.map((ticket) => ({
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
        parentInfo: ticket.parentIdentifier ?? 'none',
        blockers: 'None',
        linearIssueId: ticket.issueId,
        issueId: ticket.issueId,
      }));
    }
  }
}

// ─── Blocker check ───────────────────────────────────────────────────────────

/**
 * Check whether a ticket is blocked on the board.
 *
 * @param config - The board configuration.
 * @param ticket - The candidate ticket.
 * @returns `true` if the ticket is blocked.
 */
async function isBlocked(
  config: BoardConfig,
  ticket: FetchedTicket,
): Promise<boolean> {
  // Provider-specific blocker APIs — each board has a unique mechanism
  // (Jira: issueLinks, GitHub: body parsing, Linear: relations GraphQL).
  switch (config.provider) {
    case 'jira': {
      const { env } = config;
      const auth = buildAuthHeader(env.JIRA_USER, env.JIRA_API_TOKEN);
      return fetchJiraBlockerStatus(env.JIRA_BASE_URL, auth, ticket.key);
    }

    case 'github': {
      const { env } = config;
      const issueNumber = parseInt(ticket.key.replace('#', ''), 10);
      if (Number.isNaN(issueNumber)) return false;
      return fetchGitHubBlockerStatus(
        env.GITHUB_TOKEN,
        env.GITHUB_REPO,
        issueNumber,
        ticket.description,
      );
    }

    case 'linear': {
      const { env } = config;
      if (!ticket.issueId) return false;
      return fetchLinearBlockerStatus(env.LINEAR_API_KEY, ticket.issueId);
    }
  }
}

// ─── Board-specific fetch (blocker-aware) ────────────────────────────────────

/**
 * Fetch the next available unblocked ticket from the board.
 *
 * Fetches up to 5 candidate tickets and returns the first one that is not
 * blocked. If all candidates are blocked, returns `undefined`.
 *
 * In AFK mode (`CLANCY_AFK_MODE=1` or `opts.isAfk`), tickets with the
 * `clancy:hitl` label are excluded from the candidate pool.
 *
 * @param config - The board configuration.
 * @param opts - Optional fetch behaviour overrides.
 * @returns The first unblocked ticket, or `undefined` if none available.
 */
export async function fetchTicket(
  config: BoardConfig,
  opts?: FetchTicketOptions,
): Promise<FetchedTicket | undefined> {
  const excludeHitl = detectAfkMode(opts);
  const candidates = await fetchCandidates(config, excludeHitl);
  if (!candidates.length) return undefined;

  for (const candidate of candidates) {
    const blocked = await isBlocked(config, candidate);
    if (!blocked) return candidate;
    console.log(`Skipping ${candidate.key} — blocked`);
  }

  return undefined;
}
