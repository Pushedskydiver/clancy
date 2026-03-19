import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Append a cost entry to `.clancy/costs.log`.
 *
 * @param projectRoot - The root directory of the project.
 * @param ticketKey - The ticket key (e.g., 'PROJ-101').
 * @param startedAt - ISO 8601 timestamp when the ticket was started.
 * @param tokenRate - Estimated tokens per minute (default: 6600).
 */
export function appendCostEntry(
  projectRoot: string,
  ticketKey: string,
  startedAt: string,
  tokenRate: number = 6600,
): void {
  const filePath = join(projectRoot, '.clancy', 'costs.log');
  mkdirSync(dirname(filePath), { recursive: true });

  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const durationMs = Number.isNaN(start) ? 0 : Math.max(0, now - start);
  const durationMin = Math.round(durationMs / 60000);
  const estimatedTokens = Math.round(durationMin * tokenRate);

  const timestamp = new Date().toISOString();
  const line = `${timestamp} | ${ticketKey} | ${durationMin}min | ~${estimatedTokens} tokens (estimated)\n`;

  appendFileSync(filePath, line, 'utf8');
}
