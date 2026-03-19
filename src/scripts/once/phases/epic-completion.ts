/**
 * Phase 2: Epic completion — scan progress for completed epics and auto-create epic PRs.
 *
 * Best-effort (wrapped in try/catch). Always returns `true`.
 */
import { computeTargetBranch } from '~/scripts/shared/branch/branch.js';
import { findEntriesWithStatus } from '~/scripts/shared/progress/progress.js';
import { green, yellow } from '~/utils/ansi/ansi.js';

import { fetchEpicChildrenStatus } from '../board-ops/board-ops.js';
import type { RunContext } from '../context/context.js';
import { deliverEpicToBase } from '../deliver/deliver.js';

export async function epicCompletion(ctx: RunContext): Promise<boolean> {
  const config = ctx.config!;

  try {
    const prEntries = findEntriesWithStatus(ctx.cwd, 'PR_CREATED');
    const reworkEntries = findEntriesWithStatus(ctx.cwd, 'REWORK');
    const pushedEntries = findEntriesWithStatus(ctx.cwd, 'PUSHED');
    const allEntries = [...prEntries, ...reworkEntries, ...pushedEntries];

    // Skip epics that already have an EPIC_PR_CREATED entry
    const epicDone = new Set(
      findEntriesWithStatus(ctx.cwd, 'EPIC_PR_CREATED').map((e) => e.key),
    );

    const parentKeys = new Set(
      allEntries
        .map((e) => e.parent)
        .filter((p): p is string => Boolean(p))
        .filter((p) => !epicDone.has(p)),
    );
    const baseBranch = config.env.CLANCY_BASE_BRANCH ?? 'main';

    for (const parentKey of parentKeys) {
      const status = await fetchEpicChildrenStatus(config, parentKey);
      if (status && status.incomplete === 0 && status.total > 0) {
        const epicBranch = computeTargetBranch(
          config.provider,
          baseBranch,
          parentKey,
        );

        const epicOk = await deliverEpicToBase(
          config,
          parentKey,
          parentKey, // title fallback — see WARNING #4 in review
          epicBranch,
          baseBranch,
        );

        if (epicOk) {
          console.log(green(`  ✓ Epic ${parentKey} complete — PR created`));
        } else {
          console.log(
            yellow(
              `⚠ Epic PR creation failed for ${parentKey}. Create manually:\n` +
                `  git push origin ${epicBranch}\n` +
                `  Then create a PR targeting ${baseBranch}`,
            ),
          );
        }
      }
    }
  } catch {
    // Best-effort — epic completion check failure shouldn't block the run
  }

  return true;
}
