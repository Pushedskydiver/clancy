/**
 * Orphan ticket garbage collector for E2E tests.
 *
 * Queries each board for tickets with [QA] in the title older than 24 hours,
 * and cleans them up (close/delete). Also cleans up orphaned PRs and branches
 * on the sandbox repo.
 *
 * Handles cases where afterAll never runs: CI killed, OOM, timeout, manual
 * cancellation.
 *
 * Usage: npx tsx test/e2e/helpers/gc.ts
 */
import { githubHeaders, jiraHeaders } from '~/scripts/shared/http/http.js';

import {
  type E2EBoard,
  getGitHubCredentials,
  getJiraCredentials,
  getLinearCredentials,
  getShortcutCredentials,
} from './env.js';
import { fetchWithTimeout } from './fetch-timeout.js';
import { buildJiraAuth } from './jira-auth.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Clean up orphan test tickets for a given board.
 */
export async function cleanupOrphanTickets(board: E2EBoard): Promise<number> {
  switch (board) {
    case 'github':
      return cleanupGitHubOrphans();
    case 'jira':
      return cleanupJiraOrphans();
    case 'linear':
      return cleanupLinearOrphans();
    case 'shortcut':
      return cleanupShortcutOrphans();
    case 'notion':
    case 'azdo':
      console.log(`  ⏭ GC not implemented for ${board} — skipping`);
      return 0;
  }
}

// ---------------------------------------------------------------------------
// GitHub Issues — orphan cleanup
// ---------------------------------------------------------------------------

