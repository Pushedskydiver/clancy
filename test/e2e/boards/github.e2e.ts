/**
 * GitHub Issues — E2E test against real GitHub API.
 *
 * Creates a real issue on the sandbox repo, runs the once orchestrator
 * with Claude mocked (simulator), verifies the PR was created and the
 * progress file was updated, then cleans up.
 *
 * Prerequisites:
 * - .env.e2e with GITHUB_TOKEN and GITHUB_REPO set
 * - Sandbox repo exists with Issues enabled
 * - clancy:build label exists on the sandbox repo
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { githubHeaders } from '~/scripts/shared/http/http.js';

import { simulateClaudeSuccess } from '../../integration/helpers/claude-simulator.js';
import {
  createClancyScaffold,
  createTempRepo,
  withCwd,
  type TempRepoResult,
} from '../../integration/helpers/temp-repo.js';

import { cleanupBranch, cleanupPullRequest, cleanupTicket } from '../helpers/cleanup.js';
import { getGitHubCredentials, hasCredentials } from '../helpers/env.js';
import { cleanupGitAuth, configureGitAuth } from '../helpers/git-auth.js';
import {
  createTestTicket,
  generateRunId,
  type CreatedTicket,
} from '../helpers/ticket-factory.js';

// ---------------------------------------------------------------------------
// Skip if credentials not available
// ---------------------------------------------------------------------------

const canRun = hasCredentials('github');

// ---------------------------------------------------------------------------
// Module mocks — Claude is always simulated, preflight partially real
// ---------------------------------------------------------------------------

// Mock only binaryExists for 'claude' — let the rest of preflight run real.
// This exercises real .env loading and remote connectivity checks.
vi.mock('~/scripts/shared/preflight/preflight.js', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('~/scripts/shared/preflight/preflight.js')
    >();
  return {
    ...original,
    binaryExists: (name: string) => {
      if (name === 'claude') return true;
      return original.binaryExists(name);
    },
  };
});

let claudeSessionMock: (prompt: string, model?: string) => boolean = () => {
  throw new Error('claudeSessionMock called unexpectedly');
};

vi.mock('~/scripts/shared/claude-cli/claude-cli.js', () => ({
  invokeClaudeSession: (prompt: string, model?: string) =>
    claudeSessionMock(prompt, model),
  invokeClaudePrint: () => ({ stdout: 'feasible', ok: true }),
}));

// Import orchestrator AFTER mocks
const { run } = await import('~/scripts/once/once.js');

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!canRun)('E2E: GitHub Issues — full pipeline', () => {
  const runId = generateRunId();
  let ticket: CreatedTicket | undefined;
  let repo: TempRepoResult | undefined;
  let ticketBranch: string | undefined;
  let prNumber: string | undefined;

  beforeAll(() => {
    const creds = getGitHubCredentials()!;
    configureGitAuth(creds.token);
  });

  afterAll(async () => {
    // Clean up in reverse order: PR → branch → ticket → repo
    if (prNumber) {
      await cleanupPullRequest('github', prNumber).catch(() => {});
    }
    if (repo && ticketBranch) {
      cleanupBranch(repo.repoPath, ticketBranch);
    }
    if (ticket) {
      await cleanupTicket('github', ticket.id).catch(() => {});
    }
    if (repo) {
      repo.cleanup();
    }
    // Restore env and clean up auth files
    cleanupGitAuth();
    delete process.env.GIT_ASKPASS;
    delete process.env.GIT_TERMINAL_PROMPT;
    vi.unstubAllEnvs();
  });

  it('creates a ticket, runs the pipeline, and verifies PR creation', async () => {
    const creds = getGitHubCredentials()!;

    // 1. Create test ticket via real GitHub API
    ticket = await createTestTicket('github', runId);
    ticketBranch = `feature/issue-${ticket.id}`;

    // Brief pause — GitHub's Issues list API has eventual consistency.
    // A newly created issue may not appear in filtered queries immediately.
    await new Promise((r) => setTimeout(r, 2000));

    // 2. Set up temp repo with real remote pointing to sandbox
    repo = createTempRepo();
    const remoteUrl = `https://github.com/${creds.repo}.git`;

    execFileSync('git', ['remote', 'add', 'origin', remoteUrl], {
      cwd: repo.repoPath,
      stdio: 'pipe',
    });

    // Fetch the sandbox repo's main branch. If it exists, reset our local
    // main to match it (avoids non-fast-forward conflicts between runs).
    // If the sandbox is empty, push our initial commit to create main.
    try {
      execFileSync('git', ['fetch', 'origin', 'main'], {
        cwd: repo.repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      execFileSync('git', ['reset', '--hard', 'origin/main'], {
        cwd: repo.repoPath,
        stdio: 'pipe',
      });
    } catch {
      // Remote main doesn't exist yet — push our initial commit
      execFileSync('git', ['push', '-u', 'origin', 'main'], {
        cwd: repo.repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    // Create Clancy scaffold with real credentials.
    // The .clancy/.env contains the real token, so we gitignore it
    // to prevent it being committed and pushed to the sandbox repo.
    createClancyScaffold(repo.repoPath, 'github', {
      GITHUB_TOKEN: creds.token,
      GITHUB_REPO: creds.repo,
      CLANCY_BASE_BRANCH: 'main',
      CLANCY_LABEL_BUILD: 'clancy:build',
    });

    writeFileSync(
      join(repo.repoPath, '.clancy', '.gitignore'),
      '.env\n',
    );

    execFileSync('git', ['add', '-A'], {
      cwd: repo.repoPath,
      stdio: 'pipe',
    });
    execFileSync('git', ['commit', '-m', 'chore: add clancy scaffold'], {
      cwd: repo.repoPath,
      stdio: 'pipe',
    });

    // 3. Configure Claude simulator
    claudeSessionMock = () => {
      simulateClaudeSuccess(repo!.repoPath, `issue-${ticket!.id}`);
      return true;
    };

    // 4. Run the orchestrator — real GitHub API, real git push, simulated Claude
    await withCwd(repo.repoPath, () => run(['--skip-feasibility']));

    // 5. Verify locally: feature branch was created
    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: repo.repoPath,
      encoding: 'utf8',
    });
    expect(branches).toContain(ticketBranch);

    // 6. Verify locally: progress.txt has entry
    const progressPath = join(repo.repoPath, '.clancy', 'progress.txt');
    expect(existsSync(progressPath)).toBe(true);

    const progress = readFileSync(progressPath, 'utf8');
    expect(progress).toContain(`#${ticket.id}`);
    expect(progress).toMatch(/PR_CREATED|PUSHED/);

    // Extract PR number from progress — must be present (PR_CREATED with pr:N)
    const prMatch = progress.match(/pr:(\d+)/);
    expect(prMatch).not.toBeNull();
    prNumber = (prMatch as RegExpMatchArray)[1];

    // 7. Verify via real GitHub API: PR exists on sandbox repo
    {
      const prResponse = await fetch(
        `https://api.github.com/repos/${creds.repo}/pulls/${prNumber}`,
        {
          headers: githubHeaders(creds.token),
        },
      );
      expect(prResponse.ok).toBe(true);

      const prData = (await prResponse.json()) as {
        state: string;
        head: { ref: string };
        base: { ref: string };
        title: string;
        body: string;
      };
      expect(prData.state).toBe('open');
      expect(prData.head.ref).toBe(ticketBranch);
      expect(prData.base.ref).toBe('main');
      expect(prData.body).toContain(`#${ticket.id}`);
    }

    // 8. Verify via real GitHub API: issue still exists (GitHub doesn't
    //    close until PR is merged, so it should still be open)
    const issueResponse = await fetch(
      `https://api.github.com/repos/${creds.repo}/issues/${ticket.id}`,
      {
        headers: githubHeaders(creds.token),
      },
    );
    expect(issueResponse.ok).toBe(true);

    const issueData = (await issueResponse.json()) as {
      state: string;
      labels: Array<{ name: string }>;
    };
    expect(issueData.state).toBe('open');
  });
});
