/**
 * Clancy AFK runner — loop mode.
 *
 * Runs the board-specific `clancy-once` script up to `MAX_ITERATIONS` times.
 * Detects stop conditions by parsing the script's stdout output.
 * Does NOT know about boards — board logic lives entirely in the once script.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { formatDuration } from '~/scripts/shared/format/format.js';
import { bold, dim, green, red } from '~/utils/ansi/ansi.js';

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

/**
 * Run the AFK loop.
 *
 * Executes the `clancy-once` script repeatedly up to `maxIterations` times,
 * checking for stop conditions after each run.
 *
 * @param scriptDir - The directory containing `clancy-once.js`.
 * @param maxIterations - Maximum number of iterations (default: 5).
 */
export async function runAfkLoop(
  scriptDir: string,
  maxIterations = 5,
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
    const iterStart = Date.now();
    console.log('');
    console.log(bold(`🔁 Iteration ${i}/${maxIterations}`));

    // stderr is inherited so errors are visible to the user in real time.
    // Exit codes are not checked — once.ts always exits 0 by design so that
    // a transient failure in one iteration does not halt the entire AFK run.
    // Stop conditions are explicit board-level signals parsed from stdout.
    const result = spawnSync('node', [onceScript], {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
      cwd: process.cwd(),
      env: { ...process.env, CLANCY_AFK_MODE: '1' },
    });

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
