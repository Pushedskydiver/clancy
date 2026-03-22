/**
 * Remote git hosting types shared across remote detection and PR creation.
 */

/** Supported git hosting platforms. */
export type GitPlatform =
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'bitbucket-server'
  | 'azure'
  | 'unknown';

/** Parsed remote URL with platform and path info. */
export type RemoteInfo =
  | {
      host: 'github';
      owner: string;
      repo: string;
      hostname: string;
    }
  | {
      host: 'gitlab';
      projectPath: string;
      hostname: string;
    }
  | {
      host: 'bitbucket';
      workspace: string;
      repoSlug: string;
      hostname: string;
    }
  | {
      host: 'bitbucket-server';
      projectKey: string;
      repoSlug: string;
      hostname: string;
    }
  | {
      host: 'azure' | 'unknown';
      url: string;
    }
  | {
      host: 'none';
    };

/** Result of a PR/MR creation attempt. */
export type PrCreationResult =
  | { ok: true; url: string; number: number }
  | { ok: false; error: string; alreadyExists?: boolean };

/** Result of checking PR/MR review state. */
export type PrReviewState = {
  /** Whether changes have been requested by a reviewer. */
  changesRequested: boolean;
  /** The PR/MR number/ID (needed to fetch comments). */
  prNumber: number;
  /** The PR/MR URL (for logging). */
  prUrl: string;
  /** Usernames of reviewers who requested changes (GitHub only). */
  reviewers?: string[];
};

/** Progress log status values. */
export type ProgressStatus =
  | 'DONE'
  | 'SKIPPED'
  | 'PR_CREATED'
  | 'PUSHED'
  | 'PUSH_FAILED'
  | 'LOCAL'
  | 'PLAN'
  | 'APPROVE_PLAN'
  | 'REWORK'
  | 'EPIC_PR_CREATED'
  | 'BRIEF'
  | 'APPROVE_BRIEF'
  | 'TIME_LIMIT'
  | 'RESUMED';

/**
 * Statuses that indicate work has been delivered to the remote.
 * Used by crash recovery to detect already-delivered tickets.
 */
export const DELIVERED_STATUSES: ReadonlySet<ProgressStatus> =
  new Set<ProgressStatus>(['PR_CREATED', 'PUSHED', 'REWORK', 'RESUMED']);

/**
 * Statuses that indicate a ticket was successfully completed.
 * Used by AFK session reports to count completed tickets.
 */
export const COMPLETED_STATUSES: ReadonlySet<ProgressStatus> =
  new Set<ProgressStatus>([
    'DONE',
    'PR_CREATED',
    'PUSHED',
    'EPIC_PR_CREATED',
    'RESUMED',
  ]);

/**
 * Statuses that indicate a failed or skipped ticket.
 * Used by AFK session reports to count failed tickets.
 */
export const FAILED_STATUSES: ReadonlySet<ProgressStatus> =
  new Set<ProgressStatus>(['SKIPPED', 'PUSH_FAILED', 'TIME_LIMIT']);
