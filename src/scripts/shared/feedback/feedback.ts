/**
 * Board-agnostic feedback facade.
 *
 * Dispatches to the correct board's `fetchComments` function to retrieve
 * reviewer comments for the QA rework loop.
 */
import type { BoardConfig } from '~/schemas/env.js';
import { fetchComments as fetchGitHubComments } from '~/scripts/board/github/github.js';
import {
  buildAuthHeader,
  fetchComments as fetchJiraComments,
} from '~/scripts/board/jira/jira.js';
import { fetchComments as fetchLinearComments } from '~/scripts/board/linear/linear.js';

/** Result of fetching reviewer feedback from the board. */
export interface FeedbackResult {
  comments: string[];
}

/**
 * Fetch reviewer feedback comments from the board.
 *
 * Dispatches to the correct board module based on the detected provider.
 * Best-effort — never throws; returns empty comments on any error.
 *
 * @param config - The detected board configuration.
 * @param ticketKey - The ticket key (e.g., `'PROJ-123'`, `'#42'`, `'ENG-99'`).
 * @param since - Optional ISO 8601 timestamp; only comments after this are returned.
 * @param issueId - Optional Linear issue UUID (required for Linear, ignored for other boards).
 * @returns A `FeedbackResult` containing the comment strings.
 */
export async function fetchFeedback(
  config: BoardConfig,
  ticketKey: string,
  since?: string,
  issueId?: string,
): Promise<FeedbackResult> {
  try {
    let comments: string[];

    switch (config.provider) {
      case 'jira': {
        const auth = buildAuthHeader(
          config.env.JIRA_USER,
          config.env.JIRA_API_TOKEN,
        );
        comments = await fetchJiraComments(
          config.env.JIRA_BASE_URL,
          auth,
          ticketKey,
          since,
        );
        break;
      }

      case 'github': {
        const match = ticketKey.match(/^#?(\d+)$/);

        if (!match) {
          console.warn(
            `⚠ Could not parse GitHub issue number from "${ticketKey}"`,
          );
          return { comments: [] };
        }

        const issueNumber = Number(match[1]);
        comments = await fetchGitHubComments(
          config.env.GITHUB_TOKEN,
          config.env.GITHUB_REPO,
          issueNumber,
          since,
        );
        break;
      }

      case 'linear': {
        if (!issueId) {
          console.warn(
            '⚠ Linear issueId required for fetchFeedback — skipping comment fetch',
          );
          return { comments: [] };
        }

        comments = await fetchLinearComments(
          config.env.LINEAR_API_KEY,
          issueId,
          since,
        );
        break;
      }

      default:
        return { comments: [] };
    }

    return { comments };
  } catch {
    return { comments: [] };
  }
}
