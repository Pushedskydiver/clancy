import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LinearEnv } from '~/schemas/env.js';
import type { FetchedTicket } from '~/scripts/once/types/types.js';

import { createLinearBoard } from './linear-board.js';

// Mock the underlying Linear functions
vi.mock('./linear.js', () => ({
  pingLinear: vi.fn(() => Promise.resolve({ ok: true })),
  isValidTeamId: vi.fn((id: string) => /^[a-zA-Z0-9_-]+$/.test(id)),
  fetchIssues: vi.fn(() => Promise.resolve([])),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
  fetchChildrenStatus: vi.fn(() =>
    Promise.resolve({ total: 4, incomplete: 2 }),
  ),
  transitionIssue: vi.fn(() => Promise.resolve(true)),
  linearGraphql: vi.fn(() => Promise.resolve(undefined)),
}));

const baseEnv: LinearEnv = {
  LINEAR_API_KEY: 'lin_test123',
  LINEAR_TEAM_ID: 'team-abc',
};

describe('linear-board', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('createLinearBoard', () => {
    it('returns an object with all Board methods', () => {
      const board = createLinearBoard(baseEnv);

      expect(typeof board.ping).toBe('function');
      expect(typeof board.validateInputs).toBe('function');
      expect(typeof board.fetchTicket).toBe('function');
      expect(typeof board.fetchTickets).toBe('function');
      expect(typeof board.fetchBlockerStatus).toBe('function');
      expect(typeof board.fetchChildrenStatus).toBe('function');
      expect(typeof board.transitionTicket).toBe('function');
      expect(typeof board.sharedEnv).toBe('function');
    });
  });

  describe('ping', () => {
    it('delegates to pingLinear with correct params', async () => {
      const { pingLinear } = await import('./linear.js');
      const board = createLinearBoard(baseEnv);

      await board.ping();

      expect(pingLinear).toHaveBeenCalledWith('lin_test123');
    });
  });

  describe('validateInputs', () => {
    it('returns undefined for valid team ID', () => {
      const board = createLinearBoard(baseEnv);
      expect(board.validateInputs()).toBeUndefined();
    });

    it('returns error for invalid team ID', async () => {
      const { isValidTeamId } = await import('./linear.js');
      vi.mocked(isValidTeamId).mockReturnValueOnce(false);

      const board = createLinearBoard({
        ...baseEnv,
        LINEAR_TEAM_ID: 'bad id!',
      });
      expect(board.validateInputs()).toBe(
        '✗ LINEAR_TEAM_ID contains invalid characters',
      );
    });
  });

  describe('fetchTickets', () => {
    it('delegates to fetchLinearIssues and normalises results', async () => {
      const { fetchIssues } = await import('./linear.js');
      vi.mocked(fetchIssues).mockResolvedValueOnce([
        {
          key: 'ENG-42',
          title: 'Test issue',
          description: 'A test issue',
          provider: 'linear',
          issueId: 'uuid-1',
          parentIdentifier: 'ENG-10',
        },
      ]);

      const board = createLinearBoard(baseEnv);
      const results = await board.fetchTickets({ excludeHitl: false });

      expect(results).toEqual([
        {
          key: 'ENG-42',
          title: 'Test issue',
          description: 'A test issue',
          parentInfo: 'ENG-10',
          blockers: 'None',
          linearIssueId: 'uuid-1',
          issueId: 'uuid-1',
          labels: [],
        },
      ]);
    });

    it('sets parentInfo to none when no parent', async () => {
      const { fetchIssues } = await import('./linear.js');
      vi.mocked(fetchIssues).mockResolvedValueOnce([
        {
          key: 'ENG-43',
          title: 'No parent',
          description: 'desc',
          provider: 'linear',
          issueId: 'uuid-2',
        },
      ]);

      const board = createLinearBoard(baseEnv);
      const results = await board.fetchTickets({ excludeHitl: false });

      expect(results[0].parentInfo).toBe('none');
    });

    it('passes excludeHitl to fetchIssues', async () => {
      const { fetchIssues } = await import('./linear.js');
      vi.mocked(fetchIssues).mockResolvedValueOnce([]);

      const board = createLinearBoard(baseEnv);
      await board.fetchTickets({ excludeHitl: true });

      expect(fetchIssues).toHaveBeenCalledWith(
        {
          LINEAR_API_KEY: 'lin_test123',
          LINEAR_TEAM_ID: 'team-abc',
          CLANCY_LABEL: undefined,
        },
        true,
      );
    });
  });

  describe('fetchTicket', () => {
    it('returns the first ticket from fetchTickets', async () => {
      const { fetchIssues } = await import('./linear.js');
      vi.mocked(fetchIssues).mockResolvedValueOnce([
        {
          key: 'ENG-1',
          title: 'First',
          description: 'desc',
          provider: 'linear',
          issueId: 'uuid-1',
        },
      ]);

      const board = createLinearBoard(baseEnv);
      const result = await board.fetchTicket({ excludeHitl: false });

      expect(result?.key).toBe('ENG-1');
    });

    it('returns undefined when no issues', async () => {
      const { fetchIssues } = await import('./linear.js');
      vi.mocked(fetchIssues).mockResolvedValueOnce([]);

      const board = createLinearBoard(baseEnv);
      const result = await board.fetchTicket({ excludeHitl: false });

      expect(result).toBeUndefined();
    });
  });

  describe('fetchBlockerStatus', () => {
    it('delegates to fetchLinearBlockerStatus', async () => {
      const { fetchBlockerStatus } = await import('./linear.js');
      vi.mocked(fetchBlockerStatus).mockResolvedValueOnce(true);

      const board = createLinearBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'ENG-42',
        title: 'Test',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
        issueId: 'uuid-1',
      };

      const result = await board.fetchBlockerStatus(ticket);

      expect(fetchBlockerStatus).toHaveBeenCalledWith('lin_test123', 'uuid-1');
      expect(result).toBe(true);
    });

    it('returns false when ticket has no issueId', async () => {
      const board = createLinearBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'ENG-42',
        title: 'Test',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.fetchBlockerStatus(ticket);
      expect(result).toBe(false);
    });
  });

  describe('fetchChildrenStatus', () => {
    it('delegates to fetchLinearChildrenStatus with parentId', async () => {
      const { fetchChildrenStatus } = await import('./linear.js');

      const board = createLinearBoard(baseEnv);
      const result = await board.fetchChildrenStatus('ENG-10', 'uuid-parent');

      expect(fetchChildrenStatus).toHaveBeenCalledWith(
        'lin_test123',
        'uuid-parent',
        'ENG-10',
      );
      expect(result).toEqual({ total: 4, incomplete: 2 });
    });

    it('falls back to identifier when no parentId provided', async () => {
      const board = createLinearBoard(baseEnv);
      const result = await board.fetchChildrenStatus('ENG-10');

      // Without parentId, uses identifier as fallback — text search still works
      expect(result).toEqual({ total: 4, incomplete: 2 });
    });
  });

  describe('transitionTicket', () => {
    it('delegates to transitionLinearIssue', async () => {
      const { transitionIssue } = await import('./linear.js');

      const board = createLinearBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'ENG-42',
        title: 'Test',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
        linearIssueId: 'uuid-1',
      };

      const result = await board.transitionTicket(ticket, 'In Progress');

      expect(transitionIssue).toHaveBeenCalledWith(
        'lin_test123',
        'team-abc',
        'uuid-1',
        'In Progress',
      );
      expect(result).toBe(true);
    });

    it('returns false when ticket has no linearIssueId', async () => {
      const board = createLinearBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'ENG-42',
        title: 'Test',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.transitionTicket(ticket, 'In Progress');
      expect(result).toBe(false);
    });
  });

  describe('ensureLabel', () => {
    it('caches label ID from team labels', async () => {
      const { linearGraphql } = await import('./linear.js');
      vi.mocked(linearGraphql).mockResolvedValueOnce({
        data: {
          team: {
            labels: { nodes: [{ id: 'label-uuid', name: 'clancy:build' }] },
          },
        },
      });

      const board = createLinearBoard(baseEnv);
      await board.ensureLabel('clancy:build');

      expect(linearGraphql).toHaveBeenCalledTimes(1);

      // Second call should use cache — no additional GraphQL call
      await board.ensureLabel('clancy:build');
      expect(linearGraphql).toHaveBeenCalledTimes(1);
    });

    it('falls back to workspace labels when not found on team', async () => {
      const { linearGraphql } = await import('./linear.js');
      vi.mocked(linearGraphql)
        .mockResolvedValueOnce({
          data: { team: { labels: { nodes: [] } } },
        })
        .mockResolvedValueOnce({
          data: {
            issueLabels: {
              nodes: [{ id: 'ws-label-uuid', name: 'clancy:build' }],
            },
          },
        });

      const board = createLinearBoard(baseEnv);
      await board.ensureLabel('clancy:build');

      expect(linearGraphql).toHaveBeenCalledTimes(2);
    });

    it('creates label when not found anywhere', async () => {
      const { linearGraphql } = await import('./linear.js');
      vi.mocked(linearGraphql)
        .mockResolvedValueOnce({
          data: { team: { labels: { nodes: [] } } },
        })
        .mockResolvedValueOnce({
          data: { issueLabels: { nodes: [] } },
        })
        .mockResolvedValueOnce({
          data: {
            issueLabelCreate: {
              issueLabel: { id: 'new-label-uuid' },
              success: true,
            },
          },
        });

      const board = createLinearBoard(baseEnv);
      await board.ensureLabel('clancy:build');

      expect(linearGraphql).toHaveBeenCalledTimes(3);
    });

    it('does not throw on API failure', async () => {
      const { linearGraphql } = await import('./linear.js');
      vi.mocked(linearGraphql).mockRejectedValueOnce(new Error('network'));

      const board = createLinearBoard(baseEnv);
      await expect(board.ensureLabel('clancy:build')).resolves.toBeUndefined();
    });
  });

  describe('addLabel', () => {
    it('calls ensureLabel then updates issue labels', async () => {
      const { linearGraphql } = await import('./linear.js');
      vi.mocked(linearGraphql)
        // ensureLabel: team labels
        .mockResolvedValueOnce({
          data: {
            team: {
              labels: {
                nodes: [{ id: 'label-uuid', name: 'clancy:build' }],
              },
            },
          },
        })
        // addLabel: issueSearch
        .mockResolvedValueOnce({
          data: {
            issueSearch: {
              nodes: [
                {
                  id: 'issue-uuid',
                  labels: { nodes: [{ id: 'existing-label' }] },
                },
              ],
            },
          },
        })
        // addLabel: issueUpdate
        .mockResolvedValueOnce({
          data: { issueUpdate: { success: true } },
        });

      const board = createLinearBoard(baseEnv);
      await board.addLabel('ENG-42', 'clancy:build');

      expect(linearGraphql).toHaveBeenCalledTimes(3);
      // Verify the issueUpdate call includes both existing and new label
      const updateCall = vi.mocked(linearGraphql).mock.calls[2];
      expect(updateCall[2]).toEqual({
        issueId: 'issue-uuid',
        labelIds: ['existing-label', 'label-uuid'],
      });
    });

    it('skips update when label already on issue', async () => {
      const { linearGraphql } = await import('./linear.js');
      vi.mocked(linearGraphql)
        // ensureLabel: team labels
        .mockResolvedValueOnce({
          data: {
            team: {
              labels: {
                nodes: [{ id: 'label-uuid', name: 'clancy:build' }],
              },
            },
          },
        })
        // addLabel: issueSearch — label already present
        .mockResolvedValueOnce({
          data: {
            issueSearch: {
              nodes: [
                {
                  id: 'issue-uuid',
                  labels: { nodes: [{ id: 'label-uuid' }] },
                },
              ],
            },
          },
        });

      const board = createLinearBoard(baseEnv);
      await board.addLabel('ENG-42', 'clancy:build');

      // Should NOT call issueUpdate
      expect(linearGraphql).toHaveBeenCalledTimes(2);
    });

    it('does not throw on API failure', async () => {
      const { linearGraphql } = await import('./linear.js');
      vi.mocked(linearGraphql).mockRejectedValueOnce(new Error('network'));

      const board = createLinearBoard(baseEnv);
      await expect(
        board.addLabel('ENG-42', 'clancy:build'),
      ).resolves.toBeUndefined();
    });
  });

  describe('removeLabel', () => {
    it('fetches issue labels and updates with label removed', async () => {
      const { linearGraphql } = await import('./linear.js');
      vi.mocked(linearGraphql)
        // removeLabel: issueSearch
        .mockResolvedValueOnce({
          data: {
            issueSearch: {
              nodes: [
                {
                  id: 'issue-uuid',
                  labels: {
                    nodes: [
                      { id: 'label-uuid', name: 'clancy:build' },
                      { id: 'other-uuid', name: 'other' },
                    ],
                  },
                },
              ],
            },
          },
        })
        // removeLabel: issueUpdate
        .mockResolvedValueOnce({
          data: { issueUpdate: { success: true } },
        });

      const board = createLinearBoard(baseEnv);
      await board.removeLabel('ENG-42', 'clancy:build');

      expect(linearGraphql).toHaveBeenCalledTimes(2);
      const updateCall = vi.mocked(linearGraphql).mock.calls[1];
      expect(updateCall[2]).toEqual({
        issueId: 'issue-uuid',
        labelIds: ['other-uuid'],
      });
    });

    it('skips update when label not on issue', async () => {
      const { linearGraphql } = await import('./linear.js');
      vi.mocked(linearGraphql).mockResolvedValueOnce({
        data: {
          issueSearch: {
            nodes: [
              {
                id: 'issue-uuid',
                labels: {
                  nodes: [{ id: 'other-uuid', name: 'other' }],
                },
              },
            ],
          },
        },
      });

      const board = createLinearBoard(baseEnv);
      await board.removeLabel('ENG-42', 'clancy:build');

      // Should NOT call issueUpdate
      expect(linearGraphql).toHaveBeenCalledTimes(1);
    });

    it('does not throw on API failure', async () => {
      const { linearGraphql } = await import('./linear.js');
      vi.mocked(linearGraphql).mockRejectedValueOnce(new Error('network'));

      const board = createLinearBoard(baseEnv);
      await expect(
        board.removeLabel('ENG-42', 'clancy:build'),
      ).resolves.toBeUndefined();
    });
  });

  describe('sharedEnv', () => {
    it('returns the env object', () => {
      const board = createLinearBoard(baseEnv);
      expect(board.sharedEnv()).toBe(baseEnv);
    });
  });
});
