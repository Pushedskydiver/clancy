import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { findInstallDir } from './check-update.js';

vi.mock('node:fs');
vi.mock('node:child_process');

const mockExistsSync = vi.mocked(existsSync);

describe('check-update', () => {
  describe('findInstallDir', () => {
    it('returns local install dir when local VERSION exists', () => {
      mockExistsSync.mockImplementation((p) =>
        p.toString().includes('/project/.claude'),
      );

      const result = findInstallDir('/project', '/home/user');

      expect(result).toBe('/project/.claude/commands/clancy');
    });

    it('returns global install dir when only global VERSION exists', () => {
      mockExistsSync.mockImplementation((p) =>
        p.toString().includes('/home/user/.claude'),
      );

      const result = findInstallDir('/project', '/home/user');

      expect(result).toBe('/home/user/.claude/commands/clancy');
    });

    it('prefers local over global', () => {
      mockExistsSync.mockReturnValue(true);

      const result = findInstallDir('/project', '/home/user');

      expect(result).toBe('/project/.claude/commands/clancy');
    });

    it('returns null when neither exists', () => {
      mockExistsSync.mockReturnValue(false);

      const result = findInstallDir('/project', '/home/user');

      expect(result).toBeNull();
    });
  });
});
