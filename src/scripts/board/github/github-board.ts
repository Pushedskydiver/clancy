/**
 * GitHub Issues board factory.
 *
 * Returns a plain object conforming to the Board type, delegating to the
 * existing GitHub board functions.
 */
import type { GitHubEnv } from '~/schemas/env.js';
import { GITHUB_API, githubHeaders } from '~/scripts/shared/http/http.js';
import type { FetchedTicket } from '~/types/board.js';

import type { Board, FetchTicketOpts } from '../board.js';
import {
  fetchBlockerStatus as fetchGitHubBlockerStatus,
  fetchChildrenStatus as fetchGitHubChildrenStatus,
  fetchIssues as fetchGitHubIssues,
  isValidRepo,
  pingGitHub,
  resolveUsername,
} from './github.js';

/** Pattern matching `Epic: #N` or `Parent: #N` in issue descriptions. */
const EPIC_REF_PATTERN = /^(?:Epic|Parent): (#\d+)/m;

/**
 * Extract a parent issue reference from a GitHub issue description.
 *
 * Looks for `Epic: #N` or `Parent: #N` (the conventions used by the
 * strategist and pre-v0.6.0 workflows). Returns the `#N` string if
 * found, or `undefined` otherwise.
 */
function parseEpicRef(description: string): string | undefined {
  const match = description.match(EPIC_REF_PATTERN);
  return match?.[1];
}

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
        opts.buildLabel ?? env.CLANCY_LABEL,
        username,
        opts.excludeHitl,
      );

      return tickets.map(
        (ticket): FetchedTicket => ({
          key: ticket.key,
          title: ticket.title,
          description: ticket.description,
          parentInfo:
            ticket.milestone ?? parseEpicRef(ticket.description) ?? 'none',
          blockers: 'None',
          labels: ticket.labels ?? [],
          status: 'open',
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

    async ensureLabel(label: string) {
      try {
        const headers = githubHeaders(env.GITHUB_TOKEN);
        const res = await fetch(
          `${GITHUB_API}/repos/${env.GITHUB_REPO}/labels/${encodeURIComponent(label)}`,
          { headers },
        );

        if (res.ok) return; // Label already exists

        if (res.status === 404) {
          const createRes = await fetch(
            `${GITHUB_API}/repos/${env.GITHUB_REPO}/labels`,
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: label, color: '0075ca' }),
            },
          );
          if (!createRes.ok && createRes.status !== 422) {
            console.warn(
              `⚠ ensureLabel create returned HTTP ${createRes.status}`,
            );
          }
        } else {
          console.warn(`⚠ ensureLabel GET returned HTTP ${res.status}`);
        }
      } catch (err) {
        console.warn(
          `⚠ ensureLabel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async addLabel(issueKey: string, label: string) {
      try {
        await this.ensureLabel(label);

        const issueNumber = parseInt(issueKey.replace('#', ''), 10);
        if (Number.isNaN(issueNumber)) return;

        const headers = githubHeaders(env.GITHUB_TOKEN);
        const addRes = await fetch(
          `${GITHUB_API}/repos/${env.GITHUB_REPO}/issues/${issueNumber}/labels`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ labels: [label] }),
          },
        );
        if (!addRes.ok) {
          console.warn(`⚠ addLabel returned HTTP ${addRes.status}`);
        }
      } catch (err) {
        console.warn(
          `⚠ addLabel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async removeLabel(issueKey: string, label: string) {
      try {
        const issueNumber = parseInt(issueKey.replace('#', ''), 10);
        if (Number.isNaN(issueNumber)) return;

        const headers = githubHeaders(env.GITHUB_TOKEN);
        const res = await fetch(
          `${GITHUB_API}/repos/${env.GITHUB_REPO}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
          { method: 'DELETE', headers },
        );

        // Ignore 404 — label may not be on the issue
        if (!res.ok && res.status !== 404) {
          console.warn(`⚠ removeLabel returned HTTP ${res.status}`);
        }
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
