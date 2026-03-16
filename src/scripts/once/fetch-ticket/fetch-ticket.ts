import {
  fetchIssue as fetchGitHubIssue,
  resolveUsername,
} from '~/scripts/board/github/github.js';
import {
  buildAuthHeader,
  fetchTicket as fetchJiraTicket,
} from '~/scripts/board/jira/jira.js';
import { fetchIssue as fetchLinearIssue } from '~/scripts/board/linear/linear.js';
import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';

import type { FetchedTicket } from '../types/types.js';

// ─── Board-specific fetch ────────────────────────────────────────────────────

export async function fetchTicket(
  config: BoardConfig,
): Promise<FetchedTicket | undefined> {
  switch (config.provider) {
    case 'jira': {
      const { env } = config;
      const auth = buildAuthHeader(env.JIRA_USER, env.JIRA_API_TOKEN);
      const ticket = await fetchJiraTicket(
        env.JIRA_BASE_URL,
        auth,
        env.JIRA_PROJECT_KEY,
        env.CLANCY_JQL_STATUS ?? 'To Do',
        env.CLANCY_JQL_SPRINT,
        env.CLANCY_LABEL,
      );

      if (!ticket) return undefined;

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
    }

    case 'github': {
      const { env } = config;
      const username = await resolveUsername(env.GITHUB_TOKEN);
      const ticket = await fetchGitHubIssue(
        env.GITHUB_TOKEN,
        env.GITHUB_REPO,
        env.CLANCY_LABEL,
        username,
      );

      if (!ticket) return undefined;

      return {
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
        parentInfo: ticket.milestone ?? 'none',
        blockers: 'None',
      };
    }

    case 'linear': {
      const { env } = config;
      const ticket = await fetchLinearIssue({
        LINEAR_API_KEY: env.LINEAR_API_KEY,
        LINEAR_TEAM_ID: env.LINEAR_TEAM_ID,
        CLANCY_LABEL: env.CLANCY_LABEL,
      });

      if (!ticket) return undefined;

      return {
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
        parentInfo: ticket.parentIdentifier ?? 'none',
        blockers: 'None',
        linearIssueId: ticket.issueId,
        issueId: ticket.issueId,
      };
    }
  }
}
