/**
 * E2E cleanup helpers — closes tickets, deletes branches and PRs.
 *
 * Cleanup runs in afterAll / try-finally to ensure cleanup on test failure.
 * Only GitHub is implemented in QA-003a; other boards throw "not implemented".
 */
import { execFileSync } from 'node:child_process';

import { type E2EBoard, getGitHubCredentials } from './env.js';

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
    case 'linear':
    case 'shortcut':
    case 'notion':
    case 'azdo':
      throw new Error(`cleanupTicket not implemented for board: ${board}`);
  }
}

/**
 * Close a PR on the git host by PR number.
 */
export async function cleanupPullRequest(
  board: E2EBoard,
  prNumber: string,
): Promise<void> {
  switch (board) {
    case 'github':
      return cleanupGitHubPullRequest(prNumber);
    case 'jira':
    case 'linear':
    case 'shortcut':
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
    Authorization: `Bearer ${creds.token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
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
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({ state: 'closed' }),
    },
  );
}
