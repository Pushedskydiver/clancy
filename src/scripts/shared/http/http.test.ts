import { describe, expect, it } from 'vitest';

import { githubHeaders, jiraHeaders } from './http.js';

describe('http helpers', () => {
  describe('githubHeaders', () => {
    it('includes Bearer authorization', () => {
      const headers = githubHeaders('tok_123');
      expect(headers.Authorization).toBe('Bearer tok_123');
    });

    it('includes GitHub accept header', () => {
      const headers = githubHeaders('tok_123');
      expect(headers.Accept).toBe('application/vnd.github+json');
    });

    it('includes API version header', () => {
      const headers = githubHeaders('tok_123');
      expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    });
  });

  describe('jiraHeaders', () => {
    it('includes Basic authorization', () => {
      const headers = jiraHeaders('base64string');
      expect(headers.Authorization).toBe('Basic base64string');
    });

    it('includes JSON accept header', () => {
      const headers = jiraHeaders('base64string');
      expect(headers.Accept).toBe('application/json');
    });
  });
});
