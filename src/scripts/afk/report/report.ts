/**
 * AFK session report generator.
 *
 * Reads progress.txt and costs.log entries created during the current
 * AFK session and generates a markdown report at `.clancy/session-report.md`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getQualityData } from '~/scripts/once/quality/quality.js';
import { formatDuration } from '~/scripts/shared/format/format.js';
import {
  type ProgressEntry,
  parseProgressFile,
} from '~/scripts/shared/progress/progress.js';

/** A parsed cost entry from costs.log. */
export type CostEntry = {
  timestamp: string;
  key: string;
  duration: string;
  tokens: string;
};

/** A ticket in the session report. */
export type SessionTicket = {
  key: string;
  summary: string;
  status: string;
  prNumber?: number;
  duration?: string;
  tokens?: string;
};

/**
 * Parse costs.log and return entries with ISO timestamp >= the given threshold.
 *
 * Each line is expected to follow the format:
 * `ISO-timestamp | KEY | Nmin | ~N tokens (estimated)`
 *
 * Lines that don't match are silently skipped.
 *
 * @param projectRoot - The project root directory.
 * @param sinceMs - Only include entries with timestamp >= this value (ms since epoch).
 * @returns Parsed cost entries from this session.
 */
export function parseCostsLog(
  projectRoot: string,
  sinceMs: number,
): CostEntry[] {
  const filePath = join(projectRoot, '.clancy', 'costs.log');

  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const entries: CostEntry[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(' | ');
    if (parts.length < 4) continue;

    const timestamp = parts[0]!;
    const entryTime = new Date(timestamp).getTime();

    if (Number.isNaN(entryTime) || entryTime < sinceMs) continue;

    entries.push({
      timestamp,
      key: parts[1]!,
      duration: parts[2]!,
      tokens: parts[3]!,
    });
  }

  return entries;
}

/**
 * Convert a progress timestamp (`YYYY-MM-DD HH:MM`) to milliseconds since epoch.
 *
 * @param timestamp - The progress file timestamp string.
 * @returns Milliseconds since epoch, or `NaN` if the timestamp is invalid.
 */
export function progressTimestampToMs(timestamp: string): number {
  // Progress timestamps are UTC: "YYYY-MM-DD HH:MM"
  // Validate format before parsing to avoid JS Date quirks with garbage input
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(timestamp)) return NaN;
  return new Date(timestamp.replace(' ', 'T') + ':00Z').getTime();
}

/** Statuses that indicate a successfully completed ticket. */
const COMPLETED_STATUSES = new Set([
  'DONE',
  'PR_CREATED',
  'PUSHED',
  'EPIC_PR_CREATED',
  'RESUMED',
]);

/** Statuses that indicate a failed/skipped ticket. */
const FAILED_STATUSES = new Set(['SKIPPED', 'PUSH_FAILED', 'TIME_LIMIT']);

/**
 * Generate a session report from progress.txt and costs.log entries
 * created during this AFK session.
 *
 * @param projectRoot - The project root directory.
 * @param loopStartTime - When the AFK loop started (Date.now()).
 * @param loopEndTime - When the AFK loop ended.
 * @returns The report markdown string.
 */
