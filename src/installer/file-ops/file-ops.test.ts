import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyDir, fileHash } from './file-ops.js';

describe('fileHash', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = join(tmpdir(), `clancy-test-${Date.now()}-${crypto.randomUUID()}`);
    mkdirSync(tmp, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns a consistent SHA-256 hex string', () => {
    const file = join(tmp, 'test.txt');
    writeFileSync(file, 'hello world');
    const hash = fileHash(file);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(fileHash(file)).toBe(hash);
  });

  it('returns different hashes for different content', () => {
    const a = join(tmp, 'a.txt');
    const b = join(tmp, 'b.txt');
    writeFileSync(a, 'content A');
    writeFileSync(b, 'content B');

    expect(fileHash(a)).not.toBe(fileHash(b));
  });
});

describe('copyDir', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = join(tmpdir(), `clancy-test-${Date.now()}-${crypto.randomUUID()}`);
    mkdirSync(tmp, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('copies files recursively', () => {
    const src = join(tmp, 'src');
    const dest = join(tmp, 'dest');
    mkdirSync(join(src, 'sub'), { recursive: true });
    writeFileSync(join(src, 'a.txt'), 'aaa');
    writeFileSync(join(src, 'sub', 'b.txt'), 'bbb');

    copyDir(src, dest);

    expect(fileHash(join(dest, 'a.txt'))).toBe(fileHash(join(src, 'a.txt')));
    expect(fileHash(join(dest, 'sub', 'b.txt'))).toBe(
      fileHash(join(src, 'sub', 'b.txt')),
    );
  });

  it('throws if destination is a symlink', () => {
    const src = join(tmp, 'src');
    const dest = join(tmp, 'dest-link');
    const target = join(tmp, 'target');
    mkdirSync(src, { recursive: true });
    mkdirSync(target, { recursive: true });
    symlinkSync(target, dest);

    expect(() => copyDir(src, dest)).toThrow('symlink');
  });
});
