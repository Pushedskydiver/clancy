import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeIssue,
  fetchIssues as fetchGitHubIssues,
  resolveUsername,
} from '~/scripts/board/github/github.js';
import { fetchTickets as fetchJiraTickets } from '~/scripts/board/jira/jira.js';
import { invokeClaudeSession } from '~/scripts/shared/claude-cli/claude-cli.js';
import { detectBoard } from '~/scripts/shared/env-schema/env-schema.js';
import { checkFeasibility } from '~/scripts/shared/feasibility/feasibility.js';
import {
  checkout,
  deleteBranch,
  ensureBranch,
  fetchRemoteBranch,
  pushBranch,
  squashMerge,
} from '~/scripts/shared/git-ops/git-ops.js';
import { sendNotification } from '~/scripts/shared/notify/notify.js';
// ─── Import mocked modules ──────────────────────────────────────────────────

import { runPreflight } from '~/scripts/shared/preflight/preflight.js';
import {
  appendProgress,
  countReworkCycles,
  findEntriesWithStatus,
} from '~/scripts/shared/progress/progress.js';
import {
  checkPrReviewState as checkGitHubPrReviewState,
  createPullRequest as createGitHubPr,
  fetchPrReviewComments as fetchGitHubPrReviewComments,
  requestReview as requestGitHubReview,
} from '~/scripts/shared/pull-request/github/github.js';
import { detectRemote } from '~/scripts/shared/remote/remote.js';

import { appendCostEntry } from './cost/cost.js';
import {
  deleteLock,
  deleteVerifyAttempt,
  isLockStale,
  readLock,
  writeLock,
} from './lock/lock.js';
import { run } from './once.js';
import { detectResume, executeResume } from './resume/resume.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/preflight/preflight.js', () => ({
  runPreflight: vi.fn(),
}));

vi.mock('~/scripts/shared/env-schema/env-schema.js', () => ({
  detectBoard: vi.fn(),
  sharedEnv: vi.fn((config: { env: Record<string, string> }) => config.env),
}));

vi.mock('~/scripts/board/factory/factory.js', () => ({
  createBoard: vi.fn(() => ({
    ping: vi.fn(() => Promise.resolve({ ok: true })),
    validateInputs: vi.fn(() => undefined),
    fetchTicket: vi.fn(() => Promise.resolve(undefined)),
    fetchTickets: vi.fn(() => Promise.resolve([])),
    fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
    fetchChildrenStatus: vi.fn(() => Promise.resolve(undefined)),
    transitionTicket: vi.fn(() => Promise.resolve(true)),
    sharedEnv: vi.fn(() => ({})),
  })),
}));

vi.mock('~/scripts/board/jira/jira.js', () => ({
  buildAuthHeader: vi.fn(() => 'auth-header'),
  buildJql: vi.fn(() => 'jql-string'),
  extractAdfText: vi.fn(() => ''),
  fetchChildrenStatus: vi.fn(() => Promise.resolve(undefined)),
  fetchTicket: vi.fn(),
  fetchTickets: vi.fn(() => Promise.resolve([])),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
  isSafeJqlValue: vi.fn(() => true),
  pingJira: vi.fn(() => Promise.resolve({ ok: true })),
  transitionIssue: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/board/github/github.js', () => ({
  closeIssue: vi.fn(() => Promise.resolve(true)),
  fetchChildrenStatus: vi.fn(() => Promise.resolve(undefined)),
  fetchIssue: vi.fn(),
  fetchIssues: vi.fn(() => Promise.resolve([])),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
  isValidRepo: vi.fn(() => true),
  pingGitHub: vi.fn(() => Promise.resolve({ ok: true })),
  resolveUsername: vi.fn(() => Promise.resolve('testuser')),
}));

