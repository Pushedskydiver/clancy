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
  getNotionCredentials,
  getShortcutCredentials,
  getAzdoCredentials,
} from './env.js';
import { buildAzdoAuth, azdoBaseUrl, azdoPatchHeaders } from './azdo-auth.js';
import { fetchWithTimeout } from './fetch-timeout.js';
import { buildJiraAuth } from './jira-auth.js';

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
      return cleanupNotionTicket(ticketId);
    case 'azdo':
      return cleanupAzdoTicket(ticketId);
  }
}

/**
 * Close a PR on the git host by PR number.
 *
 * All boards use the same GitHub sandbox repo for PRs.
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
    case 'notion':
    case 'azdo':
      // All boards use the same GitHub sandbox repo for PRs
      return cleanupGitHubPullRequest(prNumber);
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
  await fetchWithTimeout(baseUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ state: 'closed' }),
  });

  // Add qa-cleanup label (best-effort)
  await fetchWithTimeout(`${baseUrl}/labels`, {
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

  await fetchWithTimeout(
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

  const auth = buildJiraAuth(creds.user, creds.apiToken);
  const headers = {
    ...jiraHeaders(auth),
    'Content-Type': 'application/json',
  };

  // Fetch available transitions to find "Done"
  const transResp = await fetchWithTimeout(
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
      await fetchWithTimeout(
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
  await fetchWithTimeout(
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

  // Delete the issue entirely (Linear supports full delete).
  // Check GraphQL response — Linear returns HTTP 200 even on errors.
  const resp = await fetchWithTimeout('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: creds.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `mutation($id: ID!) { issueDelete(id: $id) { success } }`,
      variables: { id: issueId },
    }),
  });

  if (resp.ok) {
    const json = (await resp.json()) as {
      data?: { issueDelete?: { success?: boolean } };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length || !json.data?.issueDelete?.success) {
      // Best-effort — log but don't throw (cleanup should not break tests)
      console.log(`  ⚠ Linear cleanup may have failed for ${issueId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Shortcut
// ---------------------------------------------------------------------------

async function cleanupShortcutTicket(storyId: string): Promise<void> {
  const creds = getShortcutCredentials();
  if (!creds) return;

  // Delete the story entirely (Shortcut supports full delete)
  await fetchWithTimeout(`https://api.app.shortcut.com/api/v3/stories/${storyId}`, {
    method: 'DELETE',
    headers: { 'Shortcut-Token': creds.token },
  });
}

// ---------------------------------------------------------------------------
// Notion
// ---------------------------------------------------------------------------

async function cleanupNotionTicket(pageId: string): Promise<void> {
  const creds = getNotionCredentials();
  if (!creds) return;

  // Archive the page (Notion doesn't support hard delete via API)
  await fetchWithTimeout(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ archived: true }),
  });
}

// ---------------------------------------------------------------------------
// Azure DevOps
// ---------------------------------------------------------------------------

async function cleanupAzdoTicket(workItemId: string): Promise<void> {
  const creds = getAzdoCredentials();
  if (!creds) return;

  const auth = buildAzdoAuth(creds.pat);
  const base = azdoBaseUrl(creds.org, creds.project);

  // Try hard delete first — falls back to close + tag if destroy permission unavailable
  const delResp = await fetchWithTimeout(
    `${base}/wit/workitems/${workItemId}?destroy=true&api-version=7.1`,
    {
      method: 'DELETE',
      headers: { Authorization: `Basic ${auth}` },
    },
  );

  if (delResp.ok) return;

  // Fallback: close the work item and tag it for manual cleanup
  await fetchWithTimeout(
    `${base}/wit/workitems/${workItemId}?api-version=7.1`,
    {
      method: 'PATCH',
      headers: azdoPatchHeaders(auth),
      body: JSON.stringify([
        { op: 'add', path: '/fields/System.State', value: 'Closed' },
        { op: 'add', path: '/fields/System.Tags', value: 'qa-cleanup' },
      ]),
    },
  );
}
