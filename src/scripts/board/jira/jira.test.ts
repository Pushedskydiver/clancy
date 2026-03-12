import { describe, expect, it } from 'vitest';

import {
  buildAuthHeader,
  buildJql,
  extractAdfText,
  isSafeJqlValue,
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
});
