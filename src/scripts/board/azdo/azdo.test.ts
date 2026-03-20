import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAzdoAuth,
  buildTagsString,
  extractIdFromRelationUrl,
  fetchBlockerStatus,
  fetchChildrenStatus,
  fetchTickets,
  fetchWorkItem,
  fetchWorkItems,
  isSafeWiqlValue,
  parseTags,
  pingAzdo,
  runWiql,
  updateWorkItem,
  workItemToTicket,
} from './azdo.js';

describe('azdo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── buildAzdoAuth ──────────────────────────────────────────────────────────

  describe('buildAzdoAuth', () => {
    it('returns Basic auth with base64-encoded :pat', () => {
      const result = buildAzdoAuth('my-pat');
      // btoa(':my-pat') = 'Om15LXBhdA=='
      expect(result).toBe(`Basic ${btoa(':my-pat')}`);
    });

    it('includes colon before PAT', () => {
      const result = buildAzdoAuth('test');
      const decoded = atob(result.replace('Basic ', ''));
      expect(decoded).toBe(':test');
    });
  });

  // ─── isSafeWiqlValue ───────────────────────────────────────────────────────

  describe('isSafeWiqlValue', () => {
    it('accepts normal project names', () => {
      expect(isSafeWiqlValue('MyProject')).toBe(true);
      expect(isSafeWiqlValue('my-project')).toBe(true);
      expect(isSafeWiqlValue('Project 123')).toBe(true);
    });

    it('blocks single quotes', () => {
      expect(isSafeWiqlValue("test'injection")).toBe(false);
    });

    it('blocks SQL comments', () => {
      expect(isSafeWiqlValue('test--comment')).toBe(false);
    });

    it('blocks semicolons', () => {
      expect(isSafeWiqlValue('test;DROP')).toBe(false);
    });

    it('blocks block comments', () => {
      expect(isSafeWiqlValue('test/*comment*/')).toBe(false);
    });

    it('blocks non-printable characters', () => {
      expect(isSafeWiqlValue('test\x00value')).toBe(false);
      expect(isSafeWiqlValue('test\x01value')).toBe(false);
    });

    it('allows tabs and newlines', () => {
      expect(isSafeWiqlValue('test\tvalue')).toBe(true);
      expect(isSafeWiqlValue('test\nvalue')).toBe(true);
    });
  });

  // ─── parseTags / buildTagsString ────────────────────────────────────────────

  describe('parseTags', () => {
    it('parses semicolon-separated tags', () => {
      expect(parseTags('tag1; tag2; tag3')).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('handles null/undefined', () => {
      expect(parseTags(null)).toEqual([]);
      expect(parseTags(undefined)).toEqual([]);
    });

    it('handles empty string', () => {
      expect(parseTags('')).toEqual([]);
    });

    it('trims whitespace', () => {
      expect(parseTags('  tag1  ;  tag2  ')).toEqual(['tag1', 'tag2']);
    });

    it('filters empty entries', () => {
      expect(parseTags('tag1;;tag2')).toEqual(['tag1', 'tag2']);
    });
  });

  describe('buildTagsString', () => {
    it('joins tags with semicolons', () => {
      expect(buildTagsString(['tag1', 'tag2', 'tag3'])).toBe(
        'tag1; tag2; tag3',
      );
    });

    it('handles single tag', () => {
      expect(buildTagsString(['tag1'])).toBe('tag1');
    });

    it('handles empty array', () => {
      expect(buildTagsString([])).toBe('');
    });
  });

  // ─── extractIdFromRelationUrl ───────────────────────────────────────────────

  describe('extractIdFromRelationUrl', () => {
    it('extracts ID from standard relation URL', () => {
      expect(
        extractIdFromRelationUrl(
          'https://dev.azure.com/myorg/_apis/wit/workItems/42',
        ),
      ).toBe(42);
    });

    it('returns undefined for invalid URL', () => {
      expect(extractIdFromRelationUrl('https://example.com/no-id')).toBe(
        undefined,
      );
    });

    it('handles case-insensitive match', () => {
      expect(
        extractIdFromRelationUrl(
          'https://dev.azure.com/myorg/_apis/wit/WorkItems/99',
        ),
      ).toBe(99);
    });
  });

  // ─── workItemToTicket ──────────────────────────────────────────────────────

  describe('workItemToTicket', () => {
    it('converts a work item to AzdoTicket', () => {
      const item = {
        id: 42,
        fields: {
          'System.Title': 'Test item',
          'System.Description': 'Description here',
          'System.State': 'New',
          'System.Tags': 'tag1; tag2',
        },
        relations: null,
      };

      const ticket = workItemToTicket(item);
      expect(ticket.key).toBe('azdo-42');
      expect(ticket.title).toBe('Test item');
      expect(ticket.description).toBe('Description here');
      expect(ticket.provider).toBe('azdo');
      expect(ticket.workItemId).toBe(42);
      expect(ticket.labels).toEqual(['tag1', 'tag2']);
      expect(ticket.parentId).toBeUndefined();
    });

    it('extracts parent from hierarchy-reverse relation', () => {
      const item = {
        id: 50,
        fields: {
          'System.Title': 'Child item',
        },
        relations: [
          {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: 'https://dev.azure.com/org/_apis/wit/workItems/10',
          },
        ],
      };

      const ticket = workItemToTicket(item);
      expect(ticket.parentId).toBe(10);
    });

    it('handles missing fields gracefully', () => {
      const item = {
        id: 1,
        fields: {},
        relations: null,
      };

      const ticket = workItemToTicket(item);
      expect(ticket.title).toBe('');
      expect(ticket.description).toBe('');
      expect(ticket.labels).toEqual([]);
    });
  });

  // ─── pingAzdo ──────────────────────────────────────────────────────────────

  describe('pingAzdo', () => {
    it('returns ok true on successful response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'proj-uuid',
              name: 'MyProject',
              state: 'wellFormed',
            }),
        }),
      );

      const result = await pingAzdo('myorg', 'MyProject', 'pat');
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

      const result = await pingAzdo('myorg', 'MyProject', 'bad-pat');
      expect(result).toEqual({
        ok: false,
        error: '✗ Azure DevOps auth failed — check AZDO_PAT',
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

      const result = await pingAzdo('myorg', 'MyProject', 'bad-pat');
      expect(result).toEqual({
        ok: false,
        error: '✗ Azure DevOps auth failed — check AZDO_PAT',
      });
    });

    it('returns error on network failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await pingAzdo('myorg', 'MyProject', 'pat');
      expect(result).toEqual({
        ok: false,
        error: '✗ Could not reach Azure DevOps — check network',
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

      const result = await pingAzdo('myorg', 'MyProject', 'pat');
      expect(result).toEqual({
        ok: false,
        error: '✗ Azure DevOps API returned HTTP 500',
      });
    });

    it('returns error on invalid JSON response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.reject(new Error('invalid json')),
        }),
      );

      const result = await pingAzdo('myorg', 'MyProject', 'pat');
      expect(result).toEqual({
        ok: false,
        error: '✗ Azure DevOps auth failed — check AZDO_PAT',
      });
    });
  });

  // ─── runWiql ───────────────────────────────────────────────────────────────

  describe('runWiql', () => {
    it('returns work item IDs from WIQL response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              workItems: [
                { id: 1, url: 'https://...' },
                { id: 2, url: 'https://...' },
              ],
            }),
        }),
      );

      const ids = await runWiql('org', 'proj', 'pat', 'SELECT ...');
      expect(ids).toEqual([1, 2]);
    });

    it('returns empty array on HTTP error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 400 }),
      );

      const ids = await runWiql('org', 'proj', 'pat', 'BAD QUERY');
      expect(ids).toEqual([]);
    });

    it('returns empty array on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

      const ids = await runWiql('org', 'proj', 'pat', 'SELECT ...');
      expect(ids).toEqual([]);
    });

    it('returns empty array on invalid response shape', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ bad: 'shape' }),
        }),
      );

      const ids = await runWiql('org', 'proj', 'pat', 'SELECT ...');
      expect(ids).toEqual([]);
    });
  });

  // ─── fetchWorkItems ────────────────────────────────────────────────────────

  describe('fetchWorkItems', () => {
    it('returns work items from batch response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              value: [
                {
                  id: 1,
                  fields: { 'System.Title': 'Item 1' },
                  relations: null,
                },
              ],
              count: 1,
            }),
        }),
      );

      const items = await fetchWorkItems('org', 'proj', 'pat', [1]);
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(1);
    });

    it('returns empty array for empty IDs', async () => {
      const items = await fetchWorkItems('org', 'proj', 'pat', []);
      expect(items).toEqual([]);
    });

    it('handles HTTP errors gracefully', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 404 }),
      );

      const items = await fetchWorkItems('org', 'proj', 'pat', [1, 2]);
      expect(items).toEqual([]);
    });

    it('batches requests in chunks of 200', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ value: [], count: 0 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const ids = Array.from({ length: 250 }, (_, i) => i + 1);
      await fetchWorkItems('org', 'proj', 'pat', ids);

      // Should make 2 requests: 200 + 50
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── fetchWorkItem ─────────────────────────────────────────────────────────

  describe('fetchWorkItem', () => {
    it('returns a single work item', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 42,
              fields: { 'System.Title': 'Test' },
              relations: null,
            }),
        }),
      );

      const item = await fetchWorkItem('org', 'proj', 'pat', 42);
      expect(item).toBeDefined();
      expect(item!.id).toBe(42);
    });

    it('returns undefined on HTTP error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 404 }),
      );

      const item = await fetchWorkItem('org', 'proj', 'pat', 999);
      expect(item).toBeUndefined();
    });

    it('returns undefined on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

      const item = await fetchWorkItem('org', 'proj', 'pat', 42);
      expect(item).toBeUndefined();
    });
  });

  // ─── updateWorkItem ────────────────────────────────────────────────────────

  describe('updateWorkItem', () => {
    it('returns true on successful PATCH', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      const result = await updateWorkItem('org', 'proj', 'pat', 42, [
        { op: 'replace', path: '/fields/System.State', value: 'Active' },
      ]);
      expect(result).toBe(true);
    });

    it('sends JSON Patch content type', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      await updateWorkItem('org', 'proj', 'pat', 42, [
        { op: 'replace', path: '/fields/System.State', value: 'Active' },
      ]);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Content-Type']).toBe(
        'application/json-patch+json',
      );
      expect(options.method).toBe('PATCH');
    });

    it('returns false on HTTP error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 400 }),
      );

      const result = await updateWorkItem('org', 'proj', 'pat', 42, []);
      expect(result).toBe(false);
    });

    it('returns false on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

      const result = await updateWorkItem('org', 'proj', 'pat', 42, []);
      expect(result).toBe(false);
    });
  });

  // ─── fetchTickets ──────────────────────────────────────────────────────────

  describe('fetchTickets', () => {
    it('returns tickets from two-step fetch', async () => {
      const mockFetch = vi
        .fn()
        // First call: WIQL
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              workItems: [{ id: 10 }, { id: 20 }],
            }),
        })
        // Second call: batch fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              value: [
                {
                  id: 10,
                  fields: {
                    'System.Title': 'Item 10',
                    'System.Description': 'Desc 10',
                    'System.Tags': 'tag1',
                  },
                  relations: null,
                },
                {
                  id: 20,
                  fields: {
                    'System.Title': 'Item 20',
                    'System.Description': 'Desc 20',
                    'System.Tags': null,
                  },
                  relations: null,
                },
              ],
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const tickets = await fetchTickets('org', 'proj', 'pat', 'New');
      expect(tickets).toHaveLength(2);
      expect(tickets[0].key).toBe('azdo-10');
      expect(tickets[0].labels).toEqual(['tag1']);
      expect(tickets[1].key).toBe('azdo-20');
    });

    it('filters out clancy:hitl when excludeHitl is true', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              workItems: [{ id: 10 }, { id: 20 }],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              value: [
                {
                  id: 10,
                  fields: {
                    'System.Title': 'Normal',
                    'System.Tags': 'feature',
                  },
                  relations: null,
                },
                {
                  id: 20,
                  fields: {
                    'System.Title': 'HITL',
                    'System.Tags': 'clancy:hitl; feature',
                  },
                  relations: null,
                },
              ],
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const tickets = await fetchTickets(
        'org',
        'proj',
        'pat',
        'New',
        undefined,
        true,
      );
      expect(tickets).toHaveLength(1);
      expect(tickets[0].key).toBe('azdo-10');
    });

    it('returns empty array when WIQL returns no IDs', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ workItems: [] }),
        }),
      );

      const tickets = await fetchTickets('org', 'proj', 'pat', 'New');
      expect(tickets).toEqual([]);
    });

    it('includes WIT filter in WIQL when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ workItems: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await fetchTickets('org', 'proj', 'pat', 'New', 'User Story');

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body as string);
      expect(body.query).toContain("System.WorkItemType] = 'User Story'");
    });
  });

  // ─── fetchBlockerStatus ────────────────────────────────────────────────────

  describe('fetchBlockerStatus', () => {
    it('returns false when no relations', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 42,
              fields: { 'System.Title': 'Test' },
              relations: null,
            }),
        }),
      );

      const blocked = await fetchBlockerStatus('org', 'proj', 'pat', 42);
      expect(blocked).toBe(false);
    });

    it('returns true when predecessor is not done', async () => {
      const mockFetch = vi
        .fn()
        // First call: fetch work item with dependency
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 42,
              fields: { 'System.Title': 'Test' },
              relations: [
                {
                  rel: 'System.LinkTypes.Dependency-Reverse',
                  url: 'https://dev.azure.com/org/_apis/wit/workItems/10',
                },
              ],
            }),
        })
        // Second call: fetch predecessor (still Active)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 10,
              fields: {
                'System.Title': 'Predecessor',
                'System.State': 'Active',
              },
              relations: null,
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const blocked = await fetchBlockerStatus('org', 'proj', 'pat', 42);
      expect(blocked).toBe(true);
    });

    it('returns false when predecessor is done', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 42,
              fields: { 'System.Title': 'Test' },
              relations: [
                {
                  rel: 'System.LinkTypes.Dependency-Reverse',
                  url: 'https://dev.azure.com/org/_apis/wit/workItems/10',
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 10,
              fields: {
                'System.Title': 'Predecessor',
                'System.State': 'Done',
              },
              relations: null,
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const blocked = await fetchBlockerStatus('org', 'proj', 'pat', 42);
      expect(blocked).toBe(false);
    });

    it('returns false on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

      const blocked = await fetchBlockerStatus('org', 'proj', 'pat', 42);
      expect(blocked).toBe(false);
    });
  });

  // ─── fetchChildrenStatus ───────────────────────────────────────────────────

  describe('fetchChildrenStatus', () => {
    it('uses Epic: text convention first (mode 1)', async () => {
      const mockFetch = vi
        .fn()
        // WIQL for description search
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              workItems: [{ id: 100 }, { id: 101 }],
            }),
        })
        // Batch fetch children
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              value: [
                {
                  id: 100,
                  fields: { 'System.State': 'Done' },
                  relations: null,
                },
                {
                  id: 101,
                  fields: { 'System.State': 'Active' },
                  relations: null,
                },
              ],
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchChildrenStatus(
        'org',
        'proj',
        'pat',
        50,
        'azdo-50',
      );
      expect(result).toEqual({ total: 2, incomplete: 1 });
    });

    it('falls back to hierarchy links (mode 2) when description search finds nothing', async () => {
      const mockFetch = vi
        .fn()
        // WIQL for description search — empty
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ workItems: [] }),
        })
        // WIQL for link query
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              workItemRelations: [
                { source: { id: 50 }, target: { id: 200 } },
                { source: { id: 50 }, target: { id: 201 } },
              ],
            }),
        })
        // Batch fetch children
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              value: [
                {
                  id: 200,
                  fields: { 'System.State': 'Closed' },
                  relations: null,
                },
                {
                  id: 201,
                  fields: { 'System.State': 'Closed' },
                  relations: null,
                },
              ],
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchChildrenStatus(
        'org',
        'proj',
        'pat',
        50,
        'azdo-50',
      );
      expect(result).toEqual({ total: 2, incomplete: 0 });
    });

    it('returns undefined on failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

      const result = await fetchChildrenStatus('org', 'proj', 'pat', 50);
      expect(result).toBeUndefined();
    });
  });
});