vi.mock('~/scripts/shared/pull-request/github/github.js', () => ({
  checkPrReviewState: vi.fn(() => Promise.resolve(undefined)),
  createPullRequest: vi.fn(() =>
    Promise.resolve({
      ok: true,
      url: 'https://github.com/o/r/pull/1',
      number: 1,
    }),
  ),
  fetchPrReviewComments: vi.fn(() => Promise.resolve([])),
  postPrComment: vi.fn(() => Promise.resolve(true)),
  requestReview: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/board/linear/linear.js', () => ({
  fetchChildrenStatus: vi.fn(() => Promise.resolve(undefined)),
  fetchIssue: vi.fn(),
  fetchIssues: vi.fn(() => Promise.resolve([])),
  fetchBlockerStatus: vi.fn(() => Promise.resolve(false)),
  isValidTeamId: vi.fn(() => true),
  pingLinear: vi.fn(() => Promise.resolve({ ok: true })),
  transitionIssue: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('~/scripts/shared/git-ops/git-ops.js', () => ({
  branchExists: vi.fn(() => false),
  checkout: vi.fn(),
  currentBranch: vi.fn(() => 'main'),
  deleteBranch: vi.fn(),
  diffAgainstBranch: vi.fn(() => undefined),
  ensureBranch: vi.fn(),
  fetchRemoteBranch: vi.fn(() => true),
  pushBranch: vi.fn(() => true),
  remoteBranchExists: vi.fn(() => false),
  squashMerge: vi.fn(() => true),
}));

vi.mock('~/scripts/shared/claude-cli/claude-cli.js', () => ({
  invokeClaudeSession: vi.fn(() => true),
}));

vi.mock('~/scripts/shared/feasibility/feasibility.js', () => ({
  checkFeasibility: vi.fn(() => ({ feasible: true })),
}));

vi.mock('~/scripts/shared/notify/notify.js', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
}));

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  appendProgress: vi.fn(),
  countReworkCycles: vi.fn(() => 0),
  findEntriesWithStatus: vi.fn(() => []),
}));

vi.mock('~/scripts/shared/prompt/prompt.js', () => ({
  buildPrompt: vi.fn(() => 'test prompt'),
  buildReworkPrompt: vi.fn(() => 'rework prompt'),
}));

vi.mock('~/scripts/shared/remote/remote.js', () => ({
  buildApiBaseUrl: vi.fn(() => 'https://api.github.com'),
  detectRemote: vi.fn(() => ({
    host: 'github',
    owner: 'owner',
    repo: 'repo',
    hostname: 'github.com',
  })),
}));

vi.mock('~/scripts/shared/pull-request/gitlab/gitlab.js', () => ({
  checkMrReviewState: vi.fn(() => Promise.resolve(undefined)),
  createMergeRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://gitlab.com/mr/1', number: 1 }),
  ),
  fetchMrReviewComments: vi.fn(() => Promise.resolve([])),
}));

vi.mock('~/scripts/shared/pull-request/bitbucket/bitbucket.js', () => ({
  checkPrReviewState: vi.fn(() => Promise.resolve(undefined)),
  checkServerPrReviewState: vi.fn(() => Promise.resolve(undefined)),
  createPullRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://bitbucket.org/pr/1', number: 1 }),
  ),
  createServerPullRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://bb.acme.com/pr/1', number: 1 }),
  ),
  fetchPrReviewComments: vi.fn(() => Promise.resolve([])),
  fetchServerPrReviewComments: vi.fn(() => Promise.resolve([])),
}));

vi.mock('./lock/lock.js', () => ({
  readLock: vi.fn(() => undefined),
  writeLock: vi.fn(),
  deleteLock: vi.fn(),
  deleteVerifyAttempt: vi.fn(),
  isLockStale: vi.fn(() => true),
}));

vi.mock('./cost/cost.js', () => ({
  appendCostEntry: vi.fn(),
}));

vi.mock('./resume/resume.js', () => ({
  detectResume: vi.fn(() => undefined),
  executeResume: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/shared/pull-request/pr-body/pr-body.js', () => ({
  buildEpicPrBody: vi.fn(() => 'Epic PR body'),
  buildPrBody: vi.fn(() => 'PR body'),
  isEpicBranch: vi.fn(
    (b: string) => b.startsWith('epic/') || b.startsWith('milestone/'),
  ),
}));

