/**
 * Low-level file system helpers for the installer.
 *
 * Provides SHA-256 hashing and recursive directory copying with symlink detection.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';

/** Minimal directory-entry shape returned by `readdirSync({ withFileTypes: true })`. */
export type DirentLike = { name: string; isDirectory(): boolean };

/**
 * Compute the SHA-256 hash of a file.
 *
 * @param filePath - Absolute path to the file.
 * @returns The hex-encoded SHA-256 hash string.
 *
 * @example
 * ```ts
 * const hash = fileHash('/path/to/file.md');
 * // 'e3b0c44298fc1c149afbf4c8996fb924...'
 * ```
 */
export function fileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Recursively copy a directory, throwing if the destination is a symlink.
 *
 * @param src - Source directory path.
 * @param dest - Destination directory path.
 * @throws If the destination is a symlink.
 *
 * @example
 * ```ts
 * copyDir('src/roles/implementer/commands', '/home/user/.claude/commands/clancy');
 * ```
 */
export function copyDir(src: string, dest: string): void {
  if (existsSync(dest)) {
    const stat = lstatSync(dest);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `${dest} is a symlink. Remove it first before installing.`,
      );
    }
  }

  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src, {
    withFileTypes: true,
  }) as DirentLike[]) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}
