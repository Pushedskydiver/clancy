/**
 * Clancy AFK runner — loop mode.
 *
 * Runs the board-specific `clancy-once` script up to `MAX_ITERATIONS` times.
 * Detects stop conditions by parsing the script's stdout output.
 * Does NOT know about boards — board logic lives entirely in the once script.
 */
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { formatDuration } from '~/scripts/shared/format/format.js';
import { sendNotification } from '~/scripts/shared/notify/notify.js';
import { bold, dim, green, red, yellow } from '~/utils/ansi/ansi.js';

import { generateSessionReport } from './report/report.js';

/**
 * Parse a time string in HH:MM format to { hours, minutes }.
 * Returns null if the format is invalid.
 */
export function parseTime(
  value: string,
): { hours: number; minutes: number } | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Check if the current time falls within the quiet hours window.
 * Returns the number of milliseconds to sleep, or 0 if not in quiet hours.
 *
 * Handles overnight windows (e.g. 22:00-06:00).
 *
 * @param startStr - Start time in HH:MM format (e.g. "22:00")
 * @param endStr - End time in HH:MM format (e.g. "06:00")
 * @param now - Current date (default: new Date())
 */
let quietHoursWarned = false;

export function getQuietSleepMs(
  startStr: string,
  endStr: string,
  now: Date = new Date(),
): number {
  const start = parseTime(startStr);
  const end = parseTime(endStr);

  if (!start || !end) {
    if (!quietHoursWarned) {
      console.warn(
        '⚠ Invalid quiet hours format. Expected HH:MM (24h). Quiet hours disabled.',
      );
      quietHoursWarned = true;
    }
    return 0;
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = start.hours * 60 + start.minutes;
  const endMin = end.hours * 60 + end.minutes;

  let inQuiet = false;

  if (startMin < endMin) {
    // Same-day window (e.g. 09:00–17:00)
    inQuiet = nowMin >= startMin && nowMin < endMin;
  } else if (startMin > endMin) {
    // Overnight window (e.g. 22:00–06:00)
    inQuiet = nowMin >= startMin || nowMin < endMin;
  }
  // startMin === endMin → 24h quiet (nonsensical), skip

  if (!inQuiet) return 0;

  // Calculate ms until end of quiet window
  let minutesUntilEnd = endMin - nowMin;
  if (minutesUntilEnd <= 0) minutesUntilEnd += 24 * 60;

  // Subtract seconds and milliseconds already past the current minute
  const msIntoMinute = now.getSeconds() * 1000 + now.getMilliseconds();
  return Math.max(0, minutesUntilEnd * 60000 - msIntoMinute);
}

/** Stop condition patterns matched against script output. */
const STOP_PATTERNS = {
  noTickets: /No tickets found|No issues found|All done/,
  skipped: /Ticket skipped/,
  preflightFail: /^✗ /m,
};

/**
 * Check whether the script output contains a stop condition.
 *
 * @param output - The captured stdout from a `clancy-once` run.
 * @returns An object with `stop` flag and optional `reason`.
 */
export function checkStopCondition(output: string): {
  stop: boolean;
  reason?: string;
} {
  if (STOP_PATTERNS.noTickets.test(output)) {
    return { stop: true, reason: 'No more tickets — all done' };
  }

  if (STOP_PATTERNS.skipped.test(output)) {
    return {
      stop: true,
      reason: 'Ticket was skipped — update the ticket and re-run',
    };
  }

  if (STOP_PATTERNS.preflightFail.test(output)) {
    return { stop: true, reason: 'Preflight check failed' };
  }

  return { stop: false };
}

/** Result shape returned by the once runner — subset of spawnSync output. */
export type OnceRunnerResult = Pick<
  SpawnSyncReturns<string>,
  'stdout' | 'error'
>;

/** Function that executes a single once iteration. Async to support in-process runners. */
export type OnceRunner = (
  onceScript: string,
) => OnceRunnerResult | Promise<OnceRunnerResult>;

/** Default runner — spawns clancy-once.js as a child process. */
function defaultRunner(onceScript: string): OnceRunnerResult {
  return spawnSync('node', [onceScript], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
    cwd: process.cwd(),
    env: { ...process.env, CLANCY_AFK_MODE: '1' },
  });
}

/**
 * Run the AFK loop.
 *
 * Executes the `clancy-once` script repeatedly up to `maxIterations` times,
 * checking for stop conditions after each run.
 *
 * @param scriptDir - The directory containing `clancy-once.js`.
 * @param maxIterations - Maximum number of iterations (default: 5).
 * @param runner - Optional runner function for executing once iterations.
 *   Defaults to spawning `clancy-once.js` as a child process.
 *   Integration tests inject a custom runner to call `run()` in-process.
 */
