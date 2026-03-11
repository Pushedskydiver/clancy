/**
 * Clancy Statusline hook — registered as the Claude Code statusline.
 *
 * Two jobs:
 *   1. Write context metrics to a bridge file so the PostToolUse context
 *      monitor can read them (the statusline is the only hook that receives
 *      context_window data directly).
 *   2. Output a statusline string showing context usage and update status.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseJson } from '~/utils/parse-json/parse-json.js';

/** Claude Code reserves ~16.5% of context for its autocompact buffer. */
const AUTO_COMPACT_BUFFER_PCT = 16.5;

type StatuslineInput = {
  session_id?: string;
  context_window?: {
    remaining_percentage?: number;
  };
};

/**
 * Normalise the raw remaining percentage to account for autocompact buffer.
 *
 * @param rawRemaining - The raw remaining percentage from Claude Code (0–100).
 * @returns The normalised usage percentage (0–100), clamped and rounded.
 *
 * @example
 * ```ts
 * normaliseUsage(100);   // 0   (fully available)
 * normaliseUsage(58.25); // 50  (half used)
 * normaliseUsage(16.5);  // 100 (at autocompact boundary)
 * ```
 */
export function normaliseUsage(rawRemaining: number): number {
  const usableRemaining =
    Math.max(
      0,
      ((rawRemaining - AUTO_COMPACT_BUFFER_PCT) /
        (100 - AUTO_COMPACT_BUFFER_PCT)) *
        100,
    );

  return Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
}

/**
 * Write bridge file for the context monitor PostToolUse hook.
 *
 * @param session - The Claude Code session ID.
 * @param remaining - The raw remaining context percentage.
 * @param usedPct - The normalised usage percentage.
 */
function writeBridgeFile(
  session: string,
  remaining: number,
  usedPct: number,
): void {
  try {
    const bridgePath = join(tmpdir(), `clancy-ctx-${session}.json`);

    writeFileSync(
      bridgePath,
      JSON.stringify({
        session_id: session,
        remaining_percentage: remaining,
        used_pct: usedPct,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    );
  } catch {
    /* bridge is best-effort */
  }
}

/**
 * Build the context usage bar with colour coding.
 *
 * @param used - The normalised usage percentage (0–100).
 * @returns An ANSI-coloured progress bar string with percentage label.
 *
 * @example
 * ```ts
 * buildContextBar(30);  // green:  "███░░░░░░░ 30%"
 * buildContextBar(55);  // yellow: "█████░░░░░ 55%"
 * buildContextBar(85);  // red:    "💀 ████████░░ 85%"
 * ```
 */
export function buildContextBar(used: number): string {
  const filled = Math.floor(used / 10);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);

  if (used < 50) return `\x1b[32m${bar} ${used}%\x1b[0m`;
  if (used < 65) return `\x1b[33m${bar} ${used}%\x1b[0m`;
  if (used < 80) return `\x1b[38;5;208m${bar} ${used}%\x1b[0m`;

  return `\x1b[5;31m\uD83D\uDC80 ${bar} ${used}%\x1b[0m`;
}

/**
 * Build the full statusline string.
 *
 * @param raw - Raw JSON string from stdin containing session and context data.
 * @returns The formatted statusline string with ANSI colour codes.
 *
 * @example
 * ```ts
 * buildStatusline(JSON.stringify({
 *   session_id: 'abc123',
 *   context_window: { remaining_percentage: 80 },
 * }));
 * // "Clancy ██░░░░░░░░ 24%"
 * ```
 */
export function buildStatusline(raw: string): string {
  const data = parseJson<StatuslineInput>(raw);

  if (!data) return '\x1b[2mClancy\x1b[0m';

  const session = data.session_id ?? '';
  const remaining = data.context_window?.remaining_percentage;

  // Write bridge file for context monitor
  if (session && remaining != null) {
    const used = normaliseUsage(remaining);
    writeBridgeFile(session, remaining, used);
  }

  const parts: string[] = [];

  // Check for available update
  const claudeDir =
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const cacheFile = join(claudeDir, 'cache', 'clancy-update-check.json');

  try {
    const cache = parseJson<{ update_available?: boolean }>(
      readFileSync(cacheFile, 'utf8'),
    );

    if (cache?.update_available) {
      parts.push('\x1b[33m\u2B06 /clancy:update\x1b[0m');
    }
  } catch {
    /* cache missing is normal */
  }

  // Context bar
  if (remaining != null) {
    const used = normaliseUsage(remaining);
    parts.push(`\x1b[2mClancy\x1b[0m ${buildContextBar(used)}`);
  } else {
    parts.push('\x1b[2mClancy\x1b[0m');
  }

  return parts.join(' \u2502 ');
}

// ── CLI entry point ──────────────────────────────────────────────────────────

const isDirectRun = process.argv[1]?.includes('statusline');

if (isDirectRun) {
  let input = '';
  const stdinTimeout = setTimeout(() => process.exit(0), 3000);

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);

    try {
      process.stdout.write(buildStatusline(input));
    } catch {
      /* best-effort */
    }
  });
}
