/**
 * E2E cleanup helpers — closes tickets, deletes branches and PRs.
 *
 * Cleanup runs in afterAll / try-finally to ensure cleanup on test failure.
 */
import { execFileSync } from 'node:child_process';

import { githubHeaders, jiraHeaders } from '~/scripts/shared/http/http.js';

import {
  type E2EBoard,
  getGitHubCredentials,
  getJiraCredentials,
  getLinearCredentials,
  getShortcutCredentials,
} from './env.js';

/**
 * Clean up a test ticket by closing it and adding a qa-cleanup label.
 */
export async function cleanupTicket(
  board: E2EBoard,
  ticketId: string,
): Promise<void> {
  switch (board) {
    case 'github':
      return cleanupGitHubTicket(ticketId);
    case 'jira':
      return cleanupJiraTicket(ticketId);
    case 'linear':
      return cleanupLinearTicket(ticketId);
    case 'shortcut':
      return cleanupShortcutTicket(ticketId);
    case 'notion':
    case 'azdo':
      throw new Error(`cleanupTicket not implemented for board: ${board}`);
  }
}

/**
 * Close a PR on the git host by PR number.
 *
 * For non-GitHub boards that use GitHub as git host, pass 'github' as the board.
 */
export async function cleanupPullRequest(
  board: E2EBoard,
  prNumber: string,
): Promise<void> {
  switch (board) {
    case 'github':
    case 'jira':
    case 'linear':
    case 'shortcut':
      // All boards use the same GitHub sandbox repo for PRs
      return cleanupGitHubPullRequest(prNumber);
    case 'notion':
    case 'azdo':
      throw new Error(
        `cleanupPullRequest not implemented for board: ${board}`,
      );
  }
}

/**
 * Delete a remote branch from the sandbox repo.
 * Silently succeeds if the branch doesn't exist.
 */
export function cleanupBranch(repoPath: string, branchName: string): void {
  try {
    execFileSync('git', ['push', 'origin', '--delete', branchName], {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Branch may not exist on remote — that's fine
  }
}

// ---------------------------------------------------------------------------
// GitHub Issues
// ---------------------------------------------------------------------------

async function cleanupGitHubTicket(issueNumber: string): Promise<void> {
  const creds = getGitHubCredentials();
  if (!creds) return;

  const baseUrl = `https://api.github.com/repos/${creds.repo}/issues/${issueNumber}`;
  const headers = {
    ...githubHeaders(creds.token),
    'Content-Type': 'application/json',
  };

  // Close the issue
  await fetch(baseUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ state: 'closed' }),
  });

  // Add qa-cleanup label (best-effort)
  await fetch(`${baseUrl}/labels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ labels: ['qa-cleanup'] }),
  }).catch(() => {
    // Label may not exist — that's fine
  });
}

async function cleanupGitHubPullRequest(prNumber: string): Promise<void> {
  const creds = getGitHubCredentials();
  if (!creds) return;

  await fetch(
    `https://api.github.com/repos/${creds.repo}/pulls/${prNumber}`,
    {
      method: 'PATCH',
      headers: {
        ...githubHeaders(creds.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state: 'closed' }),
    },
  );
}

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

async function cleanupJiraTicket(issueIdOrKey: string): Promise<void> {
  const creds = getJiraCredentials();
  if (!creds) return;

  const auth = Buffer.from(`${creds.user}:${creds.apiToken}`).toString('base64');
  const headers = {
    ...jiraHeaders(auth),
    'Content-Type': 'application/json',
  };

  // Fetch available transitions to find "Done"
  const transResp = await fetch(
    `${creds.baseUrl}/rest/api/3/issue/${issueIdOrKey}/transitions`,
    { headers },
  );

  if (transResp.ok) {
    const transData = (await transResp.json()) as {
      transitions: Array<{ id: string; name: string }>;
    };
    const done = transData.transitions.find((t) =>
      t.name.toLowerCase().includes('done'),
    );
    if (done) {
      await fetch(
        `${creds.baseUrl}/rest/api/3/issue/${issueIdOrKey}/transitions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ transition: { id: done.id } }),
        },
      );
    }
  }

  // Add qa-cleanup label (best-effort)
  await fetch(
    `${creds.baseUrl}/rest/api/3/issue/${issueIdOrKey}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        update: { labels: [{ add: 'qa-cleanup' }] },
      }),
    },
  ).catch(() => {});
}

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

async function cleanupLinearTicket(issueId: string): Promise<void> {
  const creds = getLinearCredentials();
  if (!creds) return;

  // Delete the issue entirely (Linear supports full delete)
  await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: creds.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `mutation($id: String!) { issueDelete(id: $id) { success } }`,
      variables: { id: issueId },
    }),
  });
}

// ---------------------------------------------------------------------------
// Shortcut
// ---------------------------------------------------------------------------

async function cleanupShortcutTicket(storyId: string): Promise<void> {
  const creds = getShortcutCredentials();
  if (!creds) return;

  // Delete the story entirely (Shortcut supports full delete)
  await fetch(`https://api.app.shortcut.com/api/v3/stories/${storyId}`, {
    method: 'DELETE',
    headers: { 'Shortcut-Token': creds.token },
  });
}
