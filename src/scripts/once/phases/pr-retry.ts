/**
 * Phase 2a: PR retry — retries PR creation for tickets that were pushed
 * but failed to create a PR (PUSHED status without a corresponding PR_CREATED).
 *
 * This handles network hiccups during PR creation. The branch is already
 * on the remote — we just need to create the PR/MR.
 *
 * Best-effort: if retry fails, the ticket stays as PUSHED and the user
 * can create the PR manually. Always returns `true` (never blocks the pipeline).
 */
import { attemptPrCreation } from '~/scripts/once/pr-creation/pr-creation.js';
import { sharedEnv } from '~/scripts/shared/env-schema/env-schema.js';
import {
  appendProgress,
  findEntriesWithStatus,
} from '~/scripts/shared/progress/progress.js';
import { buildPrBody } from '~/scripts/shared/pull-request/pr-body/pr-body.js';
import { detectRemote } from '~/scripts/shared/remote/remote.js';
import { dim, green, yellow } from '~/utils/ansi/ansi.js';

import type { RunContext } from '../context/context.js';

export async function prRetry(ctx: RunContext): Promise<boolean> {
  const config = ctx.config;
  if (!config) return true;

  try {
    const pushedEntries = findEntriesWithStatus(ctx.cwd, 'PUSHED');
    const prCreatedEntries = findEntriesWithStatus(ctx.cwd, 'PR_CREATED');

    // Find PUSHED tickets that never got a PR_CREATED
    const prCreatedKeys = new Set(prCreatedEntries.map((e) => e.key));
    const needsRetry = pushedEntries.filter((e) => !prCreatedKeys.has(e.key));

    if (!needsRetry.length) return true;

    for (const entry of needsRetry) {
      console.log(
        yellow(`  ↻ Retrying PR creation for ${entry.key} (previously pushed)`),
      );

      const ticketBranch = `feature/${entry.key.toLowerCase()}`;
      const targetBranch =
        entry.parent && entry.parent !== 'none'
          ? `epic/${entry.parent}`
          : (config.env.CLANCY_BASE_BRANCH ?? 'main');

      const platformOverride = sharedEnv(config).CLANCY_GIT_PLATFORM;
      const remote = detectRemote(platformOverride);

      if (
        remote.host === 'none' ||
        remote.host === 'unknown' ||
        remote.host === 'azure'
      ) {
        continue;
      }

      const prTitle = `feat(${entry.key}): ${entry.summary}`;
      const prBody = buildPrBody(
        config,
        {
          key: entry.key,
          title: entry.summary,
          description: entry.summary,
          provider: config.provider,
        },
        targetBranch,
      );

      const pr = await attemptPrCreation(
        config,
        remote,
        ticketBranch,
        targetBranch,
        prTitle,
        prBody,
      );

      if (pr?.ok) {
        console.log(green(`  ✓ PR created: ${pr.url}`));
        appendProgress(
          ctx.cwd,
          entry.key,
          entry.summary,
          'PR_CREATED',
          pr.number,
          entry.parent,
        );
      } else if (pr && !pr.ok && pr.alreadyExists) {
        console.log(dim(`  PR already exists for ${entry.key}`));
      } else {
        console.log(
          yellow(`  ⚠ PR retry failed for ${entry.key} — create manually`),
        );
      }
    }
  } catch {
    // Best-effort — never block the pipeline
  }

  return true;
}
