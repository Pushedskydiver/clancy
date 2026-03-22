/**
 * E2E ticket factory — creates real tickets on board platforms.
 *
 * Each board has a createTestTicket implementation that calls the real API.
 * Ticket titles include a unique run ID for isolation between concurrent runs.
 * Only GitHub is implemented in QA-003a; other boards throw "not implemented".
 */
import {
  type E2EBoard,
  getGitHubCredentials,
} from './env.js';

export interface CreateTicketOptions {
  /** Override the default ticket title suffix. */
  titleSuffix?: string;
}

export interface CreatedTicket {
  /** Board-specific ticket ID (e.g. issue number for GitHub). */
  id: string;
  /** Board-specific ticket key (e.g. '#42' for GitHub). */
  key: string;
  /** URL to the ticket on the board platform. */
  url: string;
}

/** Generate a unique run ID for test isolation. */
export function generateRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a test ticket on a real board platform.
 *
 * The ticket title includes `[QA]`, the board name, and a unique run ID
 * so orphan GC can identify and clean up test tickets.
 */
export async function createTestTicket(
  board: E2EBoard,
  runId: string,
  options: CreateTicketOptions = {},
): Promise<CreatedTicket> {
  switch (board) {
    case 'github':
      return createGitHubTicket(runId, options);
    case 'jira':
    case 'linear':
    case 'shortcut':
    case 'notion':
    case 'azdo':
      throw new Error(`createTestTicket not implemented for board: ${board}`);
  }
}

// ---------------------------------------------------------------------------
// GitHub Issues
// ---------------------------------------------------------------------------

async function createGitHubTicket(
  runId: string,
  options: CreateTicketOptions,
): Promise<CreatedTicket> {
  const creds = getGitHubCredentials();
  if (!creds) throw new Error('GitHub credentials not available');

  const title = `[QA] E2E test — github — ${runId}${options.titleSuffix ? ` — ${options.titleSuffix}` : ''}`;
  const body = [
    '## Summary',
    '',
    'Automated E2E test ticket created by Clancy QA suite.',
    'This ticket will be cleaned up automatically after the test completes.',
    '',
    '## Acceptance Criteria',
    '',
    '- [ ] Simulated implementation passes verification',
    '- [ ] PR is created against the correct branch',
    '- [ ] Progress file is updated with DONE entry',
  ].join('\n');

  const response = await fetch(
    `https://api.github.com/repos/${creds.repo}/issues`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({
        title,
        body,
        labels: ['clancy:build'],
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create GitHub issue: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as {
    number: number;
    html_url: string;
  };

  return {
    id: String(data.number),
    key: `#${data.number}`,
    url: data.html_url,
  };
}
