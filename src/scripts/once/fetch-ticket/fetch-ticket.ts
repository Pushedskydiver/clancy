import type { Board } from '~/scripts/board/board.js';
import type { FetchedTicket } from '~/types/board.js';

/** Options for ticket fetching behaviour. */
export type FetchTicketOptions = {
  /** If `true`, excludes tickets with the `clancy:hitl` label. */
  isAfk?: boolean;
};

/**
 * Resolve the implementation queue label.
 *
 * Uses `CLANCY_LABEL_BUILD` if set, falls back to `CLANCY_LABEL` for
 * backward compatibility. Returns `undefined` if neither is set.
 */
export function resolveBuildLabel(
  env: Record<string, string | undefined>,
): string | undefined {
  return env.CLANCY_LABEL_BUILD || env.CLANCY_LABEL || undefined;
}

/**
 * Resolve the plan queue label.
 *
 * Used as an exclusion filter — tickets with this label are still in the
 * planning queue and should not be picked up for implementation.
 */
export function resolvePlanLabel(
  env: Record<string, string | undefined>,
): string | undefined {
  return env.CLANCY_LABEL_PLAN || env.CLANCY_PLAN_LABEL || undefined;
}

/** Whether the current run is in AFK mode (set by the AFK runner). */
function detectAfkMode(opts?: FetchTicketOptions): boolean {
  return opts?.isAfk ?? process.env.CLANCY_AFK_MODE === '1';
}

// ─── Board-driven fetch (blocker-aware) ──────────────────────────────────────

/**
 * Fetch the next available unblocked ticket from the board.
 *
 * Fetches candidate tickets via the Board abstraction and returns the first
 * one that is not blocked and not still in the planning queue.
 *
 * In AFK mode (`CLANCY_AFK_MODE=1` or `opts.isAfk`), tickets with the
 * `clancy:hitl` label are excluded from the candidate pool.
 *
 * @param board - The Board instance (created by `createBoard`).
 * @param opts - Optional fetch behaviour overrides.
 * @returns The first unblocked ticket, or `undefined` if none available.
 */
export async function fetchTicket(
  board: Board,
  opts?: FetchTicketOptions,
): Promise<FetchedTicket | undefined> {
  const excludeHitl = detectAfkMode(opts);
  const env = board.sharedEnv();
  const buildLabel = resolveBuildLabel(env);
  const planLabel = resolvePlanLabel(env);
  const candidates = await board.fetchTickets({ excludeHitl, buildLabel });
  if (!candidates.length) return undefined;

  for (const candidate of candidates) {
    // Guard: exclude tickets that still have the plan label (dual-label AFK race).
    // During add-before-remove transitions a ticket briefly has both plan + build
    // labels. Skip it until the plan label is fully removed.
    if (planLabel && candidate.labels?.includes(planLabel)) {
      console.log(`Skipping ${candidate.key} — still has plan label`);
      continue;
    }

    const blocked = await board.fetchBlockerStatus(candidate);
    if (!blocked) {
      console.log(
        `Selected ${candidate.key}${candidate.status ? ` (status: ${candidate.status})` : ''}`,
      );
      return candidate;
    }
    console.log(`Skipping ${candidate.key} — blocked`);
  }

  return undefined;
}
