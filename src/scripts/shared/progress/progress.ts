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
};

/**
 * Format a date as `YYYY-MM-DD HH:MM`.
 *
 * @param date - The date to format.
 * @returns The formatted date string.
 */
export function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');

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
 * ```
 */
export function appendProgress(
  projectRoot: string,
  key: string,
  summary: string,
  status: ProgressStatus,
): void {
  const filePath = join(projectRoot, '.clancy', 'progress.txt');

  mkdirSync(dirname(filePath), { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const line = `${timestamp} | ${key} | ${summary} | ${status}\n`;

  appendFileSync(filePath, line, 'utf8');
}

/**
 * Parse a progress file into an array of entries.
 *
 * Each line is expected to follow the format:
 * `YYYY-MM-DD HH:MM | TICKET-KEY | summary | STATUS`
 *
 * Lines that don't match are silently skipped.
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

    entries.push({
      timestamp: parts[0]!,
      key: parts[1]!,
      summary: parts.slice(2, -1).join(' | '),
      status: parts[parts.length - 1]! as ProgressStatus,
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