export async function runAfkLoop(
  scriptDir: string,
  maxIterations = 5,
  runner: OnceRunner = defaultRunner,
): Promise<void> {
  const onceScript = join(scriptDir, 'clancy-once.js');

  if (!existsSync(onceScript)) {
    console.error(red('✗ clancy-once.js not found in'), scriptDir);
    return;
  }

  console.log(
    dim('┌──────────────────────────────────────────────────────────┐'),
  );
  console.log(
    dim('│') +
      bold('  🤖 Clancy — AFK mode                                  ') +
      dim('│'),
  );
  console.log(
    dim('│') +
      dim('  "I\'m on it. Proceed to the abandoned warehouse."       ') +
      dim('│'),
  );
  console.log(
    dim('└──────────────────────────────────────────────────────────┘'),
  );

  const loopStart = Date.now();

  for (let i = 1; i <= maxIterations; i++) {
    // ── Quiet hours check ────────────────────────────────────────
    const quietStart = process.env.CLANCY_QUIET_START;
    const quietEnd = process.env.CLANCY_QUIET_END;

    if (quietStart && quietEnd) {
      const sleepMs = getQuietSleepMs(quietStart, quietEnd);
      if (sleepMs > 0) {
        const sleepMin = Math.ceil(sleepMs / 60000);
        console.log('');
        console.log(
          yellow(
            `⏸ Quiet hours active (${quietStart}–${quietEnd}). Sleeping ${sleepMin} minutes until ${quietEnd}.`,
          ),
        );
        await sleep(sleepMs);
        console.log(dim('  Quiet hours ended. Resuming.'));
      }
    } else if ((quietStart && !quietEnd) || (!quietStart && quietEnd)) {
      console.log(
        dim(
          '  ⚠ Only one of CLANCY_QUIET_START / CLANCY_QUIET_END is set — skipping quiet hours check.',
        ),
      );
    }

    const iterStart = Date.now();
    console.log('');
    console.log(bold(`🔁 Iteration ${i}/${maxIterations}`));

    // Exit codes are not checked — once.ts always exits 0 by design so that
    // a transient failure in one iteration does not halt the entire AFK run.
    // Stop conditions are explicit board-level signals parsed from stdout.
    const result = await runner(onceScript);

    const output = result.stdout ?? '';

    if (output) {
      process.stdout.write(output);
    }

    const iterElapsed = formatDuration(Date.now() - iterStart);

    if (result.error) {
      console.error(
        red(`✗ Failed to run clancy-once: ${result.error.message}`),
      );
      return;
    }

    const condition = checkStopCondition(output);

    if (condition.stop) {
      const totalElapsed = formatDuration(Date.now() - loopStart);
      console.log('');
      console.log(dim(`  Iteration ${i} took ${iterElapsed}`));
      console.log(`\n${condition.reason}`);
      console.log(
        dim(`  Total: ${i} iteration${i > 1 ? 's' : ''} in ${totalElapsed}`),
      );
      generateAndSendReport(loopStart);
      return;
    }

    console.log(dim(`  Iteration ${i} took ${iterElapsed}`));

    // Brief pause between iterations
    if (i < maxIterations) {
      await sleep(2000);
    }
  }

  const totalElapsed = formatDuration(Date.now() - loopStart);
  console.log('');
  console.log(
    green(`🏁 Completed ${maxIterations} iterations`) +
      dim(` (${totalElapsed})`),
  );
  console.log(dim('  "That\'s some good police work."'));
  console.log(dim('  Run clancy-afk again to continue.'));

  generateAndSendReport(loopStart);
}

/**
 * Generate a session report and optionally send a webhook notification.
 */
function generateAndSendReport(loopStart: number): void {
  try {
    const report = generateSessionReport(process.cwd(), loopStart, Date.now());
    console.log('');
    console.log(dim('─── Session Report ───'));
    console.log(report);

    const webhook = process.env.CLANCY_NOTIFY_WEBHOOK;
    if (webhook) {
      const lines = report.split('\n');
      const summaryLines = lines.filter(
        (l) => l.startsWith('- Tickets') || l.startsWith('- Total'),
      );
      const summary = `Clancy AFK: ${summaryLines.join('. ')}. Report: .clancy/session-report.md`;
      sendNotification(webhook, summary).catch(() => {
        // Best-effort — webhook failure shouldn't crash
      });
    }
  } catch {
    // Best-effort — report generation failure shouldn't crash the loop
  }
}

// Main guard — self-execute when run directly (e.g. node .clancy/clancy-afk.js)
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const maxIterations = parseInt(process.env.MAX_ITERATIONS ?? '5', 10) || 5;
  runAfkLoop(scriptDir, maxIterations);
}
