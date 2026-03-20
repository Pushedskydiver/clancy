/**
 * Azure DevOps board factory.
 *
 * Returns a plain object conforming to the Board type, delegating to the
 * existing Azure DevOps board functions.
 */
import type { AzdoEnv } from '~/schemas/env.js';
import type { FetchedTicket } from '~/scripts/once/types/types.js';

import type { Board, FetchTicketOpts } from '../board.js';
import {
  buildTagsString,
  fetchBlockerStatus as fetchAzdoBlockerStatus,
  fetchChildrenStatus as fetchAzdoChildrenStatus,
  fetchTickets as fetchAzdoTickets,
  fetchWorkItem,
  isSafeWiqlValue,
  parseTags,
  pingAzdo,
  updateWorkItem,
} from './azdo.js';

/**
 * Create a Board implementation for Azure DevOps.
 *
 * @param env - The validated Azure DevOps environment variables.
 * @returns A Board object that delegates to Azure DevOps API functions.
 */
export function createAzdoBoard(env: AzdoEnv): Board {
  const org = env.AZDO_ORG;
  const project = env.AZDO_PROJECT;
  const pat = env.AZDO_PAT;
  const status = env.CLANCY_AZDO_STATUS ?? 'New';
  const wit = env.CLANCY_AZDO_WIT;

  return {
    async ping() {
      return pingAzdo(org, project, pat);
    },

    validateInputs() {
      if (!org.trim()) return '✗ AZDO_ORG must not be empty';
      if (!project.trim()) return '✗ AZDO_PROJECT must not be empty';
      if (!pat.trim()) return '✗ AZDO_PAT must not be empty';

      if (!isSafeWiqlValue(project)) {
        return '✗ AZDO_PROJECT contains unsafe characters for WIQL queries';
      }

      if (!isSafeWiqlValue(status)) {
        return '✗ CLANCY_AZDO_STATUS contains unsafe characters for WIQL queries';
      }

      if (wit && !isSafeWiqlValue(wit)) {
        return '✗ CLANCY_AZDO_WIT contains unsafe characters for WIQL queries';
      }

      return undefined;
    },

    async fetchTicket(opts: FetchTicketOpts) {
      const tickets = await this.fetchTickets(opts);
      return tickets[0];
    },

    async fetchTickets(opts: FetchTicketOpts) {
      const tickets = await fetchAzdoTickets(
        org,
        project,
        pat,
        status,
        wit,
        opts.excludeHitl,
      );

      return tickets.map(
        (ticket): FetchedTicket => ({
          key: ticket.key,
          title: ticket.title,
          description: ticket.description,
          parentInfo: ticket.parentId ? `azdo-${ticket.parentId}` : 'none',
          blockers: 'None',
          issueId: String(ticket.workItemId),
          labels: ticket.labels ?? [],
        }),
      );
    },

    async fetchBlockerStatus(ticket: FetchedTicket) {
      const workItemId = parseWorkItemId(ticket.key);
      if (workItemId === undefined) return false;
      return fetchAzdoBlockerStatus(org, project, pat, workItemId);
    },

    async fetchChildrenStatus(parentKey: string, parentId?: string) {
      const id = parentId ? parseInt(parentId, 10) : undefined;
      if (id === undefined || Number.isNaN(id)) return undefined;
      return fetchAzdoChildrenStatus(org, project, pat, id, parentKey);
    },

    async transitionTicket(ticket: FetchedTicket, targetStatus: string) {
      const workItemId = parseWorkItemId(ticket.key);
      if (workItemId === undefined) return false;

      const ok = await updateWorkItem(org, project, pat, workItemId, [
        {
          op: 'replace',
          path: '/fields/System.State',
          value: targetStatus,
        },
      ]);

      if (ok) console.log(`  → Transitioned to ${targetStatus}`);
      return ok;
    },

    async ensureLabel(_label: string) {
      // Azure DevOps tags auto-create — no-op
    },

    async addLabel(issueKey: string, label: string) {
      try {
        const workItemId = parseWorkItemId(issueKey);
        if (workItemId === undefined) return;

        const item = await fetchWorkItem(org, project, pat, workItemId);
        if (!item) return;

        const currentTags = parseTags(item.fields['System.Tags']);
        if (currentTags.includes(label)) return;

        const newTags = [...currentTags, label];

        await updateWorkItem(org, project, pat, workItemId, [
          {
            op: 'replace',
            path: '/fields/System.Tags',
            value: buildTagsString(newTags),
          },
        ]);
      } catch (err) {
        console.warn(
          `⚠ addLabel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async removeLabel(issueKey: string, label: string) {
      try {
        const workItemId = parseWorkItemId(issueKey);
        if (workItemId === undefined) return;

        const item = await fetchWorkItem(org, project, pat, workItemId);
        if (!item) return;

        const currentTags = parseTags(item.fields['System.Tags']);
        if (!currentTags.includes(label)) return;

        const newTags = currentTags.filter((t) => t !== label);

        await updateWorkItem(org, project, pat, workItemId, [
          {
            op: 'replace',
            path: '/fields/System.Tags',
            value: buildTagsString(newTags),
          },
        ]);
      } catch (err) {
        console.warn(
          `⚠ removeLabel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    sharedEnv() {
      return env;
    },
  };
}

/**
 * Parse a work item ID from an Azure DevOps key (e.g., `'azdo-123'` → `123`).
 *
 * @param key - The Azure DevOps work item key.
 * @returns The numeric work item ID, or `undefined` if parsing fails.
 */
function parseWorkItemId(key: string): number | undefined {
  const num = parseInt(key.replace('azdo-', ''), 10);
  return Number.isNaN(num) ? undefined : num;
}
