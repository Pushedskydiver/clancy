/**
 * Unified once orchestrator — replaces all three `clancy-once-*.sh` scripts.
 *
 * Full lifecycle: lock check → preflight → detect board → [epic completion check] →
 * fetch ticket → compute branches → [dry-run gate] → feasibility check →
 * create branch → write lock → transition In Progress → invoke Claude → push + PR →
 * cost log → delete lock → notify.
 *
 * All errors exit with code 0 (not 1). This is intentional — the AFK runner
 * detects stop conditions by parsing stdout, not exit codes.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatDuration } from '~/scripts/shared/format/format.js';
import { checkout } from '~/scripts/shared/git-ops/git-ops.js';
import { dim, red } from '~/utils/ansi/ansi.js';

import { createContext } from './context/context.js';
import { deleteLock, deleteVerifyAttempt } from './lock/lock.js';
import { branchSetup } from './phases/branch-setup.js';
import { cleanup } from './phases/cleanup.js';
import { cost } from './phases/cost.js';
import { deliver } from './phases/deliver.js';
import { dryRun } from './phases/dry-run.js';
import { epicCompletion } from './phases/epic-completion.js';
import { feasibility } from './phases/feasibility.js';
import { invoke } from './phases/invoke.js';
import { lockCheck } from './phases/lock-check.js';
import { preflight } from './phases/preflight.js';
import { reworkDetection } from './phases/rework-detection.js';
import { ticketFetch } from './phases/ticket-fetch.js';
import { transition } from './phases/transition.js';

// ─── Main orchestrator ───────────────────────────────────────────────────────

/**
 * Run the once orchestrator — full ticket lifecycle.
 *
 * @param argv - Process arguments (supports `--dry-run` flag).
 *
 * @example
 * ```ts
 * await run(process.argv);
 * ```
 */
export async function run(argv: string[]): Promise<void> {
  const ctx = createContext(argv);

  // Phase 0: Lock check + resume
  if (!(await lockCheck(ctx))) return;

  try {
    // Phase 1: Preflight + board detection
    if (!(await preflight(ctx))) return;
    // Phase 2: Epic completion check
    if (!(await epicCompletion(ctx))) return;
    // Phase 3: Rework detection
    if (!(await reworkDetection(ctx))) return;
    // Phase 4: Ticket fetch + branch computation + ticket info
    if (!(await ticketFetch(ctx))) return;
    // Phase 5: Dry-run gate
    if (!dryRun(ctx)) return;
    // Phase 6: Feasibility check
    if (!feasibility(ctx)) return;
    // Phase 7: Branch setup + lock write
    if (!(await branchSetup(ctx))) return;
    // Phase 8: Transition to In Progress
    if (!(await transition(ctx))) return;
    // Phase 9: Invoke Claude session
    if (!invoke(ctx)) return;
    // Phase 10: Deliver via PR
    if (!(await deliver(ctx))) return;
    // Phase 11: Cost logging
    cost(ctx);
    // Phase 12: Cleanup + notification
    await cleanup(ctx);
  } catch (error) {
    // Unexpected errors — print and exit cleanly (exit 0 for AFK loop compat)
    const msg = error instanceof Error ? error.message : String(error);
    const elapsed = formatDuration(Date.now() - ctx.startTime);
    console.error('');
    console.error(red(`❌ Clancy stopped`) + dim(` (${elapsed})`));
    console.error(red(`   ${msg}`));
    console.error(dim('  "I\'d rather let Herman go."'));

    // Best-effort: restore the branch the user was on before Clancy started
    if (ctx.originalBranch) {
      try {
        checkout(ctx.originalBranch);
      } catch {
        // Ignore — branch restore is best-effort
      }
    }
  } finally {
    // Clean up lock + verify-attempt in ALL exit paths (only if we created them)
    if (ctx.lockOwner) {
      deleteLock(ctx.cwd);
      deleteVerifyAttempt(ctx.cwd);
    }
  }
}

// Main guard — self-execute when run directly (e.g. node .clancy/clancy-once.js)
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  run(process.argv);
}
