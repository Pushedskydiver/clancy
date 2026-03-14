import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeIssue,
  fetchIssue as fetchGitHubIssue,
  fetchReworkIssue as fetchGitHubReworkIssue,
  removeLabel,
  resolveUsername,
} from '~/scripts/board/github/github.js';
import {
  fetchReworkTicket as fetchJiraReworkTicket,
  fetchTicket as fetchJiraTicket,
} from '~/scripts/board/jira/jira.js';
import '~/scripts/board/linear/linear.js';
import { invokeClaudeSession } from '~/scripts/shared/claude-cli/claude-cli.js';
import { detectBoard } from '~/scripts/shared/env-schema/env-schema.js';
import { checkFeasibility } from '~/scripts/shared/feasibility/feasibility.js';
import { fetchFeedback } from '~/scripts/shared/feedback/feedback.js';
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
  findLastEntry,
} from '~/scripts/shared/progress/progress.js';
import {
  checkPrReviewState as checkGitHubPrReviewState,
  createPullRequest as createGitHubPr,
  fetchPrReviewComments as fetchGitHubPrReviewComments,
} from '~/scripts/shared/pull-request/github/github.js';
import { detectRemote } from '~/scripts/shared/remote/remote.js';

import { run } from './once.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/preflight/preflight.js', () => ({
  runPreflight: vi.fn(),
}));

vi.mock('~/scripts/shared/env-schema/env-schema.js', () => ({
  detectBoard: vi.fn(),
}));

vi.mock('~/scripts/board/jira/jira.js', () => ({
  buildAuthHeader: vi.fn(() => 'auth-header'),
  buildJql: vi.fn(() => 'jql-string'),
  extractAdfText: vi.fn(() => ''),
  fetchReworkTicket: vi.fn(),
  fetchTicket: vi.fn(),
  isSafeJqlValue: vi.fn(() => true),
  pingJira: vi.fn(() => Promise.resolve({ ok: true })),
  transitionIssue: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/board/github/github.js', () => ({
  closeIssue: vi.fn(() => Promise.resolve(true)),
  fetchIssue: vi.fn(),
  fetchReworkIssue: vi.fn(),
  isValidRepo: vi.fn(() => true),
  pingGitHub: vi.fn(() => Promise.resolve({ ok: true })),
  removeLabel: vi.fn(() => Promise.resolve(true)),
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
}));

