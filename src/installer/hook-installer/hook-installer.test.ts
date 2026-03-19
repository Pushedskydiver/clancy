import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installHooks } from './hook-installer.js';

describe('installHooks', () => {
  let tmp: string;
  let hooksSource: string;
  let claudeDir: string;

  beforeEach(() => {
    tmp = join(tmpdir(), `clancy-test-${Date.now()}-${crypto.randomUUID()}`);
    hooksSource = join(tmp, 'hooks-src');
    claudeDir = join(tmp, '.claude');
    mkdirSync(hooksSource, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });

    // Create fake hook files
    for (const f of [
      'clancy-check-update.js',
      'clancy-statusline.js',
      'clancy-context-monitor.js',
      'clancy-credential-guard.js',
      'clancy-branch-guard.js',
      'clancy-post-compact.js',
    ]) {
      writeFileSync(join(hooksSource, f), `// ${f}`);
    }
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('copies hook files to the hooks directory', () => {
    installHooks({ claudeConfigDir: claudeDir, hooksSourceDir: hooksSource });

    const hooksDir = join(claudeDir, 'hooks');
    expect(existsSync(join(hooksDir, 'clancy-check-update.js'))).toBe(true);
    expect(existsSync(join(hooksDir, 'clancy-credential-guard.js'))).toBe(true);
  });

  it('writes a CommonJS package.json in the hooks directory', () => {
    installHooks({ claudeConfigDir: claudeDir, hooksSourceDir: hooksSource });

    const pkg = JSON.parse(
      readFileSync(join(claudeDir, 'hooks', 'package.json'), 'utf8'),
    );
    expect(pkg.type).toBe('commonjs');
  });

  it('registers hooks in settings.json', () => {
    installHooks({ claudeConfigDir: claudeDir, hooksSourceDir: hooksSource });

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    );

    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PostCompact).toHaveLength(1);
    expect(settings.statusLine).toBeDefined();
    expect(settings.statusLine.type).toBe('command');
  });

  it('does not duplicate hooks on re-install', () => {
    installHooks({ claudeConfigDir: claudeDir, hooksSourceDir: hooksSource });
    installHooks({ claudeConfigDir: claudeDir, hooksSourceDir: hooksSource });

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    );

    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PostCompact).toHaveLength(1);
  });

  it('preserves existing settings', () => {
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify({ customSetting: true }, null, 2),
    );

    installHooks({ claudeConfigDir: claudeDir, hooksSourceDir: hooksSource });

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    );

    expect(settings.customSetting).toBe(true);
    expect(settings.hooks).toBeDefined();
  });

  it('returns true on success', () => {
    const result = installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
    });
    expect(result).toBe(true);
  });

  it('registers the verification gate agent hook when prompt is provided', () => {
    installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
      verificationGatePrompt: '# Verification Gate Agent\n\nYou are the gate.',
    });

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    );

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].type).toBe('agent');
    expect(settings.hooks.Stop[0].hooks[0].prompt).toContain(
      'Verification Gate Agent',
    );
    expect(settings.hooks.Stop[0].hooks[0].timeout).toBe(120);
  });

  it('does not register Stop hook when no prompt is provided', () => {
    installHooks({ claudeConfigDir: claudeDir, hooksSourceDir: hooksSource });

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    );

    expect(settings.hooks.Stop).toBeUndefined();
  });

  it('does not duplicate the agent hook on re-install', () => {
    const opts = {
      claudeConfigDir: claudeDir,
      hooksSourceDir: hooksSource,
      verificationGatePrompt: '# Verification Gate Agent\n\nYou are the gate.',
    };
    installHooks(opts);
    installHooks(opts);

    const settings = JSON.parse(
      readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
    );

    expect(settings.hooks.Stop).toHaveLength(1);
  });

  it('returns false when source hooks are missing', () => {
    const result = installHooks({
      claudeConfigDir: claudeDir,
      hooksSourceDir: join(tmp, 'nonexistent'),
    });
    expect(result).toBe(false);
  });
});
