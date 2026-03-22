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
import { githubHeaders } from '~/scripts/shared/http/http.js';

import { getGitHubCredentials, type E2EBoard } from './env.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Clean up orphan test tickets for a given board.
 */
export async function cleanupOrphanTickets(board: E2EBoard): Promise<number> {
  switch (board) {
    case 'github':
      return cleanupGitHubOrphans();
    case 'jira':
    case 'linear':
    case 'shortcut':
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

  const searchResp = await fetch(
    `https://api.github.com/search/issues?q=${query}&per_page=100`,
    { headers },
  );

  if (searchResp.ok) {
    const data = (await searchResp.json()) as {
      items: Array<{ number: number; title: string }>;
    };

    for (const issue of data.items) {
      console.log(`  🧹 Closing orphan issue #${issue.number}: ${issue.title}`);
      const closeResp = await fetch(
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

  const prSearchResp = await fetch(
    `https://api.github.com/search/issues?q=${prSearchQuery}&per_page=100`,
    { headers },
  );

  if (prSearchResp.ok) {
    const data = (await prSearchResp.json()) as {
      items: Array<{ number: number; title: string }>;
    };

    for (const pr of data.items) {
      console.log(`  🧹 Closing orphan PR #${pr.number}: ${pr.title}`);
      const closeResp = await fetch(
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

  // Clean orphan branches — only delete feature/issue-* branches whose
  // associated PR was already cleaned up (closed with [QA] in title).
  // This avoids accidentally deleting non-E2E branches.
  const closedPrQuery = encodeURIComponent(
    `repo:${creds.repo} is:pr is:closed "[QA]" in:title created:<${cutoff}`,
  );

  const closedPrResp = await fetch(
    `https://api.github.com/search/issues?q=${closedPrQuery}&per_page=100`,
    { headers },
  );

  if (closedPrResp.ok) {
    const data = (await closedPrResp.json()) as {
      items: Array<{ number: number; pull_request?: { url: string } }>;
    };

    for (const pr of data.items) {
      // Fetch PR details to get the head branch name
      const prDetailResp = await fetch(
        `https://api.github.com/repos/${creds.repo}/pulls/${pr.number}`,
        { headers },
      );
      if (!prDetailResp.ok) continue;

      const prDetail = (await prDetailResp.json()) as {
        head: { ref: string };
      };
      const branchName = prDetail.head.ref;

      if (branchName.startsWith('feature/issue-')) {
        // Check if branch still exists before attempting delete
        const branchResp = await fetch(
          `https://api.github.com/repos/${creds.repo}/git/refs/heads/${branchName}`,
          { headers },
        );
        if (branchResp.ok) {
          console.log(`  🧹 Deleting orphan branch: ${branchName}`);
          const delResp = await fetch(
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
