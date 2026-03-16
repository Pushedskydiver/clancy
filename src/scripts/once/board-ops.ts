import { isValidRepo, pingGitHub } from '~/scripts/board/github/github.js';
import {
  buildAuthHeader,
  isSafeJqlValue,
  pingJira,
  transitionIssue as transitionJiraIssue,
} from '~/scripts/board/jira/jira.js';
import {
  isValidTeamId,
  pingLinear,
  transitionIssue as transitionLinearIssue,
} from '~/scripts/board/linear/linear.js';
import type {
  BoardConfig,
  SharedEnv,
} from '~/scripts/shared/env-schema/env-schema.js';

import type { FetchedTicket } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Type-safe access to shared env vars across all board configs. */
export function sharedEnv(config: BoardConfig): SharedEnv {
  return config.env;
}

// ─── Board-specific ping ─────────────────────────────────────────────────────

export async function pingBoard(
  config: BoardConfig,
): Promise<{ ok: boolean; error?: string }> {
  switch (config.provider) {
    case 'jira': {
      const { env } = config;
      const auth = buildAuthHeader(env.JIRA_USER, env.JIRA_API_TOKEN);
      return pingJira(env.JIRA_BASE_URL, env.JIRA_PROJECT_KEY, auth);
    }

    case 'github':
      return pingGitHub(config.env.GITHUB_TOKEN, config.env.GITHUB_REPO);

    case 'linear':
      return pingLinear(config.env.LINEAR_API_KEY);
  }
}

// ─── Board-specific validation ───────────────────────────────────────────────

export function validateInputs(config: BoardConfig): string | undefined {
  switch (config.provider) {
    case 'jira': {
      const { env } = config;
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
    }

    case 'github': {
      if (!isValidRepo(config.env.GITHUB_REPO)) {
        return '✗ GITHUB_REPO format is invalid — expected owner/repo';
      }
      return undefined;
    }

    case 'linear': {
      if (!isValidTeamId(config.env.LINEAR_TEAM_ID)) {
        return '✗ LINEAR_TEAM_ID contains invalid characters';
      }
      return undefined;
    }
  }
}

// ─── Board-specific transitions ──────────────────────────────────────────────

export async function transitionToStatus(
  config: BoardConfig,
  ticket: FetchedTicket,
  statusName: string,
): Promise<void> {
  switch (config.provider) {
    case 'jira': {
      const { env } = config;
      const auth = buildAuthHeader(env.JIRA_USER, env.JIRA_API_TOKEN);
      const issueKey = ticket.key;
      const ok = await transitionJiraIssue(
        env.JIRA_BASE_URL,
        auth,
        issueKey,
        statusName,
      );
      if (ok) console.log(`  → Transitioned to ${statusName}`);
      break;
    }

    case 'github': {
      // GitHub Issues only has open/closed — status transitions not applicable
      // closeIssue is called separately after merge
      break;
    }

    case 'linear': {
      const { env } = config;
      if (!ticket.linearIssueId) break;
      const ok = await transitionLinearIssue(
        env.LINEAR_API_KEY,
        env.LINEAR_TEAM_ID,
        ticket.linearIssueId,
        statusName,
      );
      if (ok) console.log(`  → Transitioned to ${statusName}`);
      break;
    }
  }
}
