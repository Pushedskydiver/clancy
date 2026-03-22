/**
 * Jira — E2E test against real Jira API + GitHub sandbox repo.
 *
 * Creates a real Jira issue, runs the once orchestrator with Claude mocked
 * (simulator), verifies the PR was created on the GitHub sandbox and the
 * progress file was updated, then cleans up.
 *
 * Prerequisites:
 * - .env.e2e with JIRA_BASE_URL, JIRA_USER, JIRA_API_TOKEN, JIRA_PROJECT_KEY
 * - .env.e2e with GITHUB_TOKEN and GITHUB_REPO (for git push + PR creation)
 * - Sandbox Jira project exists with a "Done" transition
 * - clancy:build label exists on the Jira project
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { githubHeaders } from '~/scripts/shared/http/http.js';

import { fetchWithTimeout } from '../helpers/fetch-timeout.js';

import { simulateClaudeSuccess } from '../../integration/helpers/claude-simulator.js';
import {
  createClancyScaffold,
  createTempRepo,
  withCwd,
  type TempRepoResult,
} from '../../integration/helpers/temp-repo.js';

import { cleanupBranch, cleanupPullRequest, cleanupTicket } from '../helpers/cleanup.js';
import { getGitHubCredentials, getJiraCredentials, hasCredentials } from '../helpers/env.js';
import { cleanupGitAuth, configureGitAuth } from '../helpers/git-auth.js';
import {
  createTestTicket,
  generateRunId,
  type CreatedTicket,
} from '../helpers/ticket-factory.js';

// ---------------------------------------------------------------------------
// Skip if credentials not available (need both Jira + GitHub)
// ---------------------------------------------------------------------------

const canRun = hasCredentials('jira') && hasCredentials('github');

// ---------------------------------------------------------------------------
// Module mocks — Claude is always simulated, preflight partially real
// ---------------------------------------------------------------------------

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

describe.skipIf(!canRun)('E2E: Jira — full pipeline', () => {
  const runId = generateRunId();
  let ticket: CreatedTicket | undefined;
  let repo: TempRepoResult | undefined;
  let ticketBranch: string | undefined;
  let prNumber: string | undefined;

  beforeAll(() => {
    const githubCreds = getGitHubCredentials()!;
    configureGitAuth(githubCreds.token);
  });

  afterAll(async () => {
    if (prNumber) {
      await cleanupPullRequest('jira', prNumber).catch(() => {});
    }
    if (repo && ticketBranch) {
      cleanupBranch(repo.repoPath, ticketBranch);
    }
    if (ticket) {
      await cleanupTicket('jira', ticket.key).catch(() => {});
    }
    if (repo) {
      repo.cleanup();
    }
    cleanupGitAuth();
    delete process.env.GIT_ASKPASS;
    delete process.env.GIT_TERMINAL_PROMPT;
    vi.unstubAllEnvs();
  });

  it('creates a ticket, runs the pipeline, and verifies PR creation', async () => {
    const githubCreds = getGitHubCredentials()!;
    const jiraCreds = getJiraCredentials()!;

    // 1. Create test ticket via real Jira API
    ticket = await createTestTicket('jira', runId);
    ticketBranch = `feature/${ticket.key.toLowerCase()}`;

    // 2. Set up temp repo with real remote pointing to sandbox
    repo = createTempRepo();
    const remoteUrl = `https://github.com/${githubCreds.repo}.git`;

    execFileSync('git', ['remote', 'add', 'origin', remoteUrl], {
      cwd: repo.repoPath,
      stdio: 'pipe',
    });

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
      execFileSync('git', ['push', '-u', 'origin', 'main'], {
        cwd: repo.repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    // 3. Create Clancy scaffold with real Jira + GitHub credentials
    createClancyScaffold(repo.repoPath, 'jira', {
      JIRA_BASE_URL: jiraCreds.baseUrl,
      JIRA_USER: jiraCreds.user,
      JIRA_API_TOKEN: jiraCreds.apiToken,
      JIRA_PROJECT_KEY: jiraCreds.projectKey,
      GITHUB_TOKEN: githubCreds.token,
      GITHUB_REPO: githubCreds.repo,
      CLANCY_BASE_BRANCH: 'main',
      CLANCY_LABEL_BUILD: 'clancy-build',
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

    // 4. Configure Claude simulator
    claudeSessionMock = () => {
      simulateClaudeSuccess(repo!.repoPath, ticket!.key);
      return true;
    };

    // 5. Run the orchestrator
    await withCwd(repo.repoPath, () => run(['--skip-feasibility']));

    // 6. Verify locally: feature branch was created
    const branches = execFileSync('git', ['branch', '--list'], {
      cwd: repo.repoPath,
      encoding: 'utf8',
    });
    expect(branches).toContain(ticketBranch);

    // 7. Verify locally: progress.txt has entry
    const progressPath = join(repo.repoPath, '.clancy', 'progress.txt');
    expect(existsSync(progressPath)).toBe(true);

    const progress = readFileSync(progressPath, 'utf8');
    expect(progress).toContain(ticket.key);
    expect(progress).toMatch(/PR_CREATED|PUSHED/);

    // Extract PR number from progress
    const prMatch = progress.match(/pr:(\d+)/);
    expect(prMatch).not.toBeNull();
    prNumber = (prMatch as RegExpMatchArray)[1];

    // 8. Verify via real GitHub API: PR exists on sandbox repo
    {
      const prResponse = await fetchWithTimeout(
        `https://api.github.com/repos/${githubCreds.repo}/pulls/${prNumber}`,
        {
          headers: githubHeaders(githubCreds.token),
        },
      );
      expect(prResponse.ok).toBe(true);

      const prData = (await prResponse.json()) as {
        state: string;
        head: { ref: string };
        base: { ref: string };
      };
      expect(prData.state).toBe('open');
      expect(prData.head.ref).toBe(ticketBranch);
      expect(prData.base.ref).toBe('main');
    }
  });
});
