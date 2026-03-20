import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AzdoEnv } from '~/schemas/env.js';
import type { FetchedTicket } from '~/types/board.js';

import { createAzdoBoard } from './azdo-board.js';

// Mock the underlying Azure DevOps functions
vi.mock('./azdo.js', () => ({
  pingAzdo: vi.fn(() => Promise.resolve({ ok: true })),
  fetchTickets: vi.fn(() => Promise.resolve([])),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
  fetchChildrenStatus: vi.fn(() =>
    Promise.resolve({ total: 4, incomplete: 2 }),
  ),
  updateWorkItem: vi.fn(() => Promise.resolve(true)),
  fetchWorkItem: vi.fn(() =>
    Promise.resolve({
      id: 42,
      fields: { 'System.Tags': 'tag1; tag2' },
      relations: null,
    }),
  ),
  isSafeWiqlValue: vi.fn(() => true),
  parseTags: vi.fn((tags: string | null | undefined) => {
    if (!tags) return [];
    return tags
      .split(';')
      .map((t: string) => t.trim())
      .filter(Boolean);
  }),
  buildTagsString: vi.fn((tags: string[]) => tags.join('; ')),
  buildAzdoAuth: vi.fn(() => 'Basic dGVzdA=='),
  extractIdFromRelationUrl: vi.fn(),
  runWiql: vi.fn(() => Promise.resolve([])),
  fetchWorkItems: vi.fn(() => Promise.resolve([])),
  workItemToTicket: vi.fn(),
}));

const baseEnv: AzdoEnv = {
  AZDO_ORG: 'myorg',
  AZDO_PROJECT: 'MyProject',
  AZDO_PAT: 'test-pat',
};

