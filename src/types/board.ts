/**
 * Board-related types shared across board scripts.
 */

/** Supported board providers. */
export type BoardProvider = 'jira' | 'github' | 'linear';

/** A normalised ticket from any board provider. */
export type Ticket = {
  key: string;
  title: string;
  description: string;
  provider: BoardProvider;
};

/** Board environment variables common to all providers. */
export type BoardEnv = {
  projectUrl: string;
  apiToken: string;
  statusInProgress?: string;
  statusDone?: string;
};