vi.mock('~/scripts/board/linear/linear.js', () => ({
  fetchIssue: vi.fn(),
  fetchReworkIssue: vi.fn(),
  isValidTeamId: vi.fn(() => true),
  pingLinear: vi.fn(() => Promise.resolve({ ok: true })),
  transitionIssue: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/shared/git-ops/git-ops.js', () => ({
  branchExists: vi.fn(() => false),
  checkout: vi.fn(),
  currentBranch: vi.fn(() => 'main'),
  deleteBranch: vi.fn(),
  ensureBranch: vi.fn(),
  fetchRemoteBranch: vi.fn(() => true),
  pushBranch: vi.fn(() => true),
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

vi.mock('~/scripts/shared/feedback/feedback.js', () => ({
  fetchFeedback: vi.fn(() =>
    Promise.resolve({ comments: ['Fix the button colour'] }),
  ),
}));

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  appendProgress: vi.fn(),
  countReworkCycles: vi.fn(() => 0),
  findEntriesWithStatus: vi.fn(() => []),
  findLastEntry: vi.fn(),
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

vi.mock('~/scripts/shared/pull-request/pr-body/pr-body.js', () => ({
  buildPrBody: vi.fn(() => 'PR body'),
}));

const mockPreflight = vi.mocked(runPreflight);
const mockDetectBoard = vi.mocked(detectBoard);
const mockFetchJira = vi.mocked(fetchJiraTicket);
const mockFetchJiraRework = vi.mocked(fetchJiraReworkTicket);
const mockFetchGitHub = vi.mocked(fetchGitHubIssue);
const mockFetchGitHubRework = vi.mocked(fetchGitHubReworkIssue);
const mockRemoveLabel = vi.mocked(removeLabel);
const mockInvokeClaude = vi.mocked(invokeClaudeSession);
const mockSquashMerge = vi.mocked(squashMerge);
const mockCheckout = vi.mocked(checkout);
const mockEnsureBranch = vi.mocked(ensureBranch);
const mockFetchRemoteBranch = vi.mocked(fetchRemoteBranch);
const mockDeleteBranch = vi.mocked(deleteBranch);
const mockAppendProgress = vi.mocked(appendProgress);
const mockCountReworkCycles = vi.mocked(countReworkCycles);
const mockFindLastEntry = vi.mocked(findLastEntry);
const mockFetchFeedback = vi.mocked(fetchFeedback);
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

  mockFetchJira.mockResolvedValue({
    key: 'PROJ-123',
    title: 'Add login page',
    description: 'Create a login page.',
    provider: 'jira',
    epicKey: 'PROJ-100',
    blockers: [],
  });
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

  mockFetchGitHub.mockResolvedValue({
    key: '#42',
    title: 'Fix bug',
    description: 'There is a bug.',
    provider: 'github',
    milestone: 'Sprint 3',
  });
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
    mockFetchFeedback.mockResolvedValue({
      comments: ['Fix the button colour'],
    });
    mockDetectRemote.mockReturnValue({
      host: 'github',
      owner: 'owner',
      repo: 'repo',
      hostname: 'github.com',
    });
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
    mockFetchJira.mockResolvedValue(undefined);

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

  it('runs full Jira lifecycle', async () => {
    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Branches
    expect(mockEnsureBranch).toHaveBeenCalledWith('epic/proj-100', 'main');
    expect(mockCheckout).toHaveBeenCalledWith('epic/proj-100');
    expect(mockCheckout).toHaveBeenCalledWith('feature/proj-123', true);

    // Claude
    expect(mockInvokeClaude).toHaveBeenCalled();

    // Merge
    expect(mockSquashMerge).toHaveBeenCalledWith(
      'feature/proj-123',
      'feat(PROJ-123): Add login page',
    );
    expect(mockDeleteBranch).toHaveBeenCalledWith('feature/proj-123');

    // Progress
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-123',
      'Add login page',
      'DONE',
    );
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
    );

    // Branches use milestone
    expect(mockEnsureBranch).toHaveBeenCalledWith('milestone/sprint-3', 'main');
    expect(mockCheckout).toHaveBeenCalledWith('feature/issue-42', true);

    // Close issue
    expect(mockCloseIssue).toHaveBeenCalledWith('ghp_abc123', 'acme/app', 42);

    // Progress
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      '#42',
      'Fix bug',
      'DONE',
    );
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
    mockFetchJira.mockResolvedValue({
      key: 'PROJ-456',
      title: 'Standalone task',
      description: 'No epic.',
      provider: 'jira',
      blockers: [],
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Target branch is base branch (no epic)
    expect(mockEnsureBranch).toHaveBeenCalledWith('main', 'main');

    // PR flow: push, no squash merge, no delete branch
    expect(mockPushBranch).toHaveBeenCalledWith('feature/proj-456');
    expect(mockSquashMerge).not.toHaveBeenCalled();
    expect(mockDeleteBranch).not.toHaveBeenCalled();

    // Progress logged as PR_CREATED
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-456',
      'Standalone task',
      'PR_CREATED',
    );
  });

  it('uses epic flow when ticket has parent (squash merge)', async () => {
    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Epic flow: squash merge + delete branch
    expect(mockSquashMerge).toHaveBeenCalled();
    expect(mockDeleteBranch).toHaveBeenCalled();
    expect(mockPushBranch).not.toHaveBeenCalled();
  });

  it('logs PUSH_FAILED when push fails', async () => {
    setupJiraHappyPath();
    mockFetchJira.mockResolvedValue({
      key: 'PROJ-789',
      title: 'Push fail test',
      description: 'Test',
      provider: 'jira',
      blockers: [],
    });
    mockPushBranch.mockReturnValue(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-789',
      'Push fail test',
      'PUSH_FAILED',
    );
  });

  it('GitHub PR flow: push + create PR, do not close issue', async () => {
    setupGitHubHappyPath();
    // No milestone = no parent = PR flow
    mockFetchGitHub.mockResolvedValue({
      key: '#99',
      title: 'No milestone',
      description: 'Test',
      provider: 'github',
    });

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

    expect(mockEnsureBranch).toHaveBeenCalled();
    expect(mockInvokeClaude).toHaveBeenCalled();
  });

  it('skips feasibility check when --skip-feasibility is passed', async () => {
    setupJiraHappyPath();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(['--skip-feasibility']);
    log.mockRestore();

    expect(mockCheckFeasibility).not.toHaveBeenCalled();
    expect(mockEnsureBranch).toHaveBeenCalled();
    expect(mockInvokeClaude).toHaveBeenCalled();
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

  it('rework ticket picked up before fresh ticket', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        CLANCY_STATUS_REWORK: 'Rework',
      },
    });
    mockFetchJiraRework.mockResolvedValue({
      key: 'PROJ-200',
      title: 'Rework task',
      description: 'Fix the button.',
      provider: 'jira',
      epicKey: 'PROJ-100',
      blockers: [],
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Rework fetch was called; normal fetch was NOT called
    expect(mockFetchJiraRework).toHaveBeenCalled();
    expect(mockFetchJira).not.toHaveBeenCalled();
    expect(mockInvokeClaude).toHaveBeenCalled();
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
        CLANCY_STATUS_REWORK: 'Rework',
      },
    });
    mockFetchJiraRework.mockResolvedValue({
      key: 'PROJ-200',
      title: 'Rework task',
      description: 'Fix the button.',
      provider: 'jira',
      epicKey: 'PROJ-100',
      blockers: [],
    });
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

  it('rework skips when env vars not configured', async () => {
    setupJiraHappyPath();
    // No CLANCY_STATUS_REWORK set — rework is opt-in

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Normal fetch was used (rework fetch was not called)
    expect(mockFetchJiraRework).not.toHaveBeenCalled();
    expect(mockFetchJira).toHaveBeenCalled();
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
        CLANCY_STATUS_REWORK: 'Rework',
        GITHUB_TOKEN: 'ghp_test',
      },
    });
    mockFetchJiraRework.mockResolvedValue({
      key: 'PROJ-300',
      title: 'PR rework task',
      description: 'Fix it.',
      provider: 'jira',
      blockers: [],
      // No epicKey = no parent = PR flow
    });
    mockFindLastEntry.mockReturnValue({
      timestamp: '2026-03-13 10:00',
      key: 'PROJ-300',
      summary: 'PR rework task',
      status: 'PR_CREATED',
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should fetch remote branch and checkout (not ensureBranch for target)
    expect(mockFetchRemoteBranch).toHaveBeenCalledWith('feature/proj-300');
    expect(mockCheckout).toHaveBeenCalledWith('feature/proj-300');
  });

  it('epic-flow rework creates fix/ branch', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        CLANCY_STATUS_REWORK: 'Rework',
      },
    });
    mockFetchJiraRework.mockResolvedValue({
      key: 'PROJ-400',
      title: 'Epic rework task',
      description: 'Fix it.',
      provider: 'jira',
      epicKey: 'PROJ-100',
      blockers: [],
    });
    mockFindLastEntry.mockReturnValue({
      timestamp: '2026-03-13 10:00',
      key: 'PROJ-400',
      summary: 'Epic rework task',
      status: 'DONE',
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should create fix/ branch from target
    expect(mockCheckout).toHaveBeenCalledWith('fix/proj-400', true);
    // Should squash merge the fix branch
    expect(mockSquashMerge).toHaveBeenCalledWith(
      'fix/proj-400',
      'feat(PROJ-400): Epic rework task',
    );
  });

  it('rework logs as REWORK', async () => {
    setupJiraHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        CLANCY_STATUS_REWORK: 'Rework',
      },
    });
    mockFetchJiraRework.mockResolvedValue({
      key: 'PROJ-500',
      title: 'Rework log test',
      description: 'Fix it.',
      provider: 'jira',
      epicKey: 'PROJ-100',
      blockers: [],
    });
    mockFindLastEntry.mockReturnValue({
      timestamp: '2026-03-13 10:00',
      key: 'PROJ-500',
      summary: 'Rework log test',
      status: 'DONE',
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Should have REWORK in progress (after DONE from deliverViaEpicMerge)
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-500',
      'Rework log test',
      'REWORK',
    );
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
        CLANCY_STATUS_REWORK: 'Rework',
      },
    });
    mockFetchJiraRework.mockResolvedValue({
      key: 'PROJ-600',
      title: 'Rework feasibility test',
      description: 'Fix it.',
      provider: 'jira',
      epicKey: 'PROJ-100',
      blockers: [],
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    // Feasibility check should NOT be called for rework
    expect(mockCheckFeasibility).not.toHaveBeenCalled();
    expect(mockInvokeClaude).toHaveBeenCalled();
  });

  it('GitHub rework removes rework label after pickup', async () => {
    setupGitHubHappyPath();
    mockDetectBoard.mockReturnValue({
      provider: 'github',
      env: {
        GITHUB_TOKEN: 'ghp_abc123',
        GITHUB_REPO: 'acme/app',
        CLANCY_REWORK_LABEL: 'needs-changes',
      },
    });
    mockFetchGitHubRework.mockResolvedValue({
      key: '#55',
      title: 'GitHub rework',
      description: 'Fix it.',
      provider: 'github',
      milestone: 'Sprint 3',
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    log.mockRestore();

    expect(mockRemoveLabel).toHaveBeenCalledWith(
      'ghp_abc123',
      'acme/app',
      55,
      'needs-changes',
    );
  });

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
    mockFetchJira.mockResolvedValue(undefined);
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

    // Should log PR rework message
    expect(mockAppendProgress).toHaveBeenCalledWith(
      expect.any(String),
      'PROJ-500',
      'PR rework from review',
      'REWORK',
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
});
