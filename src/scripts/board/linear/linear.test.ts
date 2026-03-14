import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchComments,
  fetchIssue,
  fetchReworkIssue,
  isValidTeamId,
  pingLinear,
} from './linear.js';

describe('linear', () => {
  describe('isValidTeamId', () => {
    it('accepts alphanumeric IDs', () => {
      expect(isValidTeamId('abc123')).toBe(true);
    });

    it('accepts IDs with hyphens and underscores', () => {
      expect(isValidTeamId('team-id_v2')).toBe(true);
    });

    it('rejects IDs with spaces', () => {
      expect(isValidTeamId('team id')).toBe(false);
    });

    it('rejects IDs with special characters', () => {
      expect(isValidTeamId('team;drop')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidTeamId('')).toBe(false);
    });
  });

  describe('pingLinear', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns ok true on successful response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ data: { viewer: { id: 'usr_1' } } }),
        }),
      );

      const result = await pingLinear('lin_key');
      expect(result).toEqual({ ok: true });
    });

    it('returns error on auth failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
        }),
      );

      const result = await pingLinear('bad_key');
      expect(result).toEqual({
        ok: false,
        error: '✗ Linear auth failed — check LINEAR_API_KEY',
      });
    });

    it('returns error on network failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await pingLinear('lin_key');
      expect(result).toEqual({
        ok: false,
        error: '✗ Could not reach Linear — check network',
      });
    });
  });

  describe('fetchIssue', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns ticket on success', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                viewer: {
                  assignedIssues: {
                    nodes: [
                      {
                        id: 'issue-id-1',
                        identifier: 'TEAM-42',
                        title: 'Fix the bug',
                        description: 'It is broken',
                        parent: { identifier: 'TEAM-10', title: 'Epic' },
                      },
                    ],
                  },
                },
              },
            }),
        }),
      );

      const env = {
        LINEAR_API_KEY: 'lin_key',
        LINEAR_TEAM_ID: 'team-1',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fetchIssue(env as any);
      expect(result).toEqual({
        key: 'TEAM-42',
        title: 'Fix the bug',
        description: 'It is broken',
        provider: 'linear',
        issueId: 'issue-id-1',
        parentIdentifier: 'TEAM-10',
      });
    });

    it('returns undefined when no issues found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                viewer: {
                  assignedIssues: {
                    nodes: [],
                  },
                },
              },
            }),
        }),
      );

      const env = {
        LINEAR_API_KEY: 'lin_key',
        LINEAR_TEAM_ID: 'team-1',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fetchIssue(env as any);
      expect(result).toBeUndefined();
    });

    it('returns undefined on API error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      const env = {
        LINEAR_API_KEY: 'lin_key',
        LINEAR_TEAM_ID: 'team-1',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fetchIssue(env as any);
      expect(result).toBeUndefined();
    });
  });

  describe('fetchReworkIssue', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns issue in rework state', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                viewer: {
                  assignedIssues: {
                    nodes: [
                      {
                        id: 'issue-id-2',
                        identifier: 'TEAM-55',
                        title: 'Rework the widget',
                        description: 'Needs changes',
                        state: { name: 'Rework' },
                        parent: { identifier: 'TEAM-10' },
                      },
                    ],
                  },
                },
              },
            }),
        }),
      );

      const env = {
        LINEAR_API_KEY: 'lin_key',
        LINEAR_TEAM_ID: 'team-1',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fetchReworkIssue(env as any, 'Rework');
      expect(result).toEqual({
        key: 'TEAM-55',
        title: 'Rework the widget',
        description: 'Needs changes',
        provider: 'linear',
        issueId: 'issue-id-2',
        parentIdentifier: 'TEAM-10',
      });
    });

    it('returns undefined when no issues found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                viewer: {
                  assignedIssues: {
                    nodes: [],
                  },
                },
              },
            }),
        }),
      );

      const env = {
        LINEAR_API_KEY: 'lin_key',
        LINEAR_TEAM_ID: 'team-1',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fetchReworkIssue(env as any, 'Rework');
      expect(result).toBeUndefined();
    });

    it('returns undefined on API error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      const env = {
        LINEAR_API_KEY: 'lin_key',
        LINEAR_TEAM_ID: 'team-1',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fetchReworkIssue(env as any, 'Rework');
      expect(result).toBeUndefined();
    });
  });

  describe('fetchComments', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns comment bodies', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                issue: {
                  comments: {
                    nodes: [
                      {
                        body: 'First comment',
                        createdAt: '2026-01-01T00:00:00Z',
                      },
                      {
                        body: 'Second comment',
                        createdAt: '2026-01-02T00:00:00Z',
                      },
                    ],
                  },
                },
              },
            }),
        }),
      );

      const result = await fetchComments('lin_key', 'issue-id-1');
      expect(result).toEqual(['First comment', 'Second comment']);
    });

    it('filters comments by since timestamp', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                issue: {
                  comments: {
                    nodes: [
                      {
                        body: 'Old comment',
                        createdAt: '2026-01-01T00:00:00Z',
                      },
                      {
                        body: 'New comment',
                        createdAt: '2026-01-03T00:00:00Z',
                      },
                    ],
                  },
                },
              },
            }),
        }),
      );

      const result = await fetchComments(
        'lin_key',
        'issue-id-1',
        '2026-01-02T00:00:00Z',
      );
      expect(result).toEqual(['New comment']);
    });

    it('returns empty array on API error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      const result = await fetchComments('lin_key', 'issue-id-1');
      expect(result).toEqual([]);
    });
  });
});