async function cleanupGitHubOrphans(): Promise<number> {
  const creds = getGitHubCredentials();
  if (!creds) {
    console.log('  ⏭ GitHub credentials not available — skipping');
    return 0;
  }

  const headers = githubHeaders(creds.token);

  let cleaned = 0;

  // Clean orphan issues
  const cutoff = new Date(Date.now() - ONE_DAY_MS).toISOString();
  const query = encodeURIComponent(
    `repo:${creds.repo} is:issue is:open "[QA]" in:title created:<${cutoff}`,
  );

  const searchResp = await fetchWithTimeout(
    `https://api.github.com/search/issues?q=${query}&per_page=100`,
    { headers },
  );

  if (searchResp.ok) {
    const data = (await searchResp.json()) as {
      items: Array<{ number: number; title: string }>;
    };

    for (const issue of data.items) {
      console.log(`  🧹 Closing orphan issue #${issue.number}: ${issue.title}`);
      const closeResp = await fetchWithTimeout(
        `https://api.github.com/repos/${creds.repo}/issues/${issue.number}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'closed' }),
        },
      );
      if (closeResp.ok) cleaned++;
      else console.log(`    ⚠ Failed to close issue #${issue.number}: ${closeResp.status}`);
    }
  }

  // Clean orphan PRs with [QA] in title
  const prSearchQuery = encodeURIComponent(
    `repo:${creds.repo} is:pr is:open "[QA]" in:title created:<${cutoff}`,
  );

  const prSearchResp = await fetchWithTimeout(
    `https://api.github.com/search/issues?q=${prSearchQuery}&per_page=100`,
    { headers },
  );

  if (prSearchResp.ok) {
    const data = (await prSearchResp.json()) as {
      items: Array<{ number: number; title: string }>;
    };

    for (const pr of data.items) {
      console.log(`  🧹 Closing orphan PR #${pr.number}: ${pr.title}`);
      const closeResp = await fetchWithTimeout(
        `https://api.github.com/repos/${creds.repo}/pulls/${pr.number}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'closed' }),
        },
      );
      if (closeResp.ok) cleaned++;
      else console.log(`    ⚠ Failed to close PR #${pr.number}: ${closeResp.status}`);
    }
  }

  // Clean orphan branches — only delete feature/* branches whose
  // associated PR was already cleaned up (closed with [QA] in title).
  // Safe because we only inspect PRs that matched the [QA] title search.
  const closedPrQuery = encodeURIComponent(
    `repo:${creds.repo} is:pr is:closed "[QA]" in:title created:<${cutoff}`,
  );

  const closedPrResp = await fetchWithTimeout(
    `https://api.github.com/search/issues?q=${closedPrQuery}&per_page=100`,
    { headers },
  );

  if (closedPrResp.ok) {
    const data = (await closedPrResp.json()) as {
      items: Array<{ number: number; pull_request?: { url: string } }>;
    };

    for (const pr of data.items) {
      // Fetch PR details to get the head branch name
      const prDetailResp = await fetchWithTimeout(
        `https://api.github.com/repos/${creds.repo}/pulls/${pr.number}`,
        { headers },
      );
      if (!prDetailResp.ok) continue;

      const prDetail = (await prDetailResp.json()) as {
        head: { ref: string };
      };
      const branchName = prDetail.head.ref;

      if (branchName.startsWith('feature/')) {
        // Check if branch still exists before attempting delete
        const branchResp = await fetchWithTimeout(
          `https://api.github.com/repos/${creds.repo}/git/refs/heads/${branchName}`,
          { headers },
        );
        if (branchResp.ok) {
          console.log(`  🧹 Deleting orphan branch: ${branchName}`);
          const delResp = await fetchWithTimeout(
            `https://api.github.com/repos/${creds.repo}/git/refs/heads/${branchName}`,
            { method: 'DELETE', headers },
          );
          if (delResp.ok) cleaned++;
          else console.log(`    ⚠ Failed to delete branch ${branchName}: ${delResp.status}`);
        }
      }
    }
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// Jira — orphan cleanup
// ---------------------------------------------------------------------------

async function cleanupJiraOrphans(): Promise<number> {
  const creds = getJiraCredentials();
  if (!creds) {
    console.log('  ⏭ Jira credentials not available — skipping');
    return 0;
  }

  const auth = buildJiraAuth(creds.user, creds.apiToken);
  const headers = {
    ...jiraHeaders(auth),
    'Content-Type': 'application/json',
  };

  let cleaned = 0;

  // Search for [QA] issues created > 24h ago (relative JQL avoids timezone truncation)
  const jql = `project = ${creds.projectKey} AND summary ~ "[QA]" AND created <= -1d AND status != Done`;

  const searchResp = await fetchWithTimeout(
    `${creds.baseUrl}/rest/api/3/search/jql`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jql,
        maxResults: 100,
        fields: ['summary'],
      }),
    },
  );

  if (!searchResp.ok) {
    console.log(`  ⚠ Jira search failed: ${searchResp.status}`);
    return 0;
  }

  const data = (await searchResp.json()) as {
    issues: Array<{ key: string; fields: { summary: string } }>;
  };

  for (const issue of data.issues) {
    console.log(`  🧹 Transitioning orphan ${issue.key}: ${issue.fields.summary}`);

    // Fetch transitions to find "Done"
    const transResp = await fetchWithTimeout(
      `${creds.baseUrl}/rest/api/3/issue/${issue.key}/transitions`,
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
        const closeResp = await fetchWithTimeout(
          `${creds.baseUrl}/rest/api/3/issue/${issue.key}/transitions`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ transition: { id: done.id } }),
          },
        );
        if (closeResp.ok) cleaned++;
        else console.log(`    ⚠ Failed to transition ${issue.key}: ${closeResp.status}`);
      }
    }
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// Linear — orphan cleanup
// ---------------------------------------------------------------------------

