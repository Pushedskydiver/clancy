/**
 * Shortcut board factory.
 *
 * Returns a plain object conforming to the Board type, delegating to the
 * existing Shortcut board functions.
 */
import type { ShortcutEnv } from '~/schemas/env.js';
import type { FetchedTicket } from '~/types/board.js';

import type { Board, FetchTicketOpts } from '../board.js';
import {
  createLabel,
  fetchLabels,
  fetchBlockerStatus as fetchShortcutBlockerStatus,
  fetchChildrenStatus as fetchShortcutChildrenStatus,
  fetchStories as fetchShortcutStories,
  getStoryLabelIds,
  pingShortcut,
  resolveWorkflowStateId,
  resolveWorkflowStateIdsByType,
  transitionStory,
  updateStoryLabelIds,
} from './shortcut.js';

/**
 * Create a Board implementation for Shortcut.
 *
 * @param env - The validated Shortcut environment variables.
 * @returns A Board object that delegates to Shortcut API functions.
 */
export function createShortcutBoard(env: ShortcutEnv): Board {
  return {
    async ping() {
      return pingShortcut(env.SHORTCUT_API_TOKEN);
    },

    validateInputs() {
      // Shortcut tokens are opaque strings — no structural validation needed
      return undefined;
    },

    async fetchTicket(opts: FetchTicketOpts) {
      const tickets = await this.fetchTickets(opts);
      return tickets[0];
    },

    async fetchTickets(opts: FetchTicketOpts) {
      // Resolve "unstarted" state type to workflow state IDs
      const stateIds = await resolveWorkflowStateIdsByType(
        env.SHORTCUT_API_TOKEN,
        'unstarted',
        env.SHORTCUT_WORKFLOW,
      );

      const tickets = await fetchShortcutStories(
        env.SHORTCUT_API_TOKEN,
        stateIds,
        opts.buildLabel ?? env.CLANCY_LABEL,
        undefined, // ownerUuid — Shortcut search doesn't easily filter by owner in same way
        opts.excludeHitl,
      );

      return tickets.map(
        (ticket): FetchedTicket => ({
          key: ticket.key,
          title: ticket.title,
          description: ticket.description,
          parentInfo: ticket.epicId ? `epic-${ticket.epicId}` : 'none',
          blockers: 'None',
          issueId: String(ticket.storyId),
          labels: ticket.labels ?? [],
          status: 'unstarted',
        }),
      );
    },

    async fetchBlockerStatus(ticket: FetchedTicket) {
      const storyId = parseStoryId(ticket.key);
      if (storyId === undefined) return false;
      return fetchShortcutBlockerStatus(env.SHORTCUT_API_TOKEN, storyId);
    },

    async fetchChildrenStatus(parentKey: string, parentId?: string) {
      // Extract numeric epic ID from parentId, parentKey (sc-{id}), or epic-{id}
      const raw = parentId ?? parentKey.replace(/^(sc-|epic-)/, '');
      const epicId = parseInt(raw, 10);
      if (Number.isNaN(epicId)) return undefined;
      return fetchShortcutChildrenStatus(
        env.SHORTCUT_API_TOKEN,
        epicId,
        parentKey,
      );
    },

    async transitionTicket(ticket: FetchedTicket, status: string) {
      const storyId = parseStoryId(ticket.key);
      if (storyId === undefined) return false;

      const stateId = await resolveWorkflowStateId(
        env.SHORTCUT_API_TOKEN,
        status,
        env.SHORTCUT_WORKFLOW,
      );

      if (stateId === undefined) {
        console.warn(
          `⚠ Shortcut workflow state "${status}" not found — check workflow configuration`,
        );
        return false;
      }

      const ok = await transitionStory(
        env.SHORTCUT_API_TOKEN,
        storyId,
        stateId,
      );

      if (ok) console.log(`  → Transitioned to ${status}`);
      return ok;
    },

    async ensureLabel(label: string) {
      try {
        const labels = await fetchLabels(env.SHORTCUT_API_TOKEN);
        const existing = labels.find((l) => l.name === label);
        if (existing) return;

        await createLabel(env.SHORTCUT_API_TOKEN, label);
      } catch (err) {
        console.warn(
          `⚠ ensureLabel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async addLabel(issueKey: string, label: string) {
      try {
        await this.ensureLabel(label);

        const storyId = parseStoryId(issueKey);
        if (storyId === undefined) return;

        const labels = await fetchLabels(env.SHORTCUT_API_TOKEN);
        const target = labels.find((l) => l.name === label);
        if (!target) return;

        const currentIds = await getStoryLabelIds(
          env.SHORTCUT_API_TOKEN,
          storyId,
        );
        if (!currentIds) return;
        if (currentIds.includes(target.id)) return;

        await updateStoryLabelIds(env.SHORTCUT_API_TOKEN, storyId, [
          ...currentIds,
          target.id,
        ]);
      } catch (err) {
        console.warn(
          `⚠ addLabel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async removeLabel(issueKey: string, label: string) {
      try {
        const storyId = parseStoryId(issueKey);
        if (storyId === undefined) return;

        const labels = await fetchLabels(env.SHORTCUT_API_TOKEN);
        const target = labels.find((l) => l.name === label);
        if (!target) return;

        const currentIds = await getStoryLabelIds(
          env.SHORTCUT_API_TOKEN,
          storyId,
        );
        if (!currentIds) return;
        if (!currentIds.includes(target.id)) return;

        await updateStoryLabelIds(
          env.SHORTCUT_API_TOKEN,
          storyId,
          currentIds.filter((id) => id !== target.id),
        );
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
 * Parse a story ID from a Shortcut key (e.g., `'sc-123'` → `123`).
 *
 * @param key - The Shortcut story key.
 * @returns The numeric story ID, or `undefined` if parsing fails.
 */
function parseStoryId(key: string): number | undefined {
  const num = parseInt(key.replace('sc-', ''), 10);
  return Number.isNaN(num) ? undefined : num;
}
