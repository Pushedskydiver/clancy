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
};
