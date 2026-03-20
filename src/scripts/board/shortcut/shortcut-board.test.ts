import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ShortcutEnv } from '~/schemas/env.js';
import type { FetchedTicket } from '~/scripts/once/types/types.js';

import { createShortcutBoard } from './shortcut-board.js';

// Mock the underlying Shortcut functions
vi.mock('./shortcut.js', () => ({
  pingShortcut: vi.fn(() => Promise.resolve({ ok: true })),
  fetchStories: vi.fn(() => Promise.resolve([])),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
  fetchChildrenStatus: vi.fn(() =>
    Promise.resolve({ total: 4, incomplete: 2 }),
  ),
  transitionStory: vi.fn(() => Promise.resolve(true)),
  resolveWorkflowStateId: vi.fn(() => Promise.resolve(101)),
  resolveWorkflowStateIdsByType: vi.fn(() => Promise.resolve([100, 101])),
  fetchLabels: vi.fn(() => Promise.resolve([])),
  createLabel: vi.fn(() => Promise.resolve(42)),
  getStoryLabelIds: vi.fn(() => Promise.resolve([1, 2])),
  updateStoryLabelIds: vi.fn(() => Promise.resolve(true)),
  fetchWorkflows: vi.fn(() => Promise.resolve([])),
  resetWorkflowCache: vi.fn(),
  resetLabelCache: vi.fn(),
}));

const baseEnv: ShortcutEnv = {
  SHORTCUT_API_TOKEN: 'sc_test_token',
};

