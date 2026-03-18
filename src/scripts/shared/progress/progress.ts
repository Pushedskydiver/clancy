/**
 * Progress logger for completed tickets.
 *
 * Appends entries to `.clancy/progress.txt` with a timestamp,
 * ticket key, summary, and status.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ProgressStatus } from '~/types/index.js';

/** A single parsed entry from the progress log. */
export type ProgressEntry = {
  timestamp: string;
  key: string;
  summary: string;
  status: ProgressStatus;
  prNumber?: number;
  parent?: string;
};

/**
 * Format a date as `YYYY-MM-DD HH:MM`.
 *
 * @param date - The date to format.
 * @returns The formatted date string.
 */
export function formatTimestamp(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');

  return `${y}-${mo}-${d} ${h}:${mi}`;
}

/**
 * Append a progress entry to `.clancy/progress.txt`.
 *
 * Creates the file and parent directories if they don't exist.
 *
 * @param projectRoot - The root directory of the project.
 * @param key - The ticket key (e.g., `'PROJ-123'`, `'#42'`).
 * @param summary - The ticket summary/title.
 * @param status - The completion status.
 *
 * @example
 * ```ts
 * appendProgress('/path/to/project', 'PROJ-123', 'Add login page', 'DONE');
 * // Appends: "2024-01-15 14:30 | PROJ-123 | Add login page | DONE"
 *
 * appendProgress('/path/to/project', 'PROJ-101', 'Add login', 'PR_CREATED', 42, 'PROJ-100');
 * // Appends: "2024-01-15 14:30 | PROJ-101 | Add login | PR_CREATED | pr:42 | parent:PROJ-100"
 * ```
 */
export function appendProgress(
  projectRoot: string,
  key: string,
  summary: string,
  status: ProgressStatus,
  prNumber?: number,
  parent?: string,
): void {
  const filePath = join(projectRoot, '.clancy', 'progress.txt');

  mkdirSync(dirname(filePath), { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const prSuffix = prNumber != null ? ` | pr:${prNumber}` : '';
  const parentSuffix = parent ? ` | parent:${parent}` : '';
  const line = `${timestamp} | ${key} | ${summary} | ${status}${prSuffix}${parentSuffix}\n`;

  appendFileSync(filePath, line, 'utf8');
}

/**
 * Parse a progress file into an array of entries.
 *
 * Each line is expected to follow the format:
 * `YYYY-MM-DD HH:MM | KEY | summary | STATUS [| pr:N] [| parent:KEY]`
 *
 * The `pr:` and `parent:` suffixes can appear in any order after the status.
 * Uses named-prefix matching to identify these fields rather than positional
 * indexing, ensuring backward compatibility with entries that lack them.
 *
 * Lines that don't match the minimum format are silently skipped.
 */
function parseProgressFile(projectRoot: string): ProgressEntry[] {
  const filePath = join(projectRoot, '.clancy', 'progress.txt');

  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const entries: ProgressEntry[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(' | ');
    if (parts.length < 4) continue;

    // Fixed positions: timestamp, key, then everything else
    const timestamp = parts[0]!;
    const key = parts[1]!;

    // Scan remaining segments for named prefixes and status
    let status: ProgressStatus | undefined;
    let prNumber: number | undefined;
    let parent: string | undefined;
    const summaryParts: string[] = [];

    for (let i = 2; i < parts.length; i++) {
      const segment = parts[i]!;
      const prMatch = segment.match(/^pr:(\d+)$/);
      const parentMatch = segment.match(/^parent:(.+)$/);

      if (prMatch) {
        prNumber = parseInt(prMatch[1]!, 10);
      } else if (parentMatch) {
        parent = parentMatch[1]!;
      } else if (
        i >= 3 &&
        !status &&
        segment === segment.toUpperCase() &&
        segment.length > 1
      ) {
        // Status is an ALL_CAPS segment after the summary (position 3+)
        status = segment as ProgressStatus;
      } else {
        summaryParts.push(segment);
      }
    }

    if (!status) continue;

    entries.push({
      timestamp,
      key,
      summary: summaryParts.join(' | '),
      status,
      ...(prNumber != null && { prNumber }),
      ...(parent != null && { parent }),
    });
  }

  return entries;
}

/**
 * Find the last progress entry for a given ticket key.
 *
 * @param projectRoot - The root directory of the project.
 * @param key - The ticket key to search for (case-insensitive).
 * @returns The last matching entry, or `undefined` if not found.
 *
 * @example
 * ```ts
 * const entry = findLastEntry('/path/to/project', 'PROJ-123');
 * // { timestamp: '2024-01-15 14:30', key: 'PROJ-123', summary: 'Add login', status: 'DONE' }
 * ```
 */
export function findLastEntry(
  projectRoot: string,
  key: string,
): ProgressEntry | undefined {
  const entries = parseProgressFile(projectRoot);
  const needle = key.toLowerCase();

  let last: ProgressEntry | undefined;
  for (const entry of entries) {
    if (entry.key.toLowerCase() === needle) {
      last = entry;
    }
  }

  return last;
}

/**
 * Count how many times a ticket has been sent back for rework.
 *
 * @param projectRoot - The root directory of the project.
 * @param key - The ticket key to search for (case-insensitive).
 * @returns The number of `REWORK` entries for the given key.
 */
export function countReworkCycles(projectRoot: string, key: string): number {
  const entries = parseProgressFile(projectRoot);
  const needle = key.toLowerCase();

  let count = 0;
  for (const entry of entries) {
    if (entry.key.toLowerCase() === needle && entry.status === 'REWORK') {
      count++;
    }
  }

  return count;
}

/**
 * Find all ticket keys whose most recent progress entry has the given status.
 *
 * Scans progress.txt and returns the latest entry per ticket key,
 * filtered to only those with the specified status. This is used to find
 * tickets that have open PRs (status PR_CREATED) that may need rework.
 *
 * @param projectRoot - The project root directory.
 * @param status - The status to filter by (e.g. 'PR_CREATED').
 * @returns Array of progress entries (latest per key) with the given status.
 */
export function findEntriesWithStatus(
  projectRoot: string,
  status: ProgressStatus,
): ProgressEntry[] {
  const entries = parseProgressFile(projectRoot);

  const latestByKey = new Map<string, ProgressEntry>();
  for (const entry of entries) {
    latestByKey.set(entry.key, entry);
  }

  return [...latestByKey.values()].filter((entry) => entry.status === status);
}
