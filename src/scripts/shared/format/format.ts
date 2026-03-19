/**
 * Shared formatting utilities.
 */

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds.
 * @returns Formatted string like `30s`, `1m 30s`, or `5m`.
 */
export function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;

  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;

  if (mins < 60) {
    return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  }

  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;

  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}
