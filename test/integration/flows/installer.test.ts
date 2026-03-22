/**
 * QA-002b-3: Installer sub-module integration tests.
 *
 * Tests the independently importable installer sub-modules against a real
 * filesystem in temp directories. No MSW needed — these are pure filesystem
 * operations.
 *
 * Covers:
 * - file-ops: copyDir recursive copy, symlink rejection
 * - manifest: buildManifest, detectModifiedFiles, backupModifiedFiles
 * - hook-installer: installHooks with settings.json merge, idempotent re-install
 * - Role filtering: core vs optional roles, CLANCY_ROLES env var
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyDir } from '~/installer/file-ops/file-ops.js';
import { installHooks } from '~/installer/hook-installer/hook-installer.js';
import { copyRoleFiles } from '~/installer/role-filter/role-filter.js';
import {
  backupModifiedFiles,
  buildManifest,
  detectModifiedFiles,
  type ModifiedFile,
} from '~/installer/manifest/manifest.js';

// ─── Temp directory helpers ─────────────────────────────────────────────────

let tmp: string;

function freshDir(name: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmp = join(tmpdir(), `clancy-installer-${Date.now()}-${crypto.randomUUID()}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ─── Hook file constants ────────────────────────────────────────────────────

const HOOK_FILES = [
  'clancy-check-update.js',
  'clancy-statusline.js',
  'clancy-context-monitor.js',
  'clancy-credential-guard.js',
  'clancy-branch-guard.js',
  'clancy-post-compact.js',
  'clancy-notification.js',
  'clancy-drift-detector.js',
];

function createFakeHookSource(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const f of HOOK_FILES) {
    writeFileSync(join(dir, f), `// fake ${f}\n`);
  }
}

// ─── file-ops: copyDir ──────────────────────────────────────────────────────

describe('file-ops — copyDir', () => {
  it('copies a flat directory preserving all files', () => {
    const src = freshDir('src');
    const dest = join(tmp, 'dest');

    writeFileSync(join(src, 'a.md'), '# File A');
    writeFileSync(join(src, 'b.md'), '# File B');
    writeFileSync(join(src, 'c.txt'), 'plain text');

    copyDir(src, dest);

    expect(readFileSync(join(dest, 'a.md'), 'utf8')).toBe('# File A');
    expect(readFileSync(join(dest, 'b.md'), 'utf8')).toBe('# File B');
    expect(readFileSync(join(dest, 'c.txt'), 'utf8')).toBe('plain text');
  });

  it('copies nested directory structure recursively', () => {
    const src = freshDir('nested-src');
    const dest = join(tmp, 'nested-dest');

    mkdirSync(join(src, 'sub', 'deep'), { recursive: true });
    writeFileSync(join(src, 'root.md'), 'root');
    writeFileSync(join(src, 'sub', 'middle.md'), 'middle');
    writeFileSync(join(src, 'sub', 'deep', 'leaf.md'), 'leaf');

    copyDir(src, dest);

    expect(readFileSync(join(dest, 'root.md'), 'utf8')).toBe('root');
    expect(readFileSync(join(dest, 'sub', 'middle.md'), 'utf8')).toBe(
      'middle',
    );
    expect(readFileSync(join(dest, 'sub', 'deep', 'leaf.md'), 'utf8')).toBe(
      'leaf',
    );
  });

  it('creates destination parent directories automatically', () => {
    const src = freshDir('auto-parents-src');
    const dest = join(tmp, 'a', 'b', 'c', 'dest');

    writeFileSync(join(src, 'file.md'), 'content');

    copyDir(src, dest);

    expect(readFileSync(join(dest, 'file.md'), 'utf8')).toBe('content');
  });

  it('throws when destination is a symlink', () => {
    const src = freshDir('symlink-src');
    const realDest = freshDir('symlink-real');
    const symlinkDest = join(tmp, 'symlink-dest');

    writeFileSync(join(src, 'file.md'), 'content');
    symlinkSync(realDest, symlinkDest);

    expect(() => copyDir(src, symlinkDest)).toThrow('symlink');
  });

  it('overwrites existing files in destination', () => {
    const src = freshDir('overwrite-src');
    const dest = freshDir('overwrite-dest');

    writeFileSync(join(dest, 'file.md'), 'old content');
    writeFileSync(join(src, 'file.md'), 'new content');

    copyDir(src, dest);

    expect(readFileSync(join(dest, 'file.md'), 'utf8')).toBe('new content');
  });
});

// ─── manifest: buildManifest ────────────────────────────────────────────────

describe('manifest — buildManifest', () => {
  it('builds manifest with SHA-256 hashes for all files', () => {
    const dir = freshDir('manifest-build');
    writeFileSync(join(dir, 'a.md'), 'alpha');
    writeFileSync(join(dir, 'b.md'), 'beta');

    const manifest = buildManifest(dir);

    expect(Object.keys(manifest).sort()).toEqual(['a.md', 'b.md']);
    // SHA-256 hex strings are 64 chars
    expect(manifest['a.md']).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest['b.md']).toMatch(/^[a-f0-9]{64}$/);
    // Different content → different hashes
    expect(manifest['a.md']).not.toBe(manifest['b.md']);
  });

  it('includes nested files with forward-slash relative paths', () => {
    const dir = freshDir('manifest-nested');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'root.md'), 'root');
    writeFileSync(join(dir, 'sub', 'child.md'), 'child');

    const manifest = buildManifest(dir);

    expect(manifest).toHaveProperty('root.md');
    expect(manifest).toHaveProperty('sub/child.md');
  });

  it('produces identical hashes for identical content', () => {
    const dir1 = freshDir('manifest-same-1');
    const dir2 = freshDir('manifest-same-2');
    writeFileSync(join(dir1, 'file.md'), 'identical');
    writeFileSync(join(dir2, 'file.md'), 'identical');

    const m1 = buildManifest(dir1);
    const m2 = buildManifest(dir2);

    expect(m1['file.md']).toBe(m2['file.md']);
  });
});

// ─── manifest: detectModifiedFiles ──────────────────────────────────────────

describe('manifest — detectModifiedFiles', () => {
  it('detects modified files by comparing hashes', () => {
    const dir = freshDir('detect-modified');
    const manifestPath = join(tmp, 'detect-manifest.json');

    writeFileSync(join(dir, 'unchanged.md'), 'original');
    writeFileSync(join(dir, 'will-change.md'), 'original');

    // Build and save manifest
    const manifest = buildManifest(dir);
    writeFileSync(manifestPath, JSON.stringify(manifest));

    // Modify one file
    writeFileSync(join(dir, 'will-change.md'), 'modified!');

    const modified = detectModifiedFiles(dir, manifestPath);

    expect(modified).toHaveLength(1);
    expect(modified[0].rel).toBe('will-change.md');
    expect(modified[0].absPath).toBe(join(dir, 'will-change.md'));
  });

  it('returns empty array when no files are modified', () => {
    const dir = freshDir('detect-none');
    const manifestPath = join(tmp, 'detect-none-manifest.json');

    writeFileSync(join(dir, 'file.md'), 'stable');

    const manifest = buildManifest(dir);
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const modified = detectModifiedFiles(dir, manifestPath);

    expect(modified).toHaveLength(0);
  });

  it('returns empty array when manifest file does not exist', () => {
    const dir = freshDir('detect-no-manifest');
    writeFileSync(join(dir, 'file.md'), 'content');

    const modified = detectModifiedFiles(
      dir,
      join(tmp, 'nonexistent-manifest.json'),
    );

    expect(modified).toHaveLength(0);
  });

  it('returns empty array when manifest JSON is invalid', () => {
    const dir = freshDir('detect-bad-json');
    const manifestPath = join(tmp, 'bad-manifest.json');

    writeFileSync(join(dir, 'file.md'), 'content');
    writeFileSync(manifestPath, 'not valid json!!!');

    const modified = detectModifiedFiles(dir, manifestPath);

    expect(modified).toHaveLength(0);
  });

  it('ignores files deleted since manifest was written', () => {
    const dir = freshDir('detect-deleted');
    const manifestPath = join(tmp, 'detect-deleted-manifest.json');

    writeFileSync(join(dir, 'kept.md'), 'kept');
    writeFileSync(join(dir, 'deleted.md'), 'will-delete');

    const manifest = buildManifest(dir);
    writeFileSync(manifestPath, JSON.stringify(manifest));

    // Delete one file, modify the other
    rmSync(join(dir, 'deleted.md'));
    writeFileSync(join(dir, 'kept.md'), 'changed');

    const modified = detectModifiedFiles(dir, manifestPath);

    // Only the modified file, not the deleted one
    expect(modified).toHaveLength(1);
    expect(modified[0].rel).toBe('kept.md');
  });
});

// ─── manifest: backupModifiedFiles ──────────────────────────────────────────

describe('manifest — backupModifiedFiles', () => {
  it('backs up modified files and writes metadata', () => {
    const dir = freshDir('backup-src');
    const patchesDir = join(tmp, 'patches');

    writeFileSync(join(dir, 'a.md'), 'user changes A');
    writeFileSync(join(dir, 'b.md'), 'user changes B');

    const modified: ModifiedFile[] = [
      { rel: 'a.md', absPath: join(dir, 'a.md') },
      { rel: 'b.md', absPath: join(dir, 'b.md') },
    ];

    const result = backupModifiedFiles(modified, patchesDir);

    expect(result).toBe(patchesDir);
    expect(readFileSync(join(patchesDir, 'a.md'), 'utf8')).toBe(
      'user changes A',
    );
    expect(readFileSync(join(patchesDir, 'b.md'), 'utf8')).toBe(
      'user changes B',
    );

    // Metadata
    const meta = JSON.parse(
      readFileSync(join(patchesDir, 'backup-meta.json'), 'utf8'),
    ) as { backed_up: string[]; date: string };
    expect(meta.backed_up).toEqual(['a.md', 'b.md']);
    expect(meta.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('preserves subdirectory structure in backup', () => {
    const dir = freshDir('backup-nested');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'deep.md'), 'nested content');

    const modified: ModifiedFile[] = [
      { rel: 'sub/deep.md', absPath: join(dir, 'sub', 'deep.md') },
    ];

    const patchesDir = join(tmp, 'nested-patches');
    backupModifiedFiles(modified, patchesDir);

    expect(readFileSync(join(patchesDir, 'sub', 'deep.md'), 'utf8')).toBe(
      'nested content',
    );
  });

  it('returns null when given an empty array', () => {
    const patchesDir = join(tmp, 'empty-patches');
    const result = backupModifiedFiles([], patchesDir);

    expect(result).toBeNull();
    expect(existsSync(patchesDir)).toBe(false);
  });

  it('end-to-end: build → modify → detect → backup', () => {
    const dir = freshDir('e2e-backup');
    const manifestPath = join(tmp, 'e2e-manifest.json');
    const patchesDir = join(tmp, 'e2e-patches');

    // Install original files
    writeFileSync(join(dir, 'config.md'), 'original config');
    writeFileSync(join(dir, 'readme.md'), 'original readme');

    // Build manifest (simulates post-install manifest creation)
    const manifest = buildManifest(dir);
    writeFileSync(manifestPath, JSON.stringify(manifest));

    // User modifies a file
    writeFileSync(join(dir, 'config.md'), 'user customised config');

    // Detect modifications (simulates update check)
    const modified = detectModifiedFiles(dir, manifestPath);
    expect(modified).toHaveLength(1);
    expect(modified[0].rel).toBe('config.md');

    // Backup before overwrite
    const result = backupModifiedFiles(modified, patchesDir);
    expect(result).toBe(patchesDir);
    expect(readFileSync(join(patchesDir, 'config.md'), 'utf8')).toBe(
      'user customised config',
    );
  });
});

// ─── hook-installer: installHooks ───────────────────────────────────────────

describe('hook-installer — installHooks', () => {
  let claudeDir: string;
  let hooksSource: string;

  beforeEach(() => {
    claudeDir = freshDir('claude-config');
    hooksSource = freshDir('hooks-source');
    createFakeHookSource(hooksSource);
  });

  it('copies all hook files to the hooks directory', () => {
    const result = installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
    });

    expect(result).toBe(true);

    const hooksDir = join(claudeDir, 'hooks');
    for (const f of HOOK_FILES) {
      expect(existsSync(join(hooksDir, f))).toBe(true);
      expect(readFileSync(join(hooksDir, f), 'utf8')).toBe(`// fake ${f}\n`);
    }
  });

  it('writes CommonJS package.json in hooks directory', () => {
    installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
    });

    const pkg = JSON.parse(
      readFileSync(join(claudeDir, 'hooks', 'package.json'), 'utf8'),
    ) as { type: string };
    expect(pkg.type).toBe('commonjs');
  });

  it('creates settings.json with hook registrations', () => {
    installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
    });

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    ) as { hooks: Record<string, unknown[]>; statusLine: unknown };

    // All expected hook events registered
    expect(settings.hooks).toHaveProperty('SessionStart');
    expect(settings.hooks).toHaveProperty('PostToolUse');
    expect(settings.hooks).toHaveProperty('PreToolUse');
    expect(settings.hooks).toHaveProperty('PostCompact');
    expect(settings.hooks).toHaveProperty('Notification');

    // PreToolUse has both credential-guard and branch-guard
    const preToolUse = settings.hooks['PreToolUse'] as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(preToolUse).toHaveLength(2);
    const preToolUseCommands = preToolUse.map((h) => h.hooks[0].command);
    expect(preToolUseCommands[0]).toContain('clancy-credential-guard.js');
    expect(preToolUseCommands[1]).toContain('clancy-branch-guard.js');

    // PostToolUse has both context-monitor and drift-detector
    const postToolUse = settings.hooks['PostToolUse'] as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(postToolUse).toHaveLength(2);
    const postToolUseCommands = postToolUse.map((h) => h.hooks[0].command);
    expect(postToolUseCommands[0]).toContain('clancy-context-monitor.js');
    expect(postToolUseCommands[1]).toContain('clancy-drift-detector.js');

    // SessionStart has check-update
    const sessionStart = settings.hooks['SessionStart'] as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(sessionStart[0].hooks[0].command).toContain(
      'clancy-check-update.js',
    );

    // PostCompact has post-compact
    const postCompact = settings.hooks['PostCompact'] as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(postCompact[0].hooks[0].command).toContain(
      'clancy-post-compact.js',
    );

    // Notification has notification hook
    const notification = settings.hooks['Notification'] as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(notification[0].hooks[0].command).toContain(
      'clancy-notification.js',
    );

    // Statusline registered as top-level key with correct script
    expect(settings.statusLine).toBeDefined();
    const statusLine = settings.statusLine as { command: string };
    expect(statusLine.command).toContain('clancy-statusline.js');
  });

  it('preserves existing settings.json content on install', () => {
    // Write pre-existing settings
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify(
        { model: 'claude-sonnet-4-5-20250514', customKey: 'preserved' },
        null,
        2,
      ),
    );

    installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
    });

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(settings.model).toBe('claude-sonnet-4-5-20250514');
    expect(settings.customKey).toBe('preserved');
    expect(settings.hooks).toBeDefined();
  });

  it('does not duplicate hooks on re-install (idempotent)', () => {
    // Install twice
    installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
    });
    installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
    });

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    ) as { hooks: Record<string, unknown[]> };

    // Should still have exactly 2 PreToolUse hooks, not 4
    expect(settings.hooks['PreToolUse']).toHaveLength(2);
    expect(settings.hooks['PostToolUse']).toHaveLength(2);
    expect(settings.hooks['SessionStart']).toHaveLength(1);
    expect(settings.hooks['PostCompact']).toHaveLength(1);
    expect(settings.hooks['Notification']).toHaveLength(1);
  });

  it('registers verification gate agent hook when prompt provided', () => {
    const gatePrompt = 'You are a verification gate agent. Check the work.';

    installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
      verificationGatePrompt: gatePrompt,
    });

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    ) as { hooks: Record<string, Array<{ hooks: Array<{ type: string; prompt?: string; timeout?: number }> }>> };

    expect(settings.hooks).toHaveProperty('Stop');
    const stopHooks = settings.hooks['Stop'];
    expect(stopHooks).toHaveLength(1);

    const agentHook = stopHooks[0].hooks[0];
    expect(agentHook.type).toBe('agent');
    expect(agentHook.prompt).toBe(gatePrompt);
    expect(agentHook.timeout).toBe(120);
  });

  it('does not register Stop hook when no prompt provided', () => {
    installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
    });

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    ) as { hooks: Record<string, unknown[]> };

    expect(settings.hooks['Stop']).toBeUndefined();
  });

  it('returns false when hooks source directory is missing', () => {
    const result = installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: join(tmp, 'nonexistent-hooks'),
    });

    expect(result).toBe(false);
  });

  it('recovers gracefully from corrupt settings.json', () => {
    writeFileSync(
      join(claudeDir, 'settings.json'),
      'this is not valid JSON at all!!!',
    );

    const result = installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
    });

    expect(result).toBe(true);

    // Should have created fresh settings with hooks
    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    ) as { hooks: Record<string, unknown[]> };
    expect(settings.hooks).toHaveProperty('PreToolUse');
  });

  it('does not duplicate agent hooks on re-install (idempotent)', () => {
    const gatePrompt = 'You are a verification gate agent. Check the work.';
    const opts = {
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
      verificationGatePrompt: gatePrompt,
    };

    // Install twice with the same prompt
    installHooks(opts);
    installHooks(opts);

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    ) as { hooks: Record<string, Array<{ hooks: unknown[] }>> };

    // Should still have exactly 1 Stop hook, not 2
    expect(settings.hooks['Stop']).toHaveLength(1);
  });

  it('preserves existing statusLine if already set', () => {
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify(
        { statusLine: { type: 'command', command: 'custom-statusline' } },
        null,
        2,
      ),
    );

    installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
    });

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    ) as { statusLine: { command: string } };

    expect(settings.statusLine.command).toBe('custom-statusline');
  });
});

// ─── Role filtering ─────────────────────────────────────────────────────────

describe('role filtering — copyRoleFiles', () => {
  function createRolesDir(): string {
    const rolesDir = freshDir('roles');

    for (const role of [
      'implementer',
      'reviewer',
      'setup',
      'planner',
      'strategist',
    ]) {
      const cmdDir = join(rolesDir, role, 'commands');
      mkdirSync(cmdDir, { recursive: true });
      writeFileSync(join(cmdDir, `${role}-cmd.md`), `# ${role} command`);
    }

    return rolesDir;
  }

  it('installs all roles when enabledRoles is null (first install)', () => {
    const rolesDir = createRolesDir();
    const dest = join(tmp, 'all-roles-dest');

    copyRoleFiles(rolesDir, 'commands', dest, null);

    expect(existsSync(join(dest, 'implementer-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'reviewer-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'setup-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'planner-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'strategist-cmd.md'))).toBe(true);
  });

  it('installs only core roles when enabledRoles is empty set', () => {
    const rolesDir = createRolesDir();
    const dest = join(tmp, 'core-only-dest');

    copyRoleFiles(rolesDir, 'commands', dest, new Set());

    expect(existsSync(join(dest, 'implementer-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'reviewer-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'setup-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'planner-cmd.md'))).toBe(false);
    expect(existsSync(join(dest, 'strategist-cmd.md'))).toBe(false);
  });

  it('installs core + planner when CLANCY_ROLES=planner', () => {
    const rolesDir = createRolesDir();
    const dest = join(tmp, 'planner-dest');

    copyRoleFiles(rolesDir, 'commands', dest, new Set(['planner']));

    expect(existsSync(join(dest, 'implementer-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'reviewer-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'setup-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'planner-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'strategist-cmd.md'))).toBe(false);
  });

  it('installs core + both optional roles when both enabled', () => {
    const rolesDir = createRolesDir();
    const dest = join(tmp, 'both-optional-dest');

    copyRoleFiles(
      rolesDir,
      'commands',
      dest,
      new Set(['planner', 'strategist']),
    );

    expect(existsSync(join(dest, 'implementer-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'planner-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'strategist-cmd.md'))).toBe(true);
  });

  it('core roles are always included regardless of enabledRoles content', () => {
    const rolesDir = createRolesDir();
    const dest = join(tmp, 'core-always-dest');

    copyRoleFiles(rolesDir, 'commands', dest, new Set(['strategist']));

    expect(existsSync(join(dest, 'implementer-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'reviewer-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'setup-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'strategist-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'planner-cmd.md'))).toBe(false);
  });

  it('removes previously-installed optional role files when role is disabled', () => {
    const rolesDir = createRolesDir();
    const dest = join(tmp, 'cleanup-dest');

    // First install: all roles (null = first install)
    copyRoleFiles(rolesDir, 'commands', dest, null);
    expect(existsSync(join(dest, 'planner-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'strategist-cmd.md'))).toBe(true);

    // Second install: only core roles (empty set = no optional roles)
    copyRoleFiles(rolesDir, 'commands', dest, new Set());

    // Optional role files should be removed
    expect(existsSync(join(dest, 'planner-cmd.md'))).toBe(false);
    expect(existsSync(join(dest, 'strategist-cmd.md'))).toBe(false);

    // Core role files should still be present
    expect(existsSync(join(dest, 'implementer-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'reviewer-cmd.md'))).toBe(true);
    expect(existsSync(join(dest, 'setup-cmd.md'))).toBe(true);
  });
});