const mockPreflight = vi.mocked(runPreflight);
const mockDetectBoard = vi.mocked(detectBoard);
const mockFetchJira = vi.mocked(fetchJiraTickets);
const mockFetchGitHub = vi.mocked(fetchGitHubIssues);
const mockInvokeClaude = vi.mocked(invokeClaudeSession);
const mockSquashMerge = vi.mocked(squashMerge);
const mockCheckout = vi.mocked(checkout);
const mockEnsureBranch = vi.mocked(ensureBranch);
const mockFetchRemoteBranch = vi.mocked(fetchRemoteBranch);
const mockDeleteBranch = vi.mocked(deleteBranch);
const mockAppendProgress = vi.mocked(appendProgress);
const mockCountReworkCycles = vi.mocked(countReworkCycles);
const mockSendNotification = vi.mocked(sendNotification);
const mockCloseIssue = vi.mocked(closeIssue);
const mockResolveUsername = vi.mocked(resolveUsername);
const mockCheckFeasibility = vi.mocked(checkFeasibility);
const mockPushBranch = vi.mocked(pushBranch);
const mockDetectRemote = vi.mocked(detectRemote);
const mockCreateGitHubPr = vi.mocked(createGitHubPr);
const mockFindEntriesWithStatus = vi.mocked(findEntriesWithStatus);
const mockCheckGitHubPrReviewState = vi.mocked(checkGitHubPrReviewState);
const mockFetchGitHubPrReviewComments = vi.mocked(fetchGitHubPrReviewComments);
const mockRequestGitHubReview = vi.mocked(requestGitHubReview);
const mockReadLock = vi.mocked(readLock);
const mockWriteLock = vi.mocked(writeLock);
const mockDeleteLock = vi.mocked(deleteLock);
const mockDeleteVerifyAttempt = vi.mocked(deleteVerifyAttempt);
const mockIsLockStale = vi.mocked(isLockStale);
const mockAppendCostEntry = vi.mocked(appendCostEntry);
const mockDetectResume = vi.mocked(detectResume);
const mockExecuteResume = vi.mocked(executeResume);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupJiraHappyPath() {
  mockPreflight.mockReturnValue({
    ok: true,
    env: {
      JIRA_BASE_URL: 'https://example.atlassian.net',
      JIRA_USER: 'user@test.com',
      JIRA_API_TOKEN: 'token',
      JIRA_PROJECT_KEY: 'PROJ',
    },
  });

  mockDetectBoard.mockReturnValue({
    provider: 'jira',
    env: {
      JIRA_BASE_URL: 'https://example.atlassian.net',
      JIRA_USER: 'user@test.com',
      JIRA_API_TOKEN: 'token',
      JIRA_PROJECT_KEY: 'PROJ',
    },
  });

  mockFetchJira.mockResolvedValue([
    {
      key: 'PROJ-123',
      title: 'Add login page',
      description: 'Create a login page.',
      provider: 'jira',
      epicKey: 'PROJ-100',
      blockers: [],
    },
  ]);
}

