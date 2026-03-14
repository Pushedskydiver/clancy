import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAuthHeader,
  buildJql,
  extractAdfText,
  fetchTicket,
  isSafeJqlValue,
  pingJira,
  transitionIssue,
} from './jira.js';

describe('jira', () => {
  describe('buildAuthHeader', () => {
    it('builds a base64 encoded auth header', () => {
      const result = buildAuthHeader('user@example.com', 'token123');
      const decoded = Buffer.from(result, 'base64').toString();
      expect(decoded).toBe('user@example.com:token123');
    });
  });

  describe('isSafeJqlValue', () => {
    it('accepts alphanumeric values', () => {
      expect(isSafeJqlValue('To Do')).toBe(true);
    });

    it('accepts values with hyphens and underscores', () => {
      expect(isSafeJqlValue('in-progress_v2')).toBe(true);
    });

    it('rejects values with special characters', () => {
      expect(isSafeJqlValue('status; DROP TABLE')).toBe(false);
    });

    it('rejects values with parentheses', () => {
      expect(isSafeJqlValue('openSprints()')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isSafeJqlValue('')).toBe(false);
    });
  });

  describe('buildJql', () => {
    it('builds basic JQL with project and status', () => {
      const jql = buildJql('PROJ', 'To Do');
      expect(jql).toContain('project="PROJ"');
      expect(jql).toContain('status="To Do"');
      expect(jql).toContain('assignee=currentUser()');
      expect(jql).toContain('ORDER BY priority ASC');
    });

    it('includes sprint filter when provided', () => {
      const jql = buildJql('PROJ', 'To Do', 'yes');
      expect(jql).toContain('sprint in openSprints()');
    });

    it('excludes sprint filter when not provided', () => {
      const jql = buildJql('PROJ', 'To Do');
      expect(jql).not.toContain('sprint');
    });

    it('includes label filter when provided', () => {
      const jql = buildJql('PROJ', 'To Do', undefined, 'clancy');
      expect(jql).toContain('labels = "clancy"');
    });

    it('excludes label filter when not provided', () => {
      const jql = buildJql('PROJ', 'To Do');
      expect(jql).not.toContain('labels');
    });

    it('does not join ORDER BY with AND', () => {
      const jql = buildJql('PROJ', 'To Do');
      expect(jql).not.toContain('AND ORDER BY');
    });
  });

  describe('extractAdfText', () => {
    it('extracts text from a simple ADF document', () => {
      const adf = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      };

      const result = extractAdfText(adf);
      expect(result).toContain('Hello world');
    });

    it('extracts text from nested ADF structures', () => {
      const adf = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'First' },
              { type: 'text', text: 'Second' },
            ],
          },
        ],
      };

      const result = extractAdfText(adf);
      expect(result).toContain('First');
      expect(result).toContain('Second');
    });

    it('returns empty string for undefined', () => {
      expect(extractAdfText(undefined)).toBe('');
    });

    it('returns empty string for null', () => {
      expect(extractAdfText(null)).toBe('');
    });

    it('returns empty string for non-object', () => {
      expect(extractAdfText('string')).toBe('');
    });
  });

  describe('pingJira', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns ok true on successful response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      const result = await pingJira(
        'https://example.atlassian.net',
        'PROJ',
        'base64auth',
      );
      expect(result).toEqual({ ok: true });
    });

    it('returns error on auth failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 401 }),
      );

      const result = await pingJira(
        'https://example.atlassian.net',
        'PROJ',
        'bad_auth',
      );
      expect(result).toEqual({
        ok: false,
        error: '✗ Jira auth failed — check credentials',
      });
    });

    it('returns error on network failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await pingJira(
        'https://example.atlassian.net',
        'PROJ',
        'auth',
      );
      expect(result).toEqual({
        ok: false,
        error: '✗ Could not reach Jira — check network',
      });
    });
  });

  describe('fetchTicket', () => {
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
              issues: [
                {
                  key: 'PROJ-123',
                  fields: {
                    summary: 'Add login page',
                    description: null,
                    issuelinks: [],
                    parent: { key: 'PROJ-10' },
                    customfield_10014: null,
                  },
                },
              ],
            }),
        }),
      );

      const result = await fetchTicket(
        'https://example.atlassian.net',
        'base64auth',
        'PROJ',
        'To Do',
      );

      expect(result).toEqual({
        key: 'PROJ-123',
        title: 'Add login page',
        description: '',
        provider: 'jira',
        epicKey: 'PROJ-10',
        blockers: [],
      });
    });

    it('returns undefined on empty results', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ issues: [] }),
        }),
      );

      const result = await fetchTicket(
        'https://example.atlassian.net',
        'base64auth',
        'PROJ',
        'To Do',
      );

      expect(result).toBeUndefined();
    });

    it('returns undefined on API error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      const result = await fetchTicket(
        'https://example.atlassian.net',
        'base64auth',
        'PROJ',
        'To Do',
      );

      expect(result).toBeUndefined();
    });
  });

  describe('transitionIssue', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns true on successful transition', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          // First call: lookupTransitionId
          .mockResolvedValueOnce({
            ok: true,
            json: () =>
              Promise.resolve({
                transitions: [
                  { id: '31', name: 'In Progress' },
                  { id: '41', name: 'Done' },
                ],
              }),
          })
          // Second call: POST transition
          .mockResolvedValueOnce({ ok: true }),
      );

      const result = await transitionIssue(
        'https://example.atlassian.net',
        'base64auth',
        'PROJ-123',
        'In Progress',
      );

      expect(result).toBe(true);
    });

    it('returns false on HTTP error during transition', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          // First call: lookupTransitionId
          .mockResolvedValueOnce({
            ok: true,
            json: () =>
              Promise.resolve({
                transitions: [{ id: '31', name: 'In Progress' }],
              }),
          })
          // Second call: POST transition fails
          .mockResolvedValueOnce({ ok: false, status: 400 }),
      );

      const result = await transitionIssue(
        'https://example.atlassian.net',
        'base64auth',
        'PROJ-123',
        'In Progress',
      );

      expect(result).toBe(false);
    });
  });
});