describe('azdo-board', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe('createAzdoBoard', () => {
    it('returns an object with all Board methods', () => {
      const board = createAzdoBoard(baseEnv);

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
    it('delegates to pingAzdo with correct params', async () => {
      const { pingAzdo } = await import('./azdo.js');
      const board = createAzdoBoard(baseEnv);

      await board.ping();

      expect(pingAzdo).toHaveBeenCalledWith('myorg', 'MyProject', 'test-pat');
    });
  });

  describe('validateInputs', () => {
    it('returns undefined for valid inputs', () => {
      const board = createAzdoBoard(baseEnv);
      expect(board.validateInputs()).toBeUndefined();
    });

    it('returns error when AZDO_ORG is empty', () => {
      const board = createAzdoBoard({ ...baseEnv, AZDO_ORG: '  ' });
      expect(board.validateInputs()).toContain('AZDO_ORG');
    });

    it('returns error when AZDO_PROJECT is empty', () => {
      const board = createAzdoBoard({ ...baseEnv, AZDO_PROJECT: '  ' });
      expect(board.validateInputs()).toContain('AZDO_PROJECT');
    });

    it('returns error when AZDO_PAT is empty', () => {
      const board = createAzdoBoard({ ...baseEnv, AZDO_PAT: '  ' });
      expect(board.validateInputs()).toContain('AZDO_PAT');
    });

    it('returns error when AZDO_PROJECT has unsafe WIQL chars', async () => {
      const { isSafeWiqlValue } = await import('./azdo.js');
      vi.mocked(isSafeWiqlValue).mockReturnValueOnce(false);

      const board = createAzdoBoard({
        ...baseEnv,
        AZDO_PROJECT: "test'injection",
      });
      expect(board.validateInputs()).toContain('AZDO_PROJECT');
    });

    it('returns error when CLANCY_AZDO_STATUS has unsafe WIQL chars', async () => {
      const { isSafeWiqlValue } = await import('./azdo.js');
      vi.mocked(isSafeWiqlValue)
        .mockReturnValueOnce(true) // project check passes
        .mockReturnValueOnce(false); // status check fails

      const board = createAzdoBoard({
        ...baseEnv,
        CLANCY_AZDO_STATUS: "bad'status",
      });
      expect(board.validateInputs()).toContain('CLANCY_AZDO_STATUS');
    });

    it('returns error when CLANCY_AZDO_WIT has unsafe WIQL chars', async () => {
      const { isSafeWiqlValue } = await import('./azdo.js');
      vi.mocked(isSafeWiqlValue)
        .mockReturnValueOnce(true) // project check passes
        .mockReturnValueOnce(true) // status check passes
        .mockReturnValueOnce(false); // wit check fails

      const board = createAzdoBoard({
        ...baseEnv,
        CLANCY_AZDO_WIT: "bad'wit",
      });
      expect(board.validateInputs()).toContain('CLANCY_AZDO_WIT');
    });
  });

  describe('fetchTickets', () => {
    it('delegates to fetchAzdoTickets and normalises results', async () => {
      const { fetchTickets } = await import('./azdo.js');
      vi.mocked(fetchTickets).mockResolvedValueOnce([
        {
          key: 'azdo-42',
          title: 'Test item',
          description: 'Desc',
          provider: 'azdo',
          workItemId: 42,
          parentId: 10,
          labels: ['tag1'],
        },
      ]);

      const board = createAzdoBoard(baseEnv);
      const tickets = await board.fetchTickets({});

      expect(tickets).toHaveLength(1);
      expect(tickets[0].key).toBe('azdo-42');
      expect(tickets[0].parentInfo).toBe('azdo-10');
      expect(tickets[0].issueId).toBe('42');
      expect(tickets[0].labels).toEqual(['tag1']);
    });

    it('sets parentInfo to none when no parent', async () => {
      const { fetchTickets } = await import('./azdo.js');
      vi.mocked(fetchTickets).mockResolvedValueOnce([
        {
          key: 'azdo-42',
          title: 'Test',
          description: '',
          provider: 'azdo',
          workItemId: 42,
          labels: [],
        },
      ]);

      const board = createAzdoBoard(baseEnv);
      const tickets = await board.fetchTickets({});

      expect(tickets[0].parentInfo).toBe('none');
    });

    it('passes excludeHitl option', async () => {
      const { fetchTickets } = await import('./azdo.js');
      vi.mocked(fetchTickets).mockResolvedValueOnce([]);

      const board = createAzdoBoard(baseEnv);
      await board.fetchTickets({ excludeHitl: true });

      expect(fetchTickets).toHaveBeenCalledWith(
        'myorg',
        'MyProject',
        'test-pat',
        'New',
        undefined,
        true,
      );
    });

    it('uses custom status from CLANCY_AZDO_STATUS', async () => {
      const { fetchTickets } = await import('./azdo.js');
      vi.mocked(fetchTickets).mockResolvedValueOnce([]);

      const board = createAzdoBoard({
        ...baseEnv,
        CLANCY_AZDO_STATUS: 'Active',
      });
      await board.fetchTickets({});

      expect(fetchTickets).toHaveBeenCalledWith(
        'myorg',
        'MyProject',
        'test-pat',
        'Active',
        undefined,
        undefined,
      );
    });

    it('passes CLANCY_AZDO_WIT to fetchTickets', async () => {
      const { fetchTickets } = await import('./azdo.js');
      vi.mocked(fetchTickets).mockResolvedValueOnce([]);

      const board = createAzdoBoard({
        ...baseEnv,
        CLANCY_AZDO_WIT: 'User Story',
      });
      await board.fetchTickets({});

      expect(fetchTickets).toHaveBeenCalledWith(
        'myorg',
        'MyProject',
        'test-pat',
        'New',
        'User Story',
        undefined,
      );
    });
  });

  describe('fetchTicket', () => {
    it('returns the first ticket from fetchTickets', async () => {
      const { fetchTickets } = await import('./azdo.js');
      vi.mocked(fetchTickets).mockResolvedValueOnce([
        {
          key: 'azdo-1',
          title: 'First',
          description: '',
          provider: 'azdo',
          workItemId: 1,
          labels: [],
        },
        {
          key: 'azdo-2',
          title: 'Second',
          description: '',
          provider: 'azdo',
          workItemId: 2,
          labels: [],
        },
      ]);

      const board = createAzdoBoard(baseEnv);
      const ticket = await board.fetchTicket({});

      expect(ticket).toBeDefined();
      expect(ticket!.key).toBe('azdo-1');
    });

    it('returns undefined when no tickets', async () => {
      const { fetchTickets } = await import('./azdo.js');
      vi.mocked(fetchTickets).mockResolvedValueOnce([]);

      const board = createAzdoBoard(baseEnv);
      const ticket = await board.fetchTicket({});

      expect(ticket).toBeUndefined();
    });
  });

  describe('fetchBlockerStatus', () => {
    it('delegates to fetchAzdoBlockerStatus', async () => {
      const { fetchBlockerStatus } = await import('./azdo.js');
      vi.mocked(fetchBlockerStatus).mockResolvedValueOnce(true);

      const board = createAzdoBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'azdo-42',
        title: 'Test',
        description: '',
        parentInfo: 'none',
        blockers: 'None',
      };

      const blocked = await board.fetchBlockerStatus(ticket);
      expect(blocked).toBe(true);
      expect(fetchBlockerStatus).toHaveBeenCalledWith(
        'myorg',
        'MyProject',
        'test-pat',
        42,
      );
    });

    it('returns false for invalid key', async () => {
      const board = createAzdoBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'invalid',
        title: 'Test',
        description: '',
        parentInfo: 'none',
        blockers: 'None',
      };

      const blocked = await board.fetchBlockerStatus(ticket);
      expect(blocked).toBe(false);
    });
  });

  describe('fetchChildrenStatus', () => {
    it('delegates to fetchAzdoChildrenStatus', async () => {
      const { fetchChildrenStatus } = await import('./azdo.js');

      const board = createAzdoBoard(baseEnv);
      const result = await board.fetchChildrenStatus('azdo-50', '50');

      expect(result).toEqual({ total: 4, incomplete: 2 });
      expect(fetchChildrenStatus).toHaveBeenCalledWith(
        'myorg',
        'MyProject',
        'test-pat',
        50,
        'azdo-50',
      );
    });

    it('returns undefined for invalid parentId', async () => {
      const board = createAzdoBoard(baseEnv);
      const result = await board.fetchChildrenStatus('azdo-50', 'invalid');

      expect(result).toBeUndefined();
    });

    it('returns undefined when parentKey has no numeric ID', async () => {
      const board = createAzdoBoard(baseEnv);
      const result = await board.fetchChildrenStatus('azdo-invalid');

      expect(result).toBeUndefined();
    });
  });

  describe('transitionTicket', () => {
    it('updates System.State via JSON Patch', async () => {
      const { updateWorkItem } = await import('./azdo.js');

      const board = createAzdoBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'azdo-42',
        title: 'Test',
        description: '',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.transitionTicket(ticket, 'Active');
      expect(result).toBe(true);
      expect(updateWorkItem).toHaveBeenCalledWith(
        'myorg',
        'MyProject',
        'test-pat',
        42,
        [{ op: 'replace', path: '/fields/System.State', value: 'Active' }],
      );
    });

    it('returns false for invalid key', async () => {
      const board = createAzdoBoard(baseEnv);
      const ticket: FetchedTicket = {
        key: 'invalid',
        title: 'Test',
        description: '',
        parentInfo: 'none',
        blockers: 'None',
      };

      const result = await board.transitionTicket(ticket, 'Active');
      expect(result).toBe(false);
    });
  });

  describe('ensureLabel', () => {
    it('is a no-op (Azure DevOps tags auto-create)', async () => {
      const board = createAzdoBoard(baseEnv);
      await expect(board.ensureLabel('test-label')).resolves.toBeUndefined();
    });
  });

  describe('addLabel', () => {
    it('appends tag via JSON Patch', async () => {
      const { fetchWorkItem, updateWorkItem } = await import('./azdo.js');
      vi.mocked(fetchWorkItem).mockResolvedValueOnce({
        id: 42,
        fields: { 'System.Tags': 'existing' },
        relations: null,
      });

      const board = createAzdoBoard(baseEnv);
      await board.addLabel('azdo-42', 'new-tag');

      expect(updateWorkItem).toHaveBeenCalledWith(
        'myorg',
        'MyProject',
        'test-pat',
        42,
        [
          {
            op: 'replace',
            path: '/fields/System.Tags',
            value: 'existing; new-tag',
          },
        ],
      );
    });

    it('does not duplicate existing tag', async () => {
      const { fetchWorkItem, updateWorkItem } = await import('./azdo.js');
      vi.mocked(fetchWorkItem).mockResolvedValueOnce({
        id: 42,
        fields: { 'System.Tags': 'existing' },
        relations: null,
      });

      const board = createAzdoBoard(baseEnv);
      await board.addLabel('azdo-42', 'existing');

      expect(updateWorkItem).not.toHaveBeenCalled();
    });

    it('handles invalid key gracefully', async () => {
      const { updateWorkItem } = await import('./azdo.js');

      const board = createAzdoBoard(baseEnv);
      await board.addLabel('invalid', 'tag');

      expect(updateWorkItem).not.toHaveBeenCalled();
    });
  });

  describe('removeLabel', () => {
    it('removes tag via JSON Patch', async () => {
      const { fetchWorkItem, updateWorkItem } = await import('./azdo.js');
      vi.mocked(fetchWorkItem).mockResolvedValueOnce({
        id: 42,
        fields: { 'System.Tags': 'keep; remove-me; also-keep' },
        relations: null,
      });

      const board = createAzdoBoard(baseEnv);
      await board.removeLabel('azdo-42', 'remove-me');

      expect(updateWorkItem).toHaveBeenCalledWith(
        'myorg',
        'MyProject',
        'test-pat',
        42,
        [
          {
            op: 'replace',
            path: '/fields/System.Tags',
            value: 'keep; also-keep',
          },
        ],
      );
    });

    it('does nothing when tag not present', async () => {
      const { fetchWorkItem, updateWorkItem } = await import('./azdo.js');
      vi.mocked(fetchWorkItem).mockResolvedValueOnce({
        id: 42,
        fields: { 'System.Tags': 'tag1; tag2' },
        relations: null,
      });

      const board = createAzdoBoard(baseEnv);
      await board.removeLabel('azdo-42', 'nonexistent');

      expect(updateWorkItem).not.toHaveBeenCalled();
    });
  });

  describe('sharedEnv', () => {
    it('returns the env object', () => {
      const board = createAzdoBoard(baseEnv);
      expect(board.sharedEnv()).toBe(baseEnv);
    });
  });
});
