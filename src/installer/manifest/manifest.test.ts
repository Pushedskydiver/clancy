import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  backupModifiedFiles,
  buildManifest,
  detectModifiedFiles,
} from './manifest.js';

describe('buildManifest', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = join(tmpdir(), `clancy-test-${Date.now()}-${crypto.randomUUID()}`);
    mkdirSync(tmp, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('builds a manifest with SHA-256 hashes', () => {
    writeFileSync(join(tmp, 'a.md'), 'hello');
    writeFileSync(join(tmp, 'b.md'), 'world');

    const manifest = buildManifest(tmp);

    expect(Object.keys(manifest)).toEqual(['a.md', 'b.md']);
    expect(manifest['a.md']).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest['b.md']).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest['a.md']).not.toBe(manifest['b.md']);
  });

  it('includes files in subdirectories', () => {
    mkdirSync(join(tmp, 'sub'), { recursive: true });
    writeFileSync(join(tmp, 'top.md'), 'top');
    writeFileSync(join(tmp, 'sub', 'nested.md'), 'nested');

    const manifest = buildManifest(tmp);

    expect(Object.keys(manifest)).toContain('top.md');
    expect(Object.keys(manifest)).toContain('sub/nested.md');
  });
});

describe('detectModifiedFiles', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = join(tmpdir(), `clancy-test-${Date.now()}-${crypto.randomUUID()}`);
    mkdirSync(tmp, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty when no manifest exists', () => {
    const result = detectModifiedFiles(tmp, join(tmp, 'nonexistent.json'));
    expect(result).toEqual([]);
  });

  it('detects modified files', () => {
    writeFileSync(join(tmp, 'a.md'), 'original');
    const manifest = buildManifest(tmp);
    const manifestPath = join(tmp, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));

    // Modify the file
    writeFileSync(join(tmp, 'a.md'), 'modified');

    const modified = detectModifiedFiles(tmp, manifestPath);

    expect(modified).toHaveLength(1);
    expect(modified[0].rel).toBe('a.md');
  });

  it('ignores unmodified files', () => {
    writeFileSync(join(tmp, 'a.md'), 'unchanged');
    const manifest = buildManifest(tmp);
    const manifestPath = join(tmp, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const modified = detectModifiedFiles(tmp, manifestPath);

    expect(modified).toHaveLength(0);
  });
});

describe('backupModifiedFiles', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = join(tmpdir(), `clancy-test-${Date.now()}-${crypto.randomUUID()}`);
    mkdirSync(tmp, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when no files to back up', () => {
    const result = backupModifiedFiles([], join(tmp, 'patches'));
    expect(result).toBeNull();
  });

  it('copies modified files and writes metadata', () => {
    const srcFile = join(tmp, 'src', 'a.md');
    const patchesDir = join(tmp, 'patches');
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(srcFile, 'modified content');

    const result = backupModifiedFiles(
      [{ rel: 'a.md', absPath: srcFile }],
      patchesDir,
    );

    expect(result).toBe(patchesDir);

    const meta = JSON.parse(
      readFileSync(join(patchesDir, 'backup-meta.json'), 'utf8'),
    );
    expect(meta.backed_up).toEqual(['a.md']);
    expect(meta.date).toBeDefined();
  });
});
