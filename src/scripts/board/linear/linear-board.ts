/**
 * Linear board factory.
 *
 * Returns a plain object conforming to the Board type, delegating to the
 * existing Linear board functions.
 */
import type { LinearEnv } from '~/schemas/env.js';
import {
  linearIssueLabelSearchResponseSchema,
  linearLabelCreateResponseSchema,
  linearTeamLabelsResponseSchema,
  linearWorkspaceLabelsResponseSchema,
} from '~/schemas/linear.js';
import type { FetchedTicket } from '~/scripts/once/types/types.js';

import type { Board, FetchTicketOpts } from '../board.js';
import {
  fetchBlockerStatus as fetchLinearBlockerStatus,
  fetchChildrenStatus as fetchLinearChildrenStatus,
  fetchIssues as fetchLinearIssues,
  isValidTeamId,
  linearGraphql,
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
  /** Cache: label name → Linear label UUID. */
  const labelIdCache = new Map<string, string>();

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

    async ensureLabel(label: string) {
      try {
        // Return early if already cached
        if (labelIdCache.has(label)) return;

        // 1. Check team labels
        const teamQuery = `
          query($teamId: String!) {
            team(id: $teamId) {
              labels { nodes { id name } }
            }
          }
        `;

        const teamRaw = await linearGraphql(env.LINEAR_API_KEY, teamQuery, {
          teamId: env.LINEAR_TEAM_ID,
        });

        const teamData = linearTeamLabelsResponseSchema.parse(teamRaw);

        const teamLabel = teamData?.data?.team?.labels?.nodes?.find(
          (l) => l.name === label,
        );

        if (teamLabel) {
          labelIdCache.set(label, teamLabel.id);
          return;
        }

        // 2. Check workspace labels
        const wsQuery = `
          query($name: String!) {
            issueLabels(filter: { name: { eq: $name } }) {
              nodes { id name }
            }
          }
        `;

        const wsRaw = await linearGraphql(env.LINEAR_API_KEY, wsQuery, {
          name: label,
        });

        const wsData = linearWorkspaceLabelsResponseSchema.parse(wsRaw);

        const wsLabel = wsData?.data?.issueLabels?.nodes?.[0];

        if (wsLabel) {
          labelIdCache.set(label, wsLabel.id);
          return;
        }

        // 3. Create team-scoped label
        const createMutation = `
          mutation($teamId: String!, $name: String!) {
            issueLabelCreate(input: { teamId: $teamId, name: $name, color: "#0075ca" }) {
              issueLabel { id }
              success
            }
          }
        `;

        const createRaw = await linearGraphql(
          env.LINEAR_API_KEY,
          createMutation,
          { teamId: env.LINEAR_TEAM_ID, name: label },
        );

        const createData = linearLabelCreateResponseSchema.parse(createRaw);

        const newId = createData?.data?.issueLabelCreate?.issueLabel?.id;
        if (newId) labelIdCache.set(label, newId);
      } catch (err) {
        console.warn(
          `⚠ ensureLabel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async addLabel(issueKey: string, label: string) {
      try {
        await this.ensureLabel(label);

        const labelId = labelIdCache.get(label);
        if (!labelId) return;

        // Resolve issue identifier to UUID + current labels
        const issueQuery = `
          query($identifier: String!) {
            issueSearch(query: $identifier, first: 1) {
              nodes {
                id
                labels { nodes { id } }
              }
            }
          }
        `;

        const issueRaw = await linearGraphql(env.LINEAR_API_KEY, issueQuery, {
          identifier: issueKey,
        });

        const issueData = linearIssueLabelSearchResponseSchema.parse(issueRaw);

        const issue = issueData?.data?.issueSearch?.nodes?.[0];
        if (!issue) return;

        const currentIds = issue.labels?.nodes?.map((l) => l.id) ?? [];

        if (currentIds.includes(labelId)) return;

        const mutation = `
          mutation($issueId: String!, $labelIds: [String!]!) {
            issueUpdate(id: $issueId, input: { labelIds: $labelIds }) {
              success
            }
          }
        `;

        await linearGraphql(env.LINEAR_API_KEY, mutation, {
          issueId: issue.id,
          labelIds: [...currentIds, labelId],
        });
      } catch (err) {
        console.warn(
          `⚠ addLabel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async removeLabel(issueKey: string, label: string) {
      try {
        const labelId = labelIdCache.get(label);

        // Resolve issue identifier to UUID + current labels
        const issueQuery = `
          query($identifier: String!) {
            issueSearch(query: $identifier, first: 1) {
              nodes {
                id
                labels { nodes { id name } }
              }
            }
          }
        `;

        const issueRaw = await linearGraphql(env.LINEAR_API_KEY, issueQuery, {
          identifier: issueKey,
        });

        const issueData = issueRaw as {
          data?: {
            issueSearch?: {
              nodes?: Array<{
                id: string;
                labels?: { nodes?: Array<{ id: string; name: string }> };
              }>;
            };
          };
        };

        const issue = issueData?.data?.issueSearch?.nodes?.[0];
        if (!issue) return;

        const currentLabels = issue.labels?.nodes ?? [];

        // Find by ID if cached, otherwise by name
        const targetId =
          labelId ?? currentLabels.find((l) => l.name === label)?.id;
        if (!targetId) return;

        const updatedIds = currentLabels
          .map((l) => l.id)
          .filter((id) => id !== targetId);

        // No change needed if label wasn't on the issue
        if (updatedIds.length === currentLabels.length) return;

        const mutation = `
          mutation($issueId: String!, $labelIds: [String!]!) {
            issueUpdate(id: $issueId, input: { labelIds: $labelIds }) {
              success
            }
          }
        `;

        await linearGraphql(env.LINEAR_API_KEY, mutation, {
          issueId: issue.id,
          labelIds: updatedIds,
        });
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
