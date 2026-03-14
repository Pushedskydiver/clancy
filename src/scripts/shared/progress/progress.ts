/**
 * Progress logger for completed tickets.
 *
 * Appends entries to `.clancy/progress.txt` with a timestamp,
 * ticket key, summary, and status.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ProgressStatus } from '~/types/index.js';

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
