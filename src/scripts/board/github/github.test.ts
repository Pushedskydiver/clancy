import { describe, expect, it } from 'vitest';

import { isValidRepo } from './github.js';

describe('github', () => {
  describe('isValidRepo', () => {
    it('accepts valid owner/repo format', () => {
      expect(isValidRepo('Pushedskydiver/clancy')).toBe(true);
    });

    it('accepts repos with dots and hyphens', () => {
      expect(isValidRepo('my-org/my-repo.js')).toBe(true);
    });

    it('rejects repos without slash', () => {
      expect(isValidRepo('just-a-repo')).toBe(false);
    });

    it('rejects repos with spaces', () => {
      expect(isValidRepo('my org/my repo')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidRepo('')).toBe(false);
    });

    it('rejects repos with special characters', () => {
      expect(isValidRepo('owner/repo;rm -rf')).toBe(false);
    });
  });
});
