/**
 * Clancy Context Monitor — PostToolUse hook.
 *
 * Reads context metrics from the bridge file written by the statusline hook
 * and injects warnings into Claude's conversation when context runs low.
 *
 * Thresholds:
 *   WARNING  (remaining <= 35%): wrap up analysis, move to implementation
 *   CRITICAL (remaining <= 25%): commit current work, log progress, stop
 *
 * Debounce: 5 tool uses between warnings; severity escalation bypasses debounce.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseJson } from '~/utils/parse-json/parse-json.js';

const WARNING_THRESHOLD = 35;
const CRITICAL_THRESHOLD = 25;
const STALE_SECONDS = 60;
const DEBOUNCE_CALLS = 5;

type BridgeMetrics = {
  session_id: string;
  remaining_percentage: number;
  used_pct: number;
  timestamp: number;
};

type DebounceState = {
  callsSinceWarn: number;
  lastLevel: 'warning' | 'critical' | null;
};

type ContextMonitorInput = {
  session_id?: string;
};

type ContextMonitorOutput = {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
};

/**
 * Build a warning message based on severity level.
 *
 * @param usedPct - The normalised context usage percentage.
 * @param remaining - The raw remaining context percentage.
 * @param isCritical - Whether the severity is critical (vs warning).
 * @returns The formatted warning or critical message string.
 */
function buildMessage(usedPct: number, remaining: number, isCritical: boolean): string {
  if (isCritical) {
    return (
      `CONTEXT CRITICAL: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
      'Context is nearly exhausted. Stop reading files and wrap up immediately:\n' +
      '1. Commit whatever work is staged on the current feature branch\n' +
      '2. Append a WIP entry to .clancy/progress.txt: ' +
      'YYYY-MM-DD HH:MM | TICKET-KEY | Summary | WIP — context exhausted\n' +
      '3. Inform the user what was completed and what remains.\n' +
      'Do NOT start any new work.'
    );
  }

  return (
    `CONTEXT WARNING: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
    'Context is getting limited. Stop exploring and move to implementation. ' +
    'Avoid reading additional files unless strictly necessary. ' +
    'Commit completed work as soon as it is ready.'
  );
}

/**
 * Run the context monitor check.
 *
 * @param raw - Raw JSON string from stdin containing `session_id`.
 * @returns A hook output object if a warning should be emitted, or `undefined` to stay silent.
 *
 * @example
 * ```ts
 * const output = runContextMonitor(JSON.stringify({ session_id: 'abc123' }));
 * // undefined (no warning) or { hookSpecificOutput: { ... } }
 * ```
 */
export function runContextMonitor(raw: string): ContextMonitorOutput | undefined {
  const data = parseJson<ContextMonitorInput>(raw);
  const session = data?.session_id;

  if (!session) return undefined;

  const bridgePath = join(tmpdir(), `clancy-ctx-${session}.json`);

  if (!existsSync(bridgePath)) return undefined;

  const metrics = parseJson<BridgeMetrics>(readFileSync(bridgePath, 'utf8'));

  if (!metrics) return undefined;

  const now = Math.floor(Date.now() / 1000);

  // Ignore stale metrics
  if (metrics.timestamp && now - metrics.timestamp > STALE_SECONDS) {
    return undefined;
  }

  const remaining = metrics.remaining_percentage;
  const usedPct = metrics.used_pct;

  if (remaining > WARNING_THRESHOLD) return undefined;

  // Debounce
  const warnPath = join(tmpdir(), `clancy-ctx-${session}-warned.json`);
  let warnData: DebounceState = { callsSinceWarn: 0, lastLevel: null };
  let firstWarn = true;

  if (existsSync(warnPath)) {
    const parsed = parseJson<DebounceState>(readFileSync(warnPath, 'utf8'));

    if (parsed) {
      warnData = parsed;
      firstWarn = false;
    }
  }

  warnData.callsSinceWarn = (warnData.callsSinceWarn || 0) + 1;

  const isCritical = remaining <= CRITICAL_THRESHOLD;
  const currentLevel = isCritical ? 'critical' : 'warning';
  const severityEscalated =
    currentLevel === 'critical' && warnData.lastLevel === 'warning';

  if (
    !firstWarn &&
    warnData.callsSinceWarn < DEBOUNCE_CALLS &&
    !severityEscalated
  ) {
    try {
      writeFileSync(warnPath, JSON.stringify(warnData));
    } catch {
      /* best-effort */
    }
    return undefined;
  }

  warnData.callsSinceWarn = 0;
  warnData.lastLevel = currentLevel;

  try {
    writeFileSync(warnPath, JSON.stringify(warnData));
  } catch {
    /* best-effort */
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: buildMessage(usedPct, remaining, isCritical),
    },
  };
}

// ── CLI entry point ──────────────────────────────────────────────────────────

const isDirectRun = process.argv[1]?.includes('context-monitor');

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
      const result = runContextMonitor(input);

      if (result) {
        process.stdout.write(JSON.stringify(result));
      }
    } catch {
      /* best-effort */
    }
  });
}
