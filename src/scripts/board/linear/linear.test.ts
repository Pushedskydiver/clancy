import { describe, expect, it } from 'vitest';

import { isValidTeamId } from './linear.js';

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
});