function setupGitHubHappyPath() {
  mockPreflight.mockReturnValue({
    ok: true,
    env: {
      GITHUB_TOKEN: 'ghp_abc123',
      GITHUB_REPO: 'acme/app',
    },
  });

  mockDetectBoard.mockReturnValue({
    provider: 'github',
    env: {
      GITHUB_TOKEN: 'ghp_abc123',
      GITHUB_REPO: 'acme/app',
    },
  });

  mockFetchGitHub.mockResolvedValue([
    {
      key: '#42',
      title: 'Fix bug',
      description: 'There is a bug.',
      provider: 'github',
      milestone: 'Sprint 3',
    },
  ]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default return values cleared by clearAllMocks
    mockPushBranch.mockReturnValue(true);
    mockSquashMerge.mockReturnValue(true);
    mockFetchRemoteBranch.mockReturnValue(true);
    mockCountReworkCycles.mockReturnValue(0);
    mockDetectRemote.mockReturnValue({
      host: 'github',
      owner: 'owner',
      repo: 'repo',
      hostname: 'github.com',
    });
    mockInvokeClaude.mockReturnValue(true);
    mockReadLock.mockReturnValue(undefined);
    mockIsLockStale.mockReturnValue(true);
    mockDetectResume.mockReturnValue(undefined);
    mockRequestGitHubReview.mockResolvedValue(true);
    mockCreateGitHubPr.mockResolvedValue({
      ok: true,
      url: 'https://github.com/o/r/pull/1',
      number: 1,
    });
  });

  it('stops when preflight fails', async () => {
    mockPreflight.mockReturnValue({
      ok: false,
      error: '✗ claude is required but not found',
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockDetectBoard).not.toHaveBeenCalled();
  });

  it('stops when no board is detected', async () => {
    mockPreflight.mockReturnValue({ ok: true, env: {} });
    mockDetectBoard.mockReturnValue('✗ No board detected');

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockFetchJira).not.toHaveBeenCalled();
  });

  it('stops when no tickets found', async () => {
    setupJiraHappyPath();
    mockFetchJira.mockResolvedValue([]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it('runs dry-run without git ops', async () => {
    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(['--dry-run']);
    log.mockRestore();

    expect(mockEnsureBranch).not.toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
    expect(mockSquashMerge).not.toHaveBeenCalled();
  });

  it('runs full Jira lifecycle (parented ticket → epic branch PR)', async () => {
    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Branches: epic branch created, feature from it
    expect(mockCheckout).toHaveBeenCalledWith('feature/proj-123', true);

    // Claude
    expect(mockInvokeClaude).toHaveBeenCalled();

    // PR flow: push (no squash merge)
    expect(mockPushBranch).toHaveBeenCalledWith('feature/proj-123');
    expect(mockSquashMerge).not.toHaveBeenCalled();
    expect(mockDeleteBranch).not.toHaveBeenCalled();
  });

  it('runs full GitHub lifecycle with close', async () => {
    setupGitHubHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Username resolved
    expect(mockResolveUsername).toHaveBeenCalledWith('ghp_abc123');
    expect(mockFetchGitHub).toHaveBeenCalledWith(
      'ghp_abc123',
      'acme/app',
      undefined,
      'testuser',
      false, // excludeHitl
    );

    // Feature branch created
    expect(mockCheckout).toHaveBeenCalledWith('feature/issue-42', true);

    // PR flow: push (no squash merge, no close — PR body has "Part of")
    expect(mockPushBranch).toHaveBeenCalledWith('feature/issue-42');
    expect(mockSquashMerge).not.toHaveBeenCalled();
    expect(mockCloseIssue).not.toHaveBeenCalled();
  });

  it('sends notification when webhook is configured', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        CLANCY_NOTIFY_WEBHOOK: 'https://hooks.slack.com/xxx',
      },
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockSendNotification).toHaveBeenCalledWith(
      'https://hooks.slack.com/xxx',
      '✓ Clancy completed [PROJ-123] Add login page',
    );
  });

  it('skips notification when no webhook configured', async () => {
    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('uses PR flow when ticket has no epic (push + create PR)', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        GITHUB_TOKEN: 'ghp_test',
      },
    });
    mockFetchJira.mockResolvedValue([
      {
        key: 'PROJ-456',
        title: 'Standalone task',
        description: 'No epic.',
        provider: 'jira',
        blockers: [],
      },
    ]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Standalone: branch from base
    expect(mockEnsureBranch).toHaveBeenCalledWith('main', 'main');

    // PR flow: push, no squash merge, no delete branch
    expect(mockPushBranch).toHaveBeenCalledWith('feature/proj-456');
    expect(mockSquashMerge).not.toHaveBeenCalled();
    expect(mockDeleteBranch).not.toHaveBeenCalled();

    // Progress logged as PR_CREATED with PR number
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-456',
      'Standalone task',
      'PR_CREATED',
      1,
      undefined,
    );
  });

  it('uses PR flow for parented tickets targeting epic branch', async () => {
    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Epic branch flow: push + PR (no squash merge)
    expect(mockPushBranch).toHaveBeenCalled();
    expect(mockSquashMerge).not.toHaveBeenCalled();
  });

  it('logs PUSH_FAILED when push fails', async () => {
    setupJiraHappyPath();
    mockFetchJira.mockResolvedValue([
      {
        key: 'PROJ-789',
        title: 'Push fail test',
        description: 'Test',
        provider: 'jira',
        blockers: [],
      },
    ]);
    mockPushBranch.mockReturnValue(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-789',
      'Push fail test',
      'PUSH_FAILED',
      undefined,
      undefined,
    );
  });

  it('GitHub PR flow: push + create PR, do not close issue', async () => {
    setupGitHubHappyPath();
    // No milestone = no parent = PR flow
    mockFetchGitHub.mockResolvedValue([
      {
        key: '#99',
        title: 'No milestone',
        description: 'Test',
        provider: 'github',
      },
    ]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // PR flow
    expect(mockPushBranch).toHaveBeenCalledWith('feature/issue-99');
    expect(mockSquashMerge).not.toHaveBeenCalled();

    // Do NOT close issue (PR body has Closes #99)
    expect(mockCloseIssue).not.toHaveBeenCalled();

    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      '#99',
      'No milestone',
      'PR_CREATED',
      1,
      undefined,
    );
  });

  it('skips ticket when feasibility check fails', async () => {
    setupJiraHappyPath();
    mockCheckFeasibility.mockReturnValue({
      feasible: false,
      reason: 'requires OneTrust admin access',
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // No branch created, no Claude session
    expect(mockEnsureBranch).not.toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();

    // Progress logged as SKIPPED
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-123',
      'Add login page',
      'SKIPPED',
    );
  });

  it('proceeds when feasibility check passes', async () => {
    setupJiraHappyPath();
    mockCheckFeasibility.mockReturnValue({ feasible: true });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockInvokeClaude).toHaveBeenCalled();
    expect(mockPushBranch).toHaveBeenCalled();
  });

  it('skips feasibility check when --skip-feasibility is passed', async () => {
    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(['--skip-feasibility']);
    log.mockRestore();

    expect(mockCheckFeasibility).not.toHaveBeenCalled();
    expect(mockInvokeClaude).toHaveBeenCalled();
    expect(mockPushBranch).toHaveBeenCalled();
  });

  it('handles unexpected errors gracefully', async () => {
    mockPreflight.mockImplementation(() => {
      throw new Error('boom');
    });

    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should not throw — error is caught
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  // ─── Rework tests ──────────────────────────────────────────────────────────

  it('detects PR-based rework from review state', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        GITHUB_TOKEN: 'ghp_test',
      },
    });
    // No fresh tickets
    mockFetchJira.mockResolvedValue([]);
    // PR_CREATED entry in progress
    mockFindEntriesWithStatus.mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-500',
        summary: 'PR rework from review',
        status: 'PR_CREATED',
      },
    ]);
    // PR has changes requested
    mockCheckGitHubPrReviewState.mockResolvedValue({
      changesRequested: true,
      prNumber: 99,
      prUrl: 'https://github.com/o/r/pull/99',
    });
    mockFetchGitHubPrReviewComments.mockResolvedValue([
      'Fix the validation logic',
      '[src/app.ts] Missing null check',
    ]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should log exactly ONE progress entry (REWORK), not double-log
    expect(mockAppendProgress).toHaveBeenCalledTimes(1);
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-500',
      'PR rework from review',
      'REWORK',
      99,
      undefined,
    );
  });

  it('falls through PR rework when no changes requested', async () => {
    setupJiraHappyPath();
    mockFindEntriesWithStatus.mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-600',
        summary: 'Approved PR',
        status: 'PR_CREATED',
      },
    ]);
    mockCheckGitHubPrReviewState.mockResolvedValue({
      changesRequested: false,
      prNumber: 100,
      prUrl: 'https://github.com/o/r/pull/100',
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should fetch fresh ticket instead (Jira happy path has one)
    expect(mockFetchJira).toHaveBeenCalled();
  });

  it('falls through PR rework when no PR_CREATED entries', async () => {
    setupJiraHappyPath();
    mockFindEntriesWithStatus.mockReturnValue([]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should go straight to fresh ticket
    expect(mockFetchJira).toHaveBeenCalled();
    expect(mockCheckGitHubPrReviewState).not.toHaveBeenCalled();
  });

  it('PR rework errors fall through gracefully', async () => {
    setupJiraHappyPath();
    mockFindEntriesWithStatus.mockImplementation(() => {
      throw new Error('filesystem error');
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should still fetch fresh ticket (error caught)
    expect(mockFetchJira).toHaveBeenCalled();
  });

  it('max rework guard triggers SKIPPED', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        GITHUB_TOKEN: 'ghp_test',
      },
    });
    mockFetchJira.mockResolvedValue([]);
    mockFindEntriesWithStatus.mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-200',
        summary: 'Rework task',
        status: 'PR_CREATED',
      },
    ]);
    mockCheckGitHubPrReviewState.mockResolvedValue({
      changesRequested: true,
      prNumber: 99,
      prUrl: 'https://github.com/o/r/pull/99',
    });
    mockFetchGitHubPrReviewComments.mockResolvedValue(['Fix the button']);
    mockCountReworkCycles.mockReturnValue(3);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-200',
      'Rework task',
      'SKIPPED',
    );
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it('rework skips feasibility check', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        GITHUB_TOKEN: 'ghp_test',
      },
    });
    mockFetchJira.mockResolvedValue([]);
    mockFindEntriesWithStatus.mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-600',
        summary: 'Rework feasibility test',
        status: 'PR_CREATED',
      },
    ]);
    mockCheckGitHubPrReviewState.mockResolvedValue({
      changesRequested: true,
      prNumber: 99,
      prUrl: 'https://github.com/o/r/pull/99',
    });
    mockFetchGitHubPrReviewComments.mockResolvedValue(['Fix it']);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Feasibility check should NOT be called for rework
    expect(mockCheckFeasibility).not.toHaveBeenCalled();
    expect(mockInvokeClaude).toHaveBeenCalled();
  });

  it('detects rework from PUSHED entry when PR was created manually', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        GITHUB_TOKEN: 'ghp_test',
      },
    });
    mockFetchJira.mockResolvedValue([]);
    // Return PUSHED entry only on the 'PUSHED' call
    mockFindEntriesWithStatus.mockImplementation(
      (_root: string, status: string) => {
        if (status === 'PUSHED') {
          return [
            {
              timestamp: '2026-03-14 10:00',
              key: 'PROJ-700',
              summary: 'Pushed then manual PR',
              status: 'PUSHED',
            },
          ];
        }
        return [];
      },
    );
    mockCheckGitHubPrReviewState.mockResolvedValue({
      changesRequested: true,
      prNumber: 55,
      prUrl: 'https://github.com/o/r/pull/55',
    });
    mockFetchGitHubPrReviewComments.mockResolvedValue(['Handle edge case']);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should detect rework from PUSHED entry
    expect(mockAppendProgress).toHaveBeenCalledTimes(1);
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-700',
      'Pushed then manual PR',
      'REWORK',
      55,
      undefined,
    );
  });

  it('calls findEntriesWithStatus for all 4 rework-relevant statuses', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        GITHUB_TOKEN: 'ghp_test',
      },
    });
    mockFindEntriesWithStatus.mockReturnValue([]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Epic completion check (4 calls: PR_CREATED, REWORK, PUSHED, EPIC_PR_CREATED) + rework detection (4 calls)
    expect(mockFindEntriesWithStatus).toHaveBeenCalledTimes(8);
    expect(mockFindEntriesWithStatus).toHaveBeenCalledWith(
      expect.any(String),
      'PR_CREATED',
    );
    expect(mockFindEntriesWithStatus).toHaveBeenCalledWith(
      expect.any(String),
      'REWORK',
    );
    expect(mockFindEntriesWithStatus).toHaveBeenCalledWith(
      expect.any(String),
      'PUSHED',
    );
    expect(mockFindEntriesWithStatus).toHaveBeenCalledWith(
      expect.any(String),
      'PUSH_FAILED',
    );
  });

  it('rework creates fresh branch when remote branch is missing', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        GITHUB_TOKEN: 'ghp_test',
      },
    });
    mockFetchJira.mockResolvedValue([]);
    mockFindEntriesWithStatus.mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-400',
        summary: 'PR rework missing branch',
        status: 'PR_CREATED',
      },
    ]);
    mockCheckGitHubPrReviewState.mockResolvedValue({
      changesRequested: true,
      prNumber: 99,
      prUrl: 'https://github.com/o/r/pull/99',
    });
    mockFetchGitHubPrReviewComments.mockResolvedValue(['Fix the issue']);
    mockFetchRemoteBranch.mockReturnValue(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should ensure target branch, then create fresh ticket branch
    expect(mockEnsureBranch).toHaveBeenCalledWith('main', 'main');
    expect(mockCheckout).toHaveBeenCalledWith('main');
    expect(mockCheckout).toHaveBeenCalledWith('feature/proj-400', true);

    // Should NOT squash merge (rework goes through deliverViaPullRequest)
    expect(mockSquashMerge).not.toHaveBeenCalled();
  });

  it('PR-flow rework checks out existing branch', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        GITHUB_TOKEN: 'ghp_test',
      },
    });
    mockFetchJira.mockResolvedValue([]);
    mockFindEntriesWithStatus.mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-300',
        summary: 'PR rework task',
        status: 'PR_CREATED',
      },
    ]);
    mockCheckGitHubPrReviewState.mockResolvedValue({
      changesRequested: true,
      prNumber: 99,
      prUrl: 'https://github.com/o/r/pull/99',
    });
    mockFetchGitHubPrReviewComments.mockResolvedValue(['Fix it']);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should fetch remote branch and checkout
    expect(mockFetchRemoteBranch).toHaveBeenCalledWith('feature/proj-300');
    expect(mockCheckout).toHaveBeenCalledWith('feature/proj-300');
  });

  // ─── Lock file integration ─────────────────────────────────────────────────

  it('writes lock file after branch creation', async () => {
    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockWriteLock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        pid: process.pid,
        ticketKey: 'PROJ-123',
        ticketTitle: 'Add login page',
        ticketBranch: 'feature/proj-123',
      }),
    );
  });

  it('deletes lock file after successful delivery', async () => {
    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockDeleteLock).toHaveBeenCalledWith(expect.any(String));
    expect(mockDeleteVerifyAttempt).toHaveBeenCalledWith(expect.any(String));
  });

  it('deletes lock file on error', async () => {
    setupJiraHappyPath();
    // Force writeLock to succeed (so lockOwner = true), then blow up later
    mockWriteLock.mockImplementation(() => {});
    mockInvokeClaude.mockImplementation(() => {
      throw new Error('Claude crashed');
    });

    const logErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();
    logErr.mockRestore();

    // finally block should clean up
    expect(mockDeleteLock).toHaveBeenCalledWith(expect.any(String));
    expect(mockDeleteVerifyAttempt).toHaveBeenCalledWith(expect.any(String));
  });

  it('aborts when another PID is active', async () => {
    mockReadLock.mockReturnValue({
      pid: 99999,
      ticketKey: 'PROJ-999',
      ticketTitle: 'Other task',
      ticketBranch: 'feature/proj-999',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date().toISOString(),
    });
    mockIsLockStale.mockReturnValue(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should abort before preflight
    expect(mockDetectBoard).not.toHaveBeenCalled();
    expect(mockInvokeClaude).not.toHaveBeenCalled();
  });

  it('cleans up stale lock and attempts resume in AFK mode', async () => {
    const staleLock = {
      pid: 11111,
      ticketKey: 'PROJ-888',
      ticketTitle: 'Stale task',
      ticketBranch: 'feature/proj-888',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date().toISOString(),
    };
    // First call: return stale lock (startup check)
    // Subsequent calls (cost logging): return undefined
    mockReadLock.mockReturnValueOnce(staleLock).mockReturnValue(undefined);
    mockIsLockStale.mockReturnValue(true);
    mockDetectResume.mockReturnValue({
      branch: 'feature/proj-888',
      hasUncommitted: false,
      hasUnpushed: true,
    });
    mockExecuteResume.mockResolvedValue(true);

    // Enable AFK mode for auto-resume
    process.env.CLANCY_AFK_MODE = '1';

    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    delete process.env.CLANCY_AFK_MODE;

    // Should clean up stale lock
    expect(mockDeleteLock).toHaveBeenCalledWith(expect.any(String));
    expect(mockDeleteVerifyAttempt).toHaveBeenCalledWith(expect.any(String));

    // Should attempt resume
    expect(mockDetectResume).toHaveBeenCalledWith(staleLock);
    expect(mockExecuteResume).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'jira' }),
      staleLock,
      expect.objectContaining({ branch: 'feature/proj-888' }),
    );
  });

  it('logs resume info without auto-resuming outside AFK mode', async () => {
    const staleLock = {
      pid: 22222,
      ticketKey: 'PROJ-777',
      ticketTitle: 'Stale non-AFK',
      ticketBranch: 'feature/proj-777',
      targetBranch: 'main',
      parentKey: 'none',
      startedAt: new Date().toISOString(),
    };
    mockReadLock.mockReturnValueOnce(staleLock).mockReturnValue(undefined);
    mockIsLockStale.mockReturnValue(true);
    mockDetectResume.mockReturnValue({
      branch: 'feature/proj-777',
      hasUncommitted: true,
      hasUnpushed: false,
    });

    // Ensure AFK mode is OFF
    delete process.env.CLANCY_AFK_MODE;

    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should NOT call executeResume outside AFK mode
    expect(mockExecuteResume).not.toHaveBeenCalled();

    // Should still proceed with normal ticket flow
    expect(mockInvokeClaude).toHaveBeenCalled();
  });

  // ─── CLANCY_ONCE_ACTIVE ───────────────────────────────────────────────────

  it('sets CLANCY_ONCE_ACTIVE during Claude invocation', async () => {
    setupJiraHappyPath();

    let envDuringInvoke: string | undefined;
    mockInvokeClaude.mockImplementation(() => {
      envDuringInvoke = process.env.CLANCY_ONCE_ACTIVE;
      return true;
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(envDuringInvoke).toBe('1');
    // Should be cleaned up after
    expect(process.env.CLANCY_ONCE_ACTIVE).toBeUndefined();
  });

  it('cleans up CLANCY_ONCE_ACTIVE even when Claude throws', async () => {
    setupJiraHappyPath();
    mockInvokeClaude.mockImplementation(() => {
      throw new Error('Claude crashed');
    });

    const logErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();
    logErr.mockRestore();

    expect(process.env.CLANCY_ONCE_ACTIVE).toBeUndefined();
  });

  // ─── Cost logging ─────────────────────────────────────────────────────────

  it('calls appendCostEntry after delivery', async () => {
    setupJiraHappyPath();
    // readLock returns data for cost logging (after the startup check returns undefined)
    mockReadLock
      .mockReturnValueOnce(undefined) // startup check
      .mockReturnValue({
        pid: process.pid,
        ticketKey: 'PROJ-123',
        ticketTitle: 'Add login page',
        ticketBranch: 'feature/proj-123',
        targetBranch: 'epic/proj-100',
        parentKey: 'PROJ-100',
        startedAt: '2026-03-19T10:00:00.000Z',
      });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockAppendCostEntry).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-123',
      '2026-03-19T10:00:00.000Z',
      6600, // default token rate
    );
  });

  it('does not crash when lock file is missing during cost logging', async () => {
    setupJiraHappyPath();
    // readLock returns undefined for both startup and cost logging
    mockReadLock.mockReturnValue(undefined);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // appendCostEntry should NOT be called (no lock data)
    expect(mockAppendCostEntry).not.toHaveBeenCalled();
    // But the run should complete successfully (push still happens)
    expect(mockPushBranch).toHaveBeenCalled();
  });

  it('re-requests review after rework when reviewers are present', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        GITHUB_TOKEN: 'ghp_test',
      },
    });
    mockFetchJira.mockResolvedValue([]);
    mockFindEntriesWithStatus.mockReturnValue([
      {
        timestamp: '2026-03-14 10:00',
        key: 'PROJ-800',
        summary: 'Rework with reviewers',
        status: 'PR_CREATED',
      },
    ]);
    mockCheckGitHubPrReviewState.mockResolvedValue({
      changesRequested: true,
      prNumber: 77,
      prUrl: 'https://github.com/o/r/pull/77',
      reviewers: ['alice', 'bob'],
    });
    mockFetchGitHubPrReviewComments.mockResolvedValue(['Fix the tests']);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should re-request review from the reviewers who requested changes
    expect(mockRequestGitHubReview).toHaveBeenCalledWith(
      'ghp_test',
      'owner/repo',
      77,
      ['alice', 'bob'],
      'https://api.github.com',
    );
  });
});
