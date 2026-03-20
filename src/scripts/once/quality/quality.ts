/**
 * Quality feedback tracking.
 *
 * Tracks per-ticket quality metrics: rework cycles, verification retries,
 * and delivery duration. Persisted to `.clancy/quality.json`.
 *
 * All operations are best-effort — errors are swallowed to avoid crashing
 * the orchestrator.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Quality metrics for a single ticket. */
export type QualityEntry = {
  reworkCycles: number;
  verificationRetries: number;
  deliveredAt?: string;
  duration?: number;
};

/** Aggregate quality data across all tracked tickets. */
export type QualityData = {
  tickets: Record<string, QualityEntry>;
  summary: {
    totalTickets: number;
    avgReworkCycles: number;
    avgVerificationRetries: number;
    avgDuration: number;
  };
};

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Resolve the quality.json file path. */
function qualityPath(projectRoot: string): string {
  return join(projectRoot, '.clancy', 'quality.json');
}

/** Read and parse quality.json. Returns empty data if file doesn't exist. */
export function readQualityData(projectRoot: string): QualityData {
  try {
    const raw = readFileSync(qualityPath(projectRoot), 'utf8');
    const parsed = JSON.parse(raw) as QualityData;

    // Validate basic structure
    if (
      parsed &&
      typeof parsed.tickets === 'object' &&
      parsed.tickets !== null &&
      !Array.isArray(parsed.tickets)
    ) {
      // Recompute summary from ticket data to handle stale/corrupted summaries
      recomputeSummary(parsed);
      return parsed;
    }
  } catch {
    // File doesn't exist or is corrupted — start fresh
  }

  return {
    tickets: {},
    summary: {
      totalTickets: 0,
      avgReworkCycles: 0,
      avgVerificationRetries: 0,
      avgDuration: 0,
    },
  };
}

/** Recompute summary stats from ticket entries. */
function recomputeSummary(data: QualityData): void {
  const entries = Object.values(data.tickets);
  const total = entries.length;

  if (total === 0) {
    data.summary = {
      totalTickets: 0,
      avgReworkCycles: 0,
      avgVerificationRetries: 0,
      avgDuration: 0,
    };
    return;
  }

  let totalRework = 0;
  let totalRetries = 0;
  let totalDuration = 0;
  let durationCount = 0;

  for (const entry of entries) {
    totalRework += entry.reworkCycles;
    totalRetries += entry.verificationRetries;
    if (entry.duration != null) {
      totalDuration += entry.duration;
      durationCount++;
    }
  }

  data.summary = {
    totalTickets: total,
    avgReworkCycles: Math.round((totalRework / total) * 100) / 100,
    avgVerificationRetries: Math.round((totalRetries / total) * 100) / 100,
    avgDuration:
      durationCount > 0
        ? Math.round((totalDuration / durationCount) * 100) / 100
        : 0,
  };
}

/** Write quality data using atomic write (temp file + rename). */
function writeQualityData(projectRoot: string, data: QualityData): void {
  const filePath = qualityPath(projectRoot);
  const tmpPath = filePath + '.tmp';

  mkdirSync(join(projectRoot, '.clancy'), { recursive: true });
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmpPath, filePath);
}

/** Ensure a ticket entry exists, creating a default if needed. */
function ensureEntry(data: QualityData, ticketKey: string): QualityEntry {
  if (!data.tickets[ticketKey]) {
    data.tickets[ticketKey] = {
      reworkCycles: 0,
      verificationRetries: 0,
    };
  }
  return data.tickets[ticketKey];
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a rework cycle for a ticket.
 *
 * Increments the rework counter. Called when rework is detected from PR review.
 *
 * @param projectRoot - The project root directory.
 * @param ticketKey - The ticket identifier (e.g., 'PROJ-42', '#12').
 */
export function recordRework(projectRoot: string, ticketKey: string): void {
  try {
    const data = readQualityData(projectRoot);
    const entry = ensureEntry(data, ticketKey);
    entry.reworkCycles++;
    recomputeSummary(data);
    writeQualityData(projectRoot, data);
  } catch {
    // Best-effort — never crash the orchestrator
  }
}

/**
 * Record a verification retry for a ticket.
 *
 * Sets the verification retry count. Called after the verification
 * gate completes (successful or not).
 *
 * @param projectRoot - The project root directory.
 * @param ticketKey - The ticket identifier.
 * @param retries - The number of verification retries that occurred.
 */
export function recordVerificationRetry(
  projectRoot: string,
  ticketKey: string,
  retries: number,
): void {
  try {
    const data = readQualityData(projectRoot);
    const entry = ensureEntry(data, ticketKey);
    entry.verificationRetries = retries;
    recomputeSummary(data);
    writeQualityData(projectRoot, data);
  } catch {
    // Best-effort
  }
}

/**
 * Record successful delivery of a ticket.
 *
 * Sets the delivery timestamp and duration. Called after successful PR creation.
 *
 * @param projectRoot - The project root directory.
 * @param ticketKey - The ticket identifier.
 * @param duration - Time from ticket pickup to delivery, in milliseconds.
 */
export function recordDelivery(
  projectRoot: string,
  ticketKey: string,
  duration: number,
): void {
  try {
    const data = readQualityData(projectRoot);
    const entry = ensureEntry(data, ticketKey);
    entry.deliveredAt = new Date().toISOString();
    entry.duration = duration;
    recomputeSummary(data);
    writeQualityData(projectRoot, data);
  } catch {
    // Best-effort
  }
}

/**
 * Read quality data for reporting.
 *
 * @param projectRoot - The project root directory.
 * @returns The quality data, or `undefined` if no data exists.
 */
export function getQualityData(projectRoot: string): QualityData | undefined {
  const data = readQualityData(projectRoot);
  if (Object.keys(data.tickets).length === 0) return undefined;
  return data;
}
