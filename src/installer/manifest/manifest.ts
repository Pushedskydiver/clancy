/**
 * Manifest-based change detection for installed files.
 *
 * Tracks SHA-256 hashes of installed files so that user modifications can
 * be detected and backed up before an update overwrites them.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { fileHash } from '~/installer/file-ops/file-ops.js';
import type { DirentLike } from '~/installer/file-ops/file-ops.js';

/** A file that has been modified by the user since last install. */
export type ModifiedFile = { rel: string; absPath: string };

/**
 * Build a manifest of installed files with SHA-256 hashes.
 *
 * Recursively walks a directory and records the hash of every file.
 *
 * @param baseDir - Root directory to scan.
 * @returns A record mapping relative paths to their SHA-256 hashes.
 *
 * @example
 * ```ts
 * const manifest = buildManifest('/path/to/.claude/commands/clancy');
 * // { "init.md": "abc123...", "run.md": "def456..." }
 * ```
 */
export function buildManifest(baseDir: string): Record<string, string> {
  const manifest: Record<string, string> = {};

  function walk(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir, {
      withFileTypes: true,
    }) as DirentLike[]) {
      const full = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(full, rel);
      } else {
        manifest[rel] = fileHash(full);
      }
    }
  }

  walk(baseDir, '');
  return manifest;
}

/**
 * Detect files modified by the user since last install.
 *
 * Compares current file hashes against the stored manifest to find changes.
 *
 * @param baseDir - The installed directory to check.
 * @param manifestPath - Path to the stored manifest JSON.
 * @returns Array of modified file records with relative and absolute paths.
 */
export function detectModifiedFiles(
  baseDir: string,
  manifestPath: string,
): ModifiedFile[] {
  if (!existsSync(manifestPath)) return [];

  let manifest: Record<string, string>;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
      string,
      string
    >;
  } catch {
    return [];
  }

  const modified: ModifiedFile[] = [];

  for (const [rel, hash] of Object.entries(manifest)) {
    const absPath = join(baseDir, rel);
    if (!existsSync(absPath)) continue;

    if (fileHash(absPath) !== hash) {
      modified.push({ rel, absPath });
    }
  }

  return modified;
}

/**
 * Back up modified files to a patches directory.
 *
 * Copies each modified file and writes a `backup-meta.json` with metadata.
 *
 * @param modified - Array of modified file records.
 * @param patchesDir - Directory to store backups.
 * @returns The patches directory path, or `null` if no files were backed up.
 */
export function backupModifiedFiles(
  modified: ModifiedFile[],
  patchesDir: string,
): string | null {
  if (modified.length === 0) return null;

  mkdirSync(patchesDir, { recursive: true });

  for (const { rel, absPath } of modified) {
    const backupPath = join(patchesDir, rel);
    mkdirSync(dirname(backupPath), { recursive: true });
    copyFileSync(absPath, backupPath);
  }

  writeFileSync(
    join(patchesDir, 'backup-meta.json'),
    JSON.stringify(
      {
        backed_up: modified.map((m) => m.rel),
        date: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  return patchesDir;
}
