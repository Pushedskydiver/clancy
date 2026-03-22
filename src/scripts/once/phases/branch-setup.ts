/**
 * Phase 7: Branch setup — git branch operations (epic branch, standalone, rework)
 * and lock file creation.
 *
 * Sets `ctx.originalBranch`, `ctx.skipEpicBranch`, `ctx.effectiveTarget`, `ctx.lockOwner`.
 * Returns `true` to continue, `false` for early exit (branch setup failed).
 */
import {
  checkout,
  currentBranch,
  ensureBranch,
  fetchRemoteBranch,
} from '~/scripts/shared/git-ops/git-ops.js';
import { dim } from '~/utils/ansi/ansi.js';

import type { RunContext } from '../context/context.js';
import { ensureEpicBranch } from '../deliver/deliver.js';
import { writeLock } from '../lock/lock.js';

export async function branchSetup(ctx: RunContext): Promise<boolean> {
  const board = ctx.board!;
  const ticket = ctx.ticket!;
  const ticketBranch = ctx.ticketBranch!;
  const targetBranch = ctx.targetBranch!;
  const baseBranch = ctx.baseBranch!;
  const hasParent = ctx.hasParent!;
  const isRework = ctx.isRework ?? false;

  ctx.originalBranch = currentBranch();

  // Single-child skip: if epic has exactly 1 child and this is it,
  // skip the epic branch and deliver directly to base.
  let skipEpicBranch = false;
  if (hasParent && !isRework) {
    // parentInfo is the parent identifier (e.g. 'ENG-42' for Linear).
    // linearIssueId is the CHILD's UUID — not ideal as parentId, but the
    // Board wrapper handles this: it uses parentInfo for Epic: text search
    // (which works) and falls back to native API only if a real parent UUID
    // is available. The text search path is the primary detection method.
    const childrenStatus = await board.fetchChildrenStatus(
      ticket.parentInfo,
      ticket.linearIssueId,
      ticket.key,
    );
    if (childrenStatus && childrenStatus.total === 1) {
      skipEpicBranch = true;
    }
  }

  ctx.skipEpicBranch = skipEpicBranch;

  // Effective target: epic branch (parented) or base branch (standalone/single-child)
  const effectiveTarget =
    hasParent && !skipEpicBranch ? targetBranch : baseBranch;

  ctx.effectiveTarget = effectiveTarget;

  if (isRework) {
    // PR-flow rework: try to fetch the existing feature branch from remote
    if (hasParent && !skipEpicBranch) {
      // Ensure epic branch exists for rework targeting it
      const epicReady = ensureEpicBranch(targetBranch, baseBranch);
      if (!epicReady) {
        if (ctx.originalBranch) checkout(ctx.originalBranch);
        return false;
      }
    } else {
      ensureBranch(effectiveTarget, baseBranch);
    }
    const fetched = fetchRemoteBranch(ticketBranch);

    if (fetched) {
      checkout(ticketBranch);
    } else {
      checkout(effectiveTarget);
      checkout(ticketBranch, true);
    }
  } else if (hasParent && !skipEpicBranch) {
    // Epic branch flow: ensure epic branch, create feature from it
    const epicReady = ensureEpicBranch(targetBranch, baseBranch);
    if (!epicReady) {
      if (ctx.originalBranch) checkout(ctx.originalBranch);
      return false;
    }
    checkout(targetBranch);
    checkout(ticketBranch, true);
  } else {
    // Standalone or single-child: branch from base
    ensureBranch(baseBranch, baseBranch);
    checkout(baseBranch);
    checkout(ticketBranch, true);
  }

  // Write lock file — branch is now known
  try {
    writeLock(ctx.cwd, {
      pid: process.pid,
      ticketKey: ticket.key,
      ticketTitle: ticket.title,
      ticketBranch: ticketBranch,
      targetBranch: effectiveTarget,
      parentKey: ticket.parentInfo,
      description: (ticket.description ?? '').slice(0, 2000),
      startedAt: new Date().toISOString(),
    });
    ctx.lockOwner = true;
  } catch {
    // Best-effort — continue without crash protection
    console.log(
      dim('  (warning: could not write lock file — crash recovery disabled)'),
    );
  }

  return true;
}