export function generateSessionReport(
  projectRoot: string,
  loopStartTime: number,
  loopEndTime: number,
): string {
  // 1. Read progress.txt, filter entries with timestamp >= loopStart
  // Round loopStart down to the minute to match progress file precision (YYYY-MM-DD HH:MM)
  const loopStartMinute = Math.floor(loopStartTime / 60000) * 60000;
  const allProgress = parseProgressFile(projectRoot);
  const sessionEntries = allProgress.filter((entry) => {
    const entryMs = progressTimestampToMs(entry.timestamp);
    return !Number.isNaN(entryMs) && entryMs >= loopStartMinute;
  });

  // 2. Read costs.log, filter entries with timestamp >= loopStart
  const costEntries = parseCostsLog(projectRoot, loopStartTime);

  // 3. Build a cost lookup by ticket key
  const costByKey = new Map<string, CostEntry>();
  for (const cost of costEntries) {
    costByKey.set(cost.key, cost);
  }

  // 4. Deduplicate progress entries — keep latest per key (for rework cycles)
  const latestByKey = new Map<string, ProgressEntry>();
  for (const entry of sessionEntries) {
    latestByKey.set(entry.key, entry);
  }

  // 5. Build session tickets
  const tickets: SessionTicket[] = [];
  for (const entry of latestByKey.values()) {
    const cost = costByKey.get(entry.key);
    tickets.push({
      key: entry.key,
      summary: entry.summary,
      status: entry.status,
      ...(entry.prNumber != null && { prNumber: entry.prNumber }),
      ...(cost && { duration: cost.duration, tokens: cost.tokens }),
    });
  }

  // 6. Count completed vs failed
  const completed = tickets.filter((t) => COMPLETED_STATUSES.has(t.status));
  const failed = tickets.filter((t) => FAILED_STATUSES.has(t.status));
  const totalDuration = formatDuration(loopEndTime - loopStartTime);

  // 7. Calculate total estimated tokens
  let totalTokens = 0;
  for (const cost of costEntries) {
    const match = cost.tokens.match(/~(\d[\d,]*)/);
    if (match) {
      totalTokens += parseInt(match[1]!.replace(/,/g, ''), 10);
    }
  }

  // 8. Format the date
  const date = new Date(loopStartTime);
  const dateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

  // 9. Generate markdown
  const lines: string[] = [];
  lines.push(`# AFK Session Report — ${dateStr}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Tickets completed: ${completed.length}`);
  lines.push(`- Tickets failed: ${failed.length}`);
  lines.push(`- Total duration: ${totalDuration}`);
  if (totalTokens > 0) {
    lines.push(
      `- Estimated token usage: ${totalTokens.toLocaleString('en-US')}`,
    );
  }
  lines.push('');
  lines.push('## Tickets');

  if (tickets.length === 0) {
    lines.push('');
    lines.push('No tickets were processed in this session.');
  }

  for (const ticket of tickets) {
    const isCompleted = COMPLETED_STATUSES.has(ticket.status);
    const icon = isCompleted ? '\u2713' : '\u2717';
    lines.push('');
    lines.push(`### ${icon} ${ticket.key} — ${ticket.summary}`);
    if (ticket.duration) {
      lines.push(`- Duration: ${ticket.duration}`);
    }
    if (ticket.tokens) {
      lines.push(`- Tokens: ${ticket.tokens}`);
    }
    if (ticket.prNumber != null) {
      lines.push(`- PR: #${ticket.prNumber}`);
    }
    lines.push(`- Status: ${ticket.status}`);
  }

  // 10. Next Steps
  const prNumbers = tickets
    .filter((t) => t.prNumber != null)
    .map((t) => `#${t.prNumber}`);
  const skippedKeys = failed.map((t) => t.key);

  if (prNumbers.length > 0 || skippedKeys.length > 0) {
    lines.push('');
    lines.push('## Next Steps');
    if (prNumbers.length > 0) {
      lines.push(`- Review PRs ${prNumbers.join(', ')}`);
    }
    for (const key of skippedKeys) {
      lines.push(`- ${key} needs manual intervention`);
    }
  }

  // Quality metrics (best-effort)
  try {
    const quality = getQualityData(projectRoot);
    if (quality) {
      lines.push('');
      lines.push('## Quality Metrics');
      lines.push(`- Avg rework cycles: ${quality.summary.avgReworkCycles}`);
      lines.push(
        `- Avg verification retries: ${quality.summary.avgVerificationRetries}`,
      );
      if (quality.summary.avgDuration > 0) {
        lines.push(
          `- Avg delivery time: ${formatDuration(quality.summary.avgDuration)}`,
        );
      }
    }
  } catch {
    // Best-effort — skip quality section if data is unavailable
  }

  lines.push('');

  const report = lines.join('\n');

  // 11. Write to .clancy/session-report.md (best-effort)
  try {
    const reportPath = join(projectRoot, '.clancy', 'session-report.md');
    mkdirSync(join(projectRoot, '.clancy'), { recursive: true });
    writeFileSync(reportPath, report, 'utf8');
  } catch {
    // Best-effort — report is still returned for stdout
  }

  return report;
}
