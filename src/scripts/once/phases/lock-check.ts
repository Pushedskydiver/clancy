/**
 * Phase 0: Lock check — startup lock detection, stale cleanup, and resume logic.
 *
 * Returns `true` to continue, `false` for early exit (another session active, or resume completed).
 */
import { detectBoard } from '~/scripts/shared/env-schema/env-schema.js';
import { runPreflight } from '~/scripts/shared/preflight/preflight.js';
import { dim, green, yellow } from '~/utils/ansi/ansi.js';

import type { RunContext } from '../context/context.js';
import {
  deleteLock,
  deleteVerifyAttempt,
  isLockStale,
  readLock,
} from '../lock/lock.js';
import { detectResume, executeResume } from '../resume/resume.js';

export async function lockCheck(ctx: RunContext): Promise<boolean> {
  const existingLock = readLock(ctx.cwd);
  if (!existingLock) return true;

  if (!isLockStale(existingLock)) {
    // Another active session — abort
    console.log(
      yellow(
        `⚠ Another Clancy session is running (PID ${existingLock.pid}, ticket ${existingLock.ticketKey}). Aborting.`,
      ),
    );
    return false;
  }

  // Stale lock — clean up and check for resume
  console.log(
    dim(
      `  Stale lock found (PID ${existingLock.pid}, ticket ${existingLock.ticketKey}). Cleaning up...`,
    ),
  );
  deleteLock(ctx.cwd);
  deleteVerifyAttempt(ctx.cwd);

  // Resume detection — check if the ticket branch has recoverable work
  try {
    const resumeInfo = detectResume(existingLock);
    if (resumeInfo) {
      if (ctx.isAfk) {
        console.log(
          yellow(
            `  ↻ Resuming crashed session: ${existingLock.ticketKey} on ${resumeInfo.branch}`,
          ),
        );

        // Need board config for PR creation — run preflight + detect board
        const preflight = runPreflight(ctx.cwd);
        if (preflight.ok) {
          const boardResult = detectBoard(preflight.env!);
          if (typeof boardResult !== 'string') {
            const resumed = await executeResume(
              boardResult,
              existingLock,
              resumeInfo,
            );
            if (resumed) {
              console.log(green(`  ✓ Resumed ${existingLock.ticketKey}`));
              // Return after resume — one ticket per invocation.
              // The AFK runner will start the next iteration for a fresh ticket.
              return false;
            }
          }
        }
      } else {
        console.log(
          yellow(
            `  Found in-progress work on ${resumeInfo.branch}.` +
              (resumeInfo.hasUncommitted ? ' Has uncommitted changes.' : '') +
              (resumeInfo.hasUnpushed ? ' Has unpushed commits.' : ''),
          ),
        );
        console.log(
          dim(
            '  Run in AFK mode (CLANCY_AFK_MODE=1) to auto-resume, or handle manually.',
          ),
        );
      }
    }
  } catch {
    // Best-effort — resume detection failure shouldn't block the run
  }

  return true;
}
