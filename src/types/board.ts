/**
 * Board-related types shared across board scripts.
 */

/** Supported board providers. */
export type BoardProvider =
  | 'jira'
  | 'github'
  | 'linear'
  | 'shortcut'
  | 'notion'
  | 'azdo';

/** A normalised ticket from any board provider. */
export type Ticket = {
  key: string;
  title: string;
  description: string;
  provider: BoardProvider;
};

/** Normalised ticket representation used within the once orchestrator. */
export type FetchedTicket = {
  key: string;
  title: string;
  description: string;
  parentInfo: string;
  blockers: string;
  /** Linear internal issue ID — needed for state transitions. */
  linearIssueId?: string;
  /** Board-specific issue ID — needed for feedback fetching (e.g., Linear UUID). */
  issueId?: string;
  /** Label names present on the ticket — used for pipeline label guard. */
  labels?: string[];
  /** Board status at fetch time — used for claim detection (e.g., "To Do", "unstarted"). */
  status?: string;
};
