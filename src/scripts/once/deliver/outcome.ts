/**
 * Pure outcome computation for delivery results.
 *
 * Replaces the if/else chain in `deliverViaPullRequest` with a
 * discriminated union. The orchestrator switches on `type` for
 * logging and progress, keeping side effects separate from decisions.
 */
import type {
  PrCreationResult,
  ProgressStatus,
  RemoteInfo,
} from '~/types/index.js';

import { buildManualPrUrl } from '../pr-creation/pr-creation.js';

/** Discriminated union of all possible delivery outcomes after push succeeds. */
export type DeliveryOutcome =
  | { type: 'created'; url: string; number: number }
  | { type: 'exists' }
  | { type: 'failed'; error: string; manualUrl?: string }
  | { type: 'not_attempted'; manualUrl?: string }
  | { type: 'local' }
  | { type: 'unsupported' };

/**
 * Compute the delivery outcome from a PR creation result and remote info.
 *
 * Pure function — no side effects, no I/O. The caller handles logging
 * and progress based on the returned outcome type.
 *
 * @param pr - The PR creation result, or `undefined` if PR creation was not attempted
 *   (e.g., no token available, no API base URL, or unsupported platform).
 * @param remote - The detected remote info.
 * @param ticketBranch - The branch that was pushed (for manual URL construction).
 * @param targetBranch - The target branch (for manual URL construction).
 * @returns The delivery outcome.
 */
export function computeDeliveryOutcome(
  pr: PrCreationResult | undefined,
  remote: RemoteInfo,
  ticketBranch: string,
  targetBranch: string,
): DeliveryOutcome {
  // No remote configured
  if (remote.host === 'none') return { type: 'local' };

  // Unsupported remote (unknown or Azure — no PR API)
  if (remote.host === 'unknown' || remote.host === 'azure') {
    return { type: 'unsupported' };
  }

  // PR was created successfully
  if (pr?.ok) {
    return { type: 'created', url: pr.url, number: pr.number };
  }

  // PR already exists
  if (pr && !pr.ok && pr.alreadyExists) {
    return { type: 'exists' };
  }

  // PR creation failed with an error
  if (pr && !pr.ok) {
    return {
      type: 'failed',
      error: pr.error,
      manualUrl: buildManualPrUrl(remote, ticketBranch, targetBranch),
    };
  }

  // PR creation not attempted (e.g., missing token or API base URL)
  return {
    type: 'not_attempted',
    manualUrl: buildManualPrUrl(remote, ticketBranch, targetBranch),
  };
}

/**
 * Map a delivery outcome to the progress status and optional PR number.
 *
 * Pure function — used by the orchestrator to log progress after delivery.
 */
export function progressForOutcome(outcome: DeliveryOutcome): {
  status: ProgressStatus;
  prNumber?: number;
} {
  switch (outcome.type) {
    case 'created':
      return { status: 'PR_CREATED', prNumber: outcome.number };
    case 'local':
      return { status: 'LOCAL' };
    case 'exists':
    case 'failed':
    case 'not_attempted':
    case 'unsupported':
      return { status: 'PUSHED' };
  }
}
