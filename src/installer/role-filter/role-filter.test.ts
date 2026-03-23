import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyRoleFiles } from './role-filter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let testDir: string;

function createRole(role: string, subdir: string, files: string[]): void {
  const dir = join(testDir, 'roles', role, subdir);
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    writeFileSync(join(dir, file), `# ${role}/${file}`);
  }
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'role-filter-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('copyRoleFiles', () => {
  it('installs all roles when enabledRoles is null (first install)', () => {
    createRole('implementer', 'commands', ['run.md']);
    createRole('planner', 'commands', ['plan.md']);

    const dest = join(testDir, 'dest');
    copyRoleFiles(join(testDir, 'roles'), 'commands', dest, null);

    expect(existsSync(join(dest, 'run.md'))).toBe(true);
    expect(existsSync(join(dest, 'plan.md'))).toBe(true);
  });

  it('installs only core roles when enabledRoles is empty', () => {
    createRole('implementer', 'commands', ['run.md']);
    createRole('reviewer', 'commands', ['review.md']);
    createRole('planner', 'commands', ['plan.md']);

    const dest = join(testDir, 'dest');
    copyRoleFiles(join(testDir, 'roles'), 'commands', dest, new Set<string>());

    expect(existsSync(join(dest, 'run.md'))).toBe(true);
    expect(existsSync(join(dest, 'review.md'))).toBe(true);
    expect(existsSync(join(dest, 'plan.md'))).toBe(false);
  });

  it('installs core + specified optional roles', () => {
    createRole('implementer', 'commands', ['run.md']);
    createRole('planner', 'commands', ['plan.md']);
    createRole('strategist', 'commands', ['brief.md']);

    const dest = join(testDir, 'dest');
    copyRoleFiles(
      join(testDir, 'roles'),
      'commands',
      dest,
      new Set(['planner']),
    );

    expect(existsSync(join(dest, 'run.md'))).toBe(true);
    expect(existsSync(join(dest, 'plan.md'))).toBe(true);
    expect(existsSync(join(dest, 'brief.md'))).toBe(false);
  });

  it('removes previously-installed files for disabled optional roles', () => {
    createRole('planner', 'commands', ['plan.md']);

    const dest = join(testDir, 'dest');
    mkdirSync(dest, { recursive: true });
    // Simulate a previously-installed file
    writeFileSync(join(dest, 'plan.md'), '# old planner file');

    copyRoleFiles(join(testDir, 'roles'), 'commands', dest, new Set<string>());

    expect(existsSync(join(dest, 'plan.md'))).toBe(false);
  });

  it('skips roles without the target subdir', () => {
    createRole('implementer', 'commands', ['run.md']);
    // reviewer has no 'commands' subdir
    mkdirSync(join(testDir, 'roles', 'reviewer'), { recursive: true });

    const dest = join(testDir, 'dest');
    copyRoleFiles(join(testDir, 'roles'), 'commands', dest, null);

    expect(existsSync(join(dest, 'run.md'))).toBe(true);
  });
});
