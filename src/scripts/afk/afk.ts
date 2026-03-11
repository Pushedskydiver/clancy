/**
 * Clancy AFK runner — loop mode.
 *
 * Runs the board-specific `clancy-once` script up to `MAX_ITERATIONS` times.
 * Detects stop conditions by parsing the script's stdout output.
 * Does NOT know about boards — board logic lives entirely in the once script.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
export function runAfkLoop(scriptDir: string, maxIterations = 5): void {
  const onceScript = join(scriptDir, 'clancy-once.js');

  if (!existsSync(onceScript)) {
    console.error('✗ clancy-once.js not found in', scriptDir);
    return;
  }

  for (let i = 1; i <= maxIterations; i++) {
    console.log(`\n── Iteration ${i}/${maxIterations} ──\n`);

    let output: string;

    try {
      output = execSync(`node "${onceScript}"`, {
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'inherit'],
        cwd: process.cwd(),
      });

      // Stream output to user
      process.stdout.write(output);
    } catch (error) {
      // Script may exit non-zero on some platforms
      output =
        error instanceof Error && 'stdout' in error
          ? String((error as { stdout: unknown }).stdout)
          : '';
    }

    const condition = checkStopCondition(output);

    if (condition.stop) {
      console.log(`\n${condition.reason}`);
      return;
    }

    // Brief pause between iterations
    if (i < maxIterations) {
      execSync('sleep 2');
    }
  }

  console.log(
    `\n── Completed ${maxIterations} iterations. Run clancy-afk again to continue. ──`,
  );
}
