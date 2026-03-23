/**
 * Jira board factory.
 *
 * Returns a plain object conforming to the Board type, delegating to the
 * existing Jira board functions.
 */
import type { JiraEnv } from '~/schemas/env.js';
import { jiraIssueLabelsResponseSchema } from '~/schemas/jira.js';
import type { FetchedTicket } from '~/types/board.js';

import type { Board, FetchTicketOpts } from '../board.js';
import { modifyLabelList, safeLabel } from '../label-helpers/label-helpers.js';
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

  async function fetchJiraLabels(
    issueKey: string,
  ): Promise<string[] | undefined> {
    const res = await fetch(
      `${env.JIRA_BASE_URL}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=labels`,
      { headers: { Authorization: auth, Accept: 'application/json' } },
    );
    if (!res.ok) {
      console.warn(`⚠ label GET ${issueKey} failed: HTTP ${res.status}`);
      return undefined;
    }
    const json = jiraIssueLabelsResponseSchema.parse(await res.json());
    return json.fields?.labels ?? [];
  }

  async function writeJiraLabels(
    issueKey: string,
    labels: string[],
  ): Promise<void> {
    const putRes = await fetch(
      `${env.JIRA_BASE_URL}/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { labels } }),
      },
    );
    if (!putRes.ok) {
      console.warn(`⚠ label PUT ${issueKey} returned HTTP ${putRes.status}`);
    }
  }

  return {
    async ping() {
      return pingJira(env.JIRA_BASE_URL, env.JIRA_PROJECT_KEY, auth);
    },

    validateInputs() {
      if (!isSafeJqlValue(env.JIRA_PROJECT_KEY)) {
        return '✗ JIRA_PROJECT_KEY contains invalid characters';
      }
      if (env.CLANCY_LABEL_BUILD && !isSafeJqlValue(env.CLANCY_LABEL_BUILD)) {
        return '✗ CLANCY_LABEL_BUILD contains invalid characters';
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
        opts.buildLabel ?? env.CLANCY_LABEL,
        opts.excludeHitl,
      );

      const statusName = env.CLANCY_JQL_STATUS ?? 'To Do';

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
          labels: ticket.labels ?? [],
          status: statusName,
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

    async ensureLabel(_label: string) {
      // No-op — Jira auto-creates labels on use.
    },

    async addLabel(issueKey: string, label: string) {
      await safeLabel(async () => {
        if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) return;
        await modifyLabelList(
          () => fetchJiraLabels(issueKey),
          (labels) => writeJiraLabels(issueKey, labels),
          label,
          'add',
        );
      }, 'addLabel');
    },

    async removeLabel(issueKey: string, label: string) {
      await safeLabel(async () => {
        if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) return;
        await modifyLabelList(
          () => fetchJiraLabels(issueKey),
          (labels) => writeJiraLabels(issueKey, labels),
          label,
          'remove',
        );
      }, 'removeLabel');
    },

    sharedEnv() {
      return env;
    },
  };
}