describe('shortcut-board', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe('createShortcutBoard', () => {
    it('returns an object with all Board methods', () => {
      const board = createShortcutBoard(baseEnv);

      expect(typeof board.ping).toBe('function');
      expect(typeof board.validateInputs).toBe('function');
      expect(typeof board.fetchTicket).toBe('function');
      expect(typeof board.fetchTickets).toBe('function');
      expect(typeof board.fetchBlockerStatus).toBe('function');
      expect(typeof board.fetchChildrenStatus).toBe('function');
      expect(typeof board.transitionTicket).toBe('function');
      expect(typeof board.ensureLabel).toBe('function');
      expect(typeof board.addLabel).toBe('function');
      expect(typeof board.removeLabel).toBe('function');
      expect(typeof board.sharedEnv).toBe('function');
    });
  });

  describe('ping', () => {
    it('delegates to pingShortcut with correct params', async () => {
      const { pingShortcut } = await import('./shortcut.js');
      const board = createShortcutBoard(baseEnv);

      await board.ping();

      expect(pingShortcut).toHaveBeenCalledWith('sc_test_token');
    });
  });

  describe('validateInputs', () => {
    it('returns undefined (no structural validation for Shortcut tokens)', () => {
      const board = createShortcutBoard(baseEnv);
      expect(board.validateInputs()).toBeUndefined();
    });
  });

  describe('fetchTickets', () => {
    it('delegates to fetchShortcutStories and normalises results', async () => {
      const { fetchStories } = await import('./shortcut.js');
      vi.mocked(fetchStories).mockResolvedValueOnce([
        {
          key: 'sc-42',
          title: 'Test story',
          description: 'A test story',
          provider: 'shortcut',
          storyId: 42,
          epicId: 5,
          labels: ['backend'],
        },
      ]);

      const board = createShortcutBoard(baseEnv);
      const results = await board.fetchTickets({ excludeHitl: false });

      expect(results).toEqual([
        {
          key: 'sc-42',
          title: 'Test story',
          description: 'A test story',
          parentInfo: 'epic-5',
          blockers: 'None',
          issueId: '42',
          labels: ['backend'],
        },
      ]);
    });

    it('sets parentInfo to none when no epic', async () => {
      const { fetchStories } = await import('./shortcut.js');
      vi.mocked(fetchStories).mockResolvedValueOnce([
        {
          key: 'sc-43',
          title: 'No epic',
          description: 'desc',
          provider: 'shortcut',
          storyId: 43,
        },
      ]);

      const board = createShortcutBoard(baseEnv);
      const results = await board.fetchTickets({ excludeHitl: false });

      expect(results[0].parentInfo).toBe('none');
    });

    it('passes excludeHitl to fetchStories', async () => {
      const { fetchStories } = await import('./shortcut.js');
      vi.mocked(fetchStories).mockResolvedValueOnce([]);

      const board = createShortcutBoard(baseEnv);
      await board.fetchTickets({ excludeHitl: true });

      expect(fetchStories).toHaveBeenCalledWith(
        'sc_test_token',
        [100, 101],
        undefined,
        undefined,
        true,
      );
    });
  });

  describe('fetchTicket', () => {
    it('returns the first ticket from fetchTickets', async () => {
      const { fetchStories } = await import('./shortcut.js');
      vi.mocked(fetchStories).mockResolvedValueOnce([
        {
          key: 'sc-1',
          title: 'First',
          description: 'desc',
          provider: 'shortcut',
          storyId: 1,
        },
      ]);

      const board = createShortcutBoard(baseEnv);
      const result = await board.fetchTicket({ excludeHitl: false });

      expect(result?.key).toBe('sc-1');
    });

    it('returns undefined when no stories', async () => {
      const { fetchStories } = await import('./shortcut.js');
      vi.mocked(fetchStories).mockResolvedValueOnce([]);

      const board = createShortcutBoard(baseEnv);
      const result = await board.fetchTicket({ excludeHitl: false });

      expect(result).toBeUndefined();
    });
  });

  describe('fetchBlockerStatus', () => {
    it('delegates to fetchShortcutBlockerStatus', async () => {
      const { fetchBlockerStatus } = await import('./shortcut.js');
      vi.mocked(fetchBlockerStatus).mockResolvedValueOnce(true);

      const board = createShortcutBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'sc-42',
        title: 'Test',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
        issueId: '42',
      };

      const result = await board.fetchBlockerStatus(ticket);

      expect(fetchBlockerStatus).toHaveBeenCalledWith('sc_test_token', 42);
      expect(result).toBe(true);
    });

    it('returns false when key cannot be parsed', async () => {
      const board = createShortcutBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'invalid',
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
    it('delegates to fetchShortcutChildrenStatus with epicId', async () => {
      const { fetchChildrenStatus } = await import('./shortcut.js');

      const board = createShortcutBoard(baseEnv);
      const result = await board.fetchChildrenStatus('sc-99', '5');

      expect(fetchChildrenStatus).toHaveBeenCalledWith(
        'sc_test_token',
        5,
        'sc-99',
      );
      expect(result).toEqual({ total: 4, incomplete: 2 });
    });

    it('returns undefined when no parentId provided', async () => {
      const board = createShortcutBoard(baseEnv);
      const result = await board.fetchChildrenStatus('sc-99');

      expect(result).toBeUndefined();
    });

    it('returns undefined when parentId is not numeric', async () => {
      const board = createShortcutBoard(baseEnv);
      const result = await board.fetchChildrenStatus('sc-99', 'not-a-number');

      expect(result).toBeUndefined();
    });
  });

  describe('transitionTicket', () => {
    it('delegates to transitionStory via resolveWorkflowStateId', async () => {
      const { transitionStory, resolveWorkflowStateId } =
        await import('./shortcut.js');
      vi.mocked(resolveWorkflowStateId).mockResolvedValueOnce(101);
      vi.mocked(transitionStory).mockResolvedValueOnce(true);

      const board = createShortcutBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'sc-42',
        title: 'Test',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.transitionTicket(ticket, 'In Progress');

      expect(resolveWorkflowStateId).toHaveBeenCalledWith(
        'sc_test_token',
        'In Progress',
        undefined,
      );
      expect(transitionStory).toHaveBeenCalledWith('sc_test_token', 42, 101);
      expect(result).toBe(true);
    });

    it('returns false when state name not found', async () => {
      const { resolveWorkflowStateId } = await import('./shortcut.js');
      vi.mocked(resolveWorkflowStateId).mockResolvedValueOnce(undefined);

      const board = createShortcutBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'sc-42',
        title: 'Test',
        description: 'desc',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.transitionTicket(ticket, 'NonExistent');
      expect(result).toBe(false);
    });

    it('returns false when key cannot be parsed', async () => {
      const board = createShortcutBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'invalid',
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
    it('does nothing when label exists', async () => {
      const { fetchLabels, createLabel } = await import('./shortcut.js');
      vi.mocked(fetchLabels).mockResolvedValueOnce([
        { id: 1, name: 'clancy:build' },
      ]);

      const board = createShortcutBoard(baseEnv);
      await board.ensureLabel('clancy:build');

      expect(createLabel).not.toHaveBeenCalled();
    });

    it('creates label when not found', async () => {
      const { fetchLabels, createLabel } = await import('./shortcut.js');
      vi.mocked(fetchLabels).mockResolvedValueOnce([]);
      vi.mocked(createLabel).mockResolvedValueOnce(42);

      const board = createShortcutBoard(baseEnv);
      await board.ensureLabel('clancy:build');

      expect(createLabel).toHaveBeenCalledWith('sc_test_token', 'clancy:build');
    });

    it('does not throw on API failure', async () => {
      const { fetchLabels } = await import('./shortcut.js');
      vi.mocked(fetchLabels).mockRejectedValueOnce(new Error('network'));

      const board = createShortcutBoard(baseEnv);
      await expect(board.ensureLabel('clancy:build')).resolves.toBeUndefined();
    });
  });

  describe('addLabel', () => {
    it('fetches story, appends label_id, and updates', async () => {
      const { fetchLabels, getStoryLabelIds, updateStoryLabelIds } =
        await import('./shortcut.js');
      vi.mocked(fetchLabels)
        // ensureLabel call
        .mockResolvedValueOnce([{ id: 42, name: 'clancy:build' }])
        // addLabel's fetchLabels call
        .mockResolvedValueOnce([{ id: 42, name: 'clancy:build' }]);
      vi.mocked(getStoryLabelIds).mockResolvedValueOnce([1, 2]);
      vi.mocked(updateStoryLabelIds).mockResolvedValueOnce(true);

      const board = createShortcutBoard(baseEnv);
      await board.addLabel('sc-42', 'clancy:build');

      expect(getStoryLabelIds).toHaveBeenCalledWith('sc_test_token', 42);
      expect(updateStoryLabelIds).toHaveBeenCalledWith(
        'sc_test_token',
        42,
        [1, 2, 42],
      );
    });

    it('skips update when label already on story', async () => {
      const { fetchLabels, getStoryLabelIds, updateStoryLabelIds } =
        await import('./shortcut.js');
      vi.mocked(fetchLabels)
        .mockResolvedValueOnce([{ id: 42, name: 'clancy:build' }])
        .mockResolvedValueOnce([{ id: 42, name: 'clancy:build' }]);
      vi.mocked(getStoryLabelIds).mockResolvedValueOnce([42]);

      const board = createShortcutBoard(baseEnv);
      await board.addLabel('sc-42', 'clancy:build');

      expect(getStoryLabelIds).toHaveBeenCalledWith('sc_test_token', 42);
      expect(updateStoryLabelIds).not.toHaveBeenCalled();
    });

    it('does not throw on API failure', async () => {
      const { fetchLabels } = await import('./shortcut.js');
      vi.mocked(fetchLabels).mockRejectedValueOnce(new Error('network'));

      const board = createShortcutBoard(baseEnv);
      await expect(
        board.addLabel('sc-42', 'clancy:build'),
      ).resolves.toBeUndefined();
    });
  });

  describe('removeLabel', () => {
    it('fetches story and updates with label removed', async () => {
      const { fetchLabels, getStoryLabelIds, updateStoryLabelIds } =
        await import('./shortcut.js');
      vi.mocked(fetchLabels).mockResolvedValueOnce([
        { id: 42, name: 'clancy:build' },
      ]);
      vi.mocked(getStoryLabelIds).mockResolvedValueOnce([42, 99]);
      vi.mocked(updateStoryLabelIds).mockResolvedValueOnce(true);

      const board = createShortcutBoard(baseEnv);
      await board.removeLabel('sc-42', 'clancy:build');

      expect(getStoryLabelIds).toHaveBeenCalledWith('sc_test_token', 42);
      expect(updateStoryLabelIds).toHaveBeenCalledWith(
        'sc_test_token',
        42,
        [99],
      );
    });

    it('skips update when label not on story', async () => {
      const { fetchLabels, getStoryLabelIds, updateStoryLabelIds } =
        await import('./shortcut.js');
      vi.mocked(fetchLabels).mockResolvedValueOnce([
        { id: 42, name: 'clancy:build' },
      ]);
      vi.mocked(getStoryLabelIds).mockResolvedValueOnce([99]);

      const board = createShortcutBoard(baseEnv);
      await board.removeLabel('sc-42', 'clancy:build');

      expect(getStoryLabelIds).toHaveBeenCalledWith('sc_test_token', 42);
      expect(updateStoryLabelIds).not.toHaveBeenCalled();
    });

    it('does not throw on API failure', async () => {
      const { fetchLabels } = await import('./shortcut.js');
      vi.mocked(fetchLabels).mockRejectedValueOnce(new Error('network'));

      const board = createShortcutBoard(baseEnv);
      await expect(
        board.removeLabel('sc-42', 'clancy:build'),
      ).resolves.toBeUndefined();
    });
  });

  describe('sharedEnv', () => {
    it('returns the env object', () => {
      const board = createShortcutBoard(baseEnv);
      expect(board.sharedEnv()).toBe(baseEnv);
    });
  });
});