async function cleanupLinearOrphans(): Promise<number> {
  const creds = getLinearCredentials();
  if (!creds) {
    console.log('  ⏭ Linear credentials not available — skipping');
    return 0;
  }

  const linearHeaders = {
    Authorization: creds.apiKey,
    'Content-Type': 'application/json',
  };

  let cleaned = 0;

  // Search for issues with [QA] in title
  const searchResp = await fetchWithTimeout('https://api.linear.app/graphql', {
    method: 'POST',
    headers: linearHeaders,
    body: JSON.stringify({
      query: `query($teamId: String!) {
        issues(first: 100, filter: {
          team: { id: { eq: $teamId } },
          title: { contains: "[QA]" }
        }) {
          nodes { id title createdAt }
        }
      }`,
      variables: { teamId: creds.teamId },
    }),
  });

  if (!searchResp.ok) {
    console.log(`  ⚠ Linear search failed: ${searchResp.status}`);
    return 0;
  }

  const json = (await searchResp.json()) as {
    data?: { issues: { nodes: Array<{ id: string; title: string; createdAt: string }> } };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    console.log(`  ⚠ Linear GraphQL error: ${json.errors[0]!.message}`);
    return 0;
  }

  const issues = json.data?.issues.nodes ?? [];
  const cutoff = Date.now() - ONE_DAY_MS;

  for (const issue of issues) {
    if (new Date(issue.createdAt).getTime() > cutoff) continue;

    console.log(`  🧹 Deleting orphan: ${issue.title}`);

    const delResp = await fetchWithTimeout('https://api.linear.app/graphql', {
      method: 'POST',
      headers: linearHeaders,
      body: JSON.stringify({
        query: `mutation($id: String!) { issueDelete(id: $id) { success } }`,
        variables: { id: issue.id },
      }),
    });

    if (!delResp.ok) {
      console.log(`    ⚠ Failed to delete Linear issue: HTTP ${delResp.status}`);
      continue;
    }

    const delJson = (await delResp.json()) as {
      data?: { issueDelete?: { success?: boolean } };
      errors?: Array<{ message: string }>;
    };

    if (delJson.errors?.length) {
      console.log(`    ⚠ Linear delete GraphQL error: ${delJson.errors[0]!.message}`);
      continue;
    }

    if (!delJson.data?.issueDelete?.success) {
      console.log('    ⚠ Linear delete unsuccessful (success=false in payload)');
      continue;
    }

    cleaned++;
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// Shortcut — orphan cleanup
// ---------------------------------------------------------------------------

async function cleanupShortcutOrphans(): Promise<number> {
  const creds = getShortcutCredentials();
  if (!creds) {
    console.log('  ⏭ Shortcut credentials not available — skipping');
    return 0;
  }

  const scHeaders = {
    'Shortcut-Token': creds.token,
    'Content-Type': 'application/json',
  };

  let cleaned = 0;
  const cutoff = Date.now() - ONE_DAY_MS;
  let nextToken: string | undefined;

  // Paginate through all search results — Shortcut /stories/search is paginated
  for (let page = 0; page < 100; page++) {
    const body: Record<string, unknown> = { query: '[QA]', page_size: 25 };
    if (nextToken) body.next = nextToken;

    const searchResp = await fetchWithTimeout(
      'https://api.app.shortcut.com/api/v3/stories/search',
      {
        method: 'POST',
        headers: scHeaders,
        body: JSON.stringify(body),
      },
    );

    if (!searchResp.ok) {
      console.log(`  ⚠ Shortcut search failed: ${searchResp.status}`);
      break;
    }

    const data = (await searchResp.json()) as {
      data: Array<{ id: number; name: string; created_at: string }>;
      next?: string | null;
    };

    if (!data.data?.length) break;

    for (const story of data.data) {
      if (new Date(story.created_at).getTime() > cutoff) continue;

      console.log(`  🧹 Deleting orphan: sc-${story.id} ${story.name}`);

      const delResp = await fetchWithTimeout(
        `https://api.app.shortcut.com/api/v3/stories/${story.id}`,
        {
          method: 'DELETE',
          headers: { 'Shortcut-Token': creds.token },
        },
      );

      if (delResp.ok) cleaned++;
      else console.log(`    ⚠ Failed to delete Shortcut story sc-${story.id}: ${delResp.status}`);
    }

    nextToken = data.next ?? undefined;
    if (!nextToken) break;
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// When invoked via `npx tsx`, argv[1] is the tsx CLI and argv[2] is the script.
const isDirectRun = [process.argv[1], process.argv[2]].some(
  (arg) => arg?.endsWith('gc.ts') || arg?.endsWith('gc.js'),
);

if (isDirectRun) {
  console.log('🧹 Clancy E2E — Orphan Ticket Garbage Collector\n');

  const boards: E2EBoard[] = [
    'github',
    'jira',
    'linear',
    'shortcut',
    'notion',
    'azdo',
  ];

  let totalCleaned = 0;

  for (const board of boards) {
    console.log(`📋 ${board}:`);
    const count = await cleanupOrphanTickets(board);
    totalCleaned += count;
    if (count === 0) console.log('  ✅ No orphans found');
  }

  console.log(`\n🏁 Done — cleaned ${totalCleaned} orphan(s)`);
}
