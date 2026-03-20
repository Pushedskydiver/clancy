import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLabel,
  fetchBlockerStatus,
  fetchChildrenStatus,
  fetchLabels,
  fetchStories,
  fetchStory,
  fetchWorkflows,
  pingShortcut,
  resetLabelCache,
  resetWorkflowCache,
  resolveWorkflowStateId,
  resolveWorkflowStateIdsByType,
  transitionStory,
} from './shortcut.js';

describe('shortcut', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetWorkflowCache();
    resetLabelCache();
  });

  describe('pingShortcut', () => {
    it('returns ok true on successful response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({ id: 'member-uuid', mention_name: 'user' }),
        }),
      );

      const result = await pingShortcut('sc_token');
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

      const result = await pingShortcut('bad_token');
      expect(result).toEqual({
        ok: false,
        error: '✗ Shortcut auth failed — check SHORTCUT_API_TOKEN',
      });
    });

    it('returns error on 403', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 403,
        }),
      );

      const result = await pingShortcut('bad_token');
      expect(result).toEqual({
        ok: false,
        error: '✗ Shortcut auth failed — check SHORTCUT_API_TOKEN',
      });
    });

    it('returns error on network failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await pingShortcut('sc_token');
      expect(result).toEqual({
        ok: false,
        error: '✗ Could not reach Shortcut — check network',
      });
    });

    it('returns error on non-auth HTTP error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      const result = await pingShortcut('sc_token');
      expect(result).toEqual({
        ok: false,
        error: '✗ Shortcut API returned HTTP 500',
      });
    });
  });

  describe('fetchWorkflows', () => {
    it('returns workflows on success', async () => {
      const workflows = [
        {
          id: 1,
          name: 'Engineering',
          states: [
            { id: 100, name: 'Unstarted', type: 'unstarted' },
            { id: 101, name: 'In Progress', type: 'started' },
            { id: 102, name: 'Done', type: 'done' },
          ],
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(workflows),
        }),
      );

      const result = await fetchWorkflows('sc_token');
      expect(result).toEqual(workflows);
    });

    it('caches workflows across calls', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 1,
              name: 'Eng',
              states: [{ id: 100, name: 'Todo', type: 'unstarted' }],
            },
          ]),
      });
      vi.stubGlobal('fetch', mockFetch);

      await fetchWorkflows('sc_token');
      await fetchWorkflows('sc_token');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns empty array on failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      const result = await fetchWorkflows('sc_token');
      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await fetchWorkflows('sc_token');
      expect(result).toEqual([]);
    });
  });

  describe('resolveWorkflowStateId', () => {
    it('resolves state name to ID', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                name: 'Engineering',
                states: [
                  { id: 100, name: 'Unstarted', type: 'unstarted' },
                  { id: 101, name: 'In Progress', type: 'started' },
                ],
              },
            ]),
        }),
      );

      const result = await resolveWorkflowStateId('sc_token', 'In Progress');
      expect(result).toBe(101);
    });

    it('resolves case-insensitively', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                name: 'Eng',
                states: [{ id: 100, name: 'In Progress', type: 'started' }],
              },
            ]),
        }),
      );

      const result = await resolveWorkflowStateId('sc_token', 'in progress');
      expect(result).toBe(100);
    });

    it('scopes to workflow name when provided', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                name: 'Engineering',
                states: [{ id: 100, name: 'Done', type: 'done' }],
              },
              {
                id: 2,
                name: 'Design',
                states: [{ id: 200, name: 'Done', type: 'done' }],
              },
            ]),
        }),
      );

      const result = await resolveWorkflowStateId('sc_token', 'Done', 'Design');
      expect(result).toBe(200);
    });

    it('returns undefined when state not found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                name: 'Eng',
                states: [{ id: 100, name: 'Todo', type: 'unstarted' }],
              },
            ]),
        }),
      );

      const result = await resolveWorkflowStateId('sc_token', 'NonExistent');
      expect(result).toBeUndefined();
    });
  });

  describe('resolveWorkflowStateIdsByType', () => {
    it('returns all state IDs matching type', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                name: 'Eng',
                states: [
                  { id: 100, name: 'Backlog', type: 'unstarted' },
                  { id: 101, name: 'Ready', type: 'unstarted' },
                  { id: 102, name: 'In Progress', type: 'started' },
                ],
              },
            ]),
        }),
      );

      const result = await resolveWorkflowStateIdsByType(
        'sc_token',
        'unstarted',
      );
      expect(result).toEqual([100, 101]);
    });
  });

  describe('fetchStories', () => {
    it('returns stories on success', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  id: 42,
                  name: 'Fix the bug',
                  description: 'It is broken',
                  workflow_state_id: 100,
                  labels: [{ id: 1, name: 'backend' }],
                  epic_id: 5,
                },
              ],
            }),
        }),
      );

      const result = await fetchStories('sc_token', [100]);
      expect(result).toEqual([
        {
          key: 'sc-42',
          title: 'Fix the bug',
          description: 'It is broken',
          provider: 'shortcut',
          storyId: 42,
          epicId: 5,
          labels: ['backend'],
        },
      ]);
    });

    it('returns empty array when no matching state IDs', async () => {
      const result = await fetchStories('sc_token', []);
      expect(result).toEqual([]);
    });

    it('filters by workflow_state_id', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { id: 1, name: 'A', description: '', workflow_state_id: 100 },
              ],
            }),
        }),
      );

      const result = await fetchStories('sc_token', [100]);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('sc-1');
    });

    it('excludes HITL stories when excludeHitl is true', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  id: 1,
                  name: 'Normal',
                  description: '',
                  workflow_state_id: 100,
                  labels: [],
                },
                {
                  id: 2,
                  name: 'HITL',
                  description: '',
                  workflow_state_id: 100,
                  labels: [{ id: 99, name: 'clancy:hitl' }],
                },
              ],
            }),
        }),
      );

      const result = await fetchStories(
        'sc_token',
        [100],
        undefined,
        undefined,
        true,
      );
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('sc-1');
    });

    it('returns empty array on API error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      const result = await fetchStories('sc_token', [100]);
      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await fetchStories('sc_token', [100]);
      expect(result).toEqual([]);
    });

    it('returns empty array on invalid JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.reject(new Error('bad json')),
        }),
      );

      const result = await fetchStories('sc_token', [100]);
      expect(result).toEqual([]);
    });
  });

  describe('fetchStory', () => {
    it('returns story on success', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 42,
              name: 'Fix the bug',
              description: 'Broken',
              epic_id: 5,
              labels: [{ id: 1, name: 'backend' }],
            }),
        }),
      );

      const result = await fetchStory('sc_token', 42);
      expect(result).toEqual({
        key: 'sc-42',
        title: 'Fix the bug',
        description: 'Broken',
        provider: 'shortcut',
        storyId: 42,
        epicId: 5,
        labels: ['backend'],
      });
    });

    it('returns undefined on failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 404 }),
      );

      const result = await fetchStory('sc_token', 999);
      expect(result).toBeUndefined();
    });

    it('returns undefined on network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await fetchStory('sc_token', 42);
      expect(result).toBeUndefined();
    });
  });

  describe('fetchBlockerStatus', () => {
    it('returns false when story is not blocked', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 42,
              name: 'Story',
              blocked: false,
              story_links: [],
            }),
        }),
      );

      const result = await fetchBlockerStatus('sc_token', 42);
      expect(result).toBe(false);
    });

    it('returns false when blocked but no blocker links', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 42,
              name: 'Story',
              blocked: true,
              story_links: [],
            }),
        }),
      );

      const result = await fetchBlockerStatus('sc_token', 42);
      expect(result).toBe(false);
    });

    it('returns true when blocker is in non-done state', async () => {
      const mockFetch = vi
        .fn()
        // First call: fetch the story
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 42,
              name: 'Story',
              blocked: true,
              story_links: [
                { verb: 'is blocked by', subject_id: 42, object_id: 10 },
              ],
            }),
        })
        // Second call: fetch workflows
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                name: 'Eng',
                states: [
                  { id: 100, name: 'Todo', type: 'unstarted' },
                  { id: 102, name: 'Done', type: 'done' },
                ],
              },
            ]),
        })
        // Third call: fetch blocker story
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 10,
              name: 'Blocker',
              workflow_state_id: 100,
            }),
        });

      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchBlockerStatus('sc_token', 42);
      expect(result).toBe(true);
    });

    it('returns false when all blockers are done', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 42,
              name: 'Story',
              blocked: true,
              story_links: [
                { verb: 'is blocked by', subject_id: 42, object_id: 10 },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                name: 'Eng',
                states: [{ id: 102, name: 'Done', type: 'done' }],
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 10,
              name: 'Blocker',
              workflow_state_id: 102,
            }),
        });

      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchBlockerStatus('sc_token', 42);
      expect(result).toBe(false);
    });

    it('returns false (fail-open) on API failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      const result = await fetchBlockerStatus('sc_token', 42);
      expect(result).toBe(false);
    });

    it('returns false (fail-open) on network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await fetchBlockerStatus('sc_token', 42);
      expect(result).toBe(false);
    });
  });

  describe('fetchChildrenStatus', () => {
    it('returns counts from epic API fallback', async () => {
      const mockFetch = vi
        .fn()
        // Epic stories
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 1, name: 'A', workflow_state_id: 100 },
              { id: 2, name: 'B', workflow_state_id: 102 },
              { id: 3, name: 'C', workflow_state_id: 100 },
            ]),
        })
        // Workflows
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                name: 'Eng',
                states: [
                  { id: 100, name: 'Todo', type: 'unstarted' },
                  { id: 102, name: 'Done', type: 'done' },
                ],
              },
            ]),
        });

      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchChildrenStatus('sc_token', 5);
      expect(result).toEqual({ total: 3, incomplete: 2 });
    });

    it('tries text search first when parentKey provided', async () => {
      const mockFetch = vi
        .fn()
        // Text search: POST /stories/search
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { id: 1, name: 'A', workflow_state_id: 100 },
                { id: 2, name: 'B', workflow_state_id: 102 },
              ],
            }),
        })
        // Workflows for text search result
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                name: 'Eng',
                states: [
                  { id: 100, name: 'Todo', type: 'unstarted' },
                  { id: 102, name: 'Done', type: 'done' },
                ],
              },
            ]),
        });

      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchChildrenStatus('sc_token', 5, 'sc-99');
      expect(result).toEqual({ total: 2, incomplete: 1 });
    });

    it('falls back to epic API when text search returns 0', async () => {
      const mockFetch = vi
        .fn()
        // Text search returns empty
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        // Epic stories fallback
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([{ id: 1, name: 'A', workflow_state_id: 102 }]),
        })
        // Workflows
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                name: 'Eng',
                states: [{ id: 102, name: 'Done', type: 'done' }],
              },
            ]),
        });

      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchChildrenStatus('sc_token', 5, 'sc-99');
      expect(result).toEqual({ total: 1, incomplete: 0 });
    });

    it('returns undefined on API failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      const result = await fetchChildrenStatus('sc_token', 5);
      expect(result).toBeUndefined();
    });
  });

  describe('transitionStory', () => {
    it('returns true on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      const result = await transitionStory('sc_token', 42, 101);
      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 400 }),
      );

      const result = await transitionStory('sc_token', 42, 101);
      expect(result).toBe(false);
    });

    it('returns false on network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await transitionStory('sc_token', 42, 101);
      expect(result).toBe(false);
    });
  });

  describe('fetchLabels', () => {
    it('returns labels on success', async () => {
      const labels = [
        { id: 1, name: 'backend' },
        { id: 2, name: 'frontend' },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(labels),
        }),
      );

      const result = await fetchLabels('sc_token');
      expect(result).toEqual(labels);
    });

    it('caches labels across calls', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ id: 1, name: 'test' }]),
      });
      vi.stubGlobal('fetch', mockFetch);

      await fetchLabels('sc_token');
      await fetchLabels('sc_token');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns empty array on failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      const result = await fetchLabels('sc_token');
      expect(result).toEqual([]);
    });
  });

  describe('createLabel', () => {
    it('returns label ID on success', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ id: 42, name: 'clancy:build' }),
        }),
      );

      const result = await createLabel('sc_token', 'clancy:build');
      expect(result).toBe(42);
    });

    it('returns undefined on failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 422 }),
      );

      const result = await createLabel('sc_token', 'clancy:build');
      expect(result).toBeUndefined();
    });

    it('returns undefined on network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await createLabel('sc_token', 'clancy:build');
      expect(result).toBeUndefined();
    });
  });
});
