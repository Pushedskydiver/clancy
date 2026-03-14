import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeIssue,
  fetchIssue as fetchGitHubIssue,
  resolveUsername,
} from '~/scripts/board/github/github.js';
import { fetchTicket as fetchJiraTicket } from '~/scripts/board/jira/jira.js';
import { invokeClaudeSession } from '~/scripts/shared/claude-cli/claude-cli.js';
import { detectBoard } from '~/scripts/shared/env-schema/env-schema.js';
import { checkFeasibility } from '~/scripts/shared/feasibility/feasibility.js';
import {
  checkout,
  deleteBranch,
  ensureBranch,
  pushBranch,
  squashMerge,
} from '~/scripts/shared/git-ops/git-ops.js';
import { sendNotification } from '~/scripts/shared/notify/notify.js';
// ─── Import mocked modules ──────────────────────────────────────────────────

import { runPreflight } from '~/scripts/shared/preflight/preflight.js';
import { appendProgress } from '~/scripts/shared/progress/progress.js';
import { createPullRequest as createGitHubPr } from '~/scripts/shared/pull-request/github/github.js';
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
  fetchTicket: vi.fn(),
  isSafeJqlValue: vi.fn(() => true),
  pingJira: vi.fn(() => Promise.resolve({ ok: true })),
  transitionIssue: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/board/github/github.js', () => ({
  closeIssue: vi.fn(() => Promise.resolve(true)),
  fetchIssue: vi.fn(),
  isValidRepo: vi.fn(() => true),
  pingGitHub: vi.fn(() => Promise.resolve({ ok: true })),
  resolveUsername: vi.fn(() => Promise.resolve('testuser')),
}));

vi.mock('~/scripts/shared/pull-request/github/github.js', () => ({
  createPullRequest: vi.fn(() =>
    Promise.resolve({
      ok: true,
      url: 'https://github.com/o/r/pull/1',
      number: 1,
    }),
  ),
}));

vi.mock('~/scripts/board/linear/linear.js', () => ({
  fetchIssue: vi.fn(),
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

vi.mock('~/scripts/shared/progress/progress.js', () => ({
  appendProgress: vi.fn(),
}));

vi.mock('~/scripts/shared/prompt/prompt.js', () => ({
  buildPrompt: vi.fn(() => 'test prompt'),
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
  createMergeRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://gitlab.com/mr/1', number: 1 }),
  ),
}));

vi.mock('~/scripts/shared/pull-request/bitbucket/bitbucket.js', () => ({
  createPullRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://bitbucket.org/pr/1', number: 1 }),
  ),
  createServerPullRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://bb.acme.com/pr/1', number: 1 }),
  ),
}));

vi.mock('~/scripts/shared/pull-request/pr-body/pr-body.js', () => ({
  buildPrBody: vi.fn(() => 'PR body'),
}));

const mockPreflight = vi.mocked(runPreflight);
const mockDetectBoard = vi.mocked(detectBoard);
const mockFetchJira = vi.mocked(fetchJiraTicket);
const mockFetchGitHub = vi.mocked(fetchGitHubIssue);
const mockInvokeClaude = vi.mocked(invokeClaudeSession);
const mockSquashMerge = vi.mocked(squashMerge);
const mockCheckout = vi.mocked(checkout);
const mockEnsureBranch = vi.mocked(ensureBranch);
const mockDeleteBranch = vi.mocked(deleteBranch);
const mockAppendProgress = vi.mocked(appendProgress);
const mockSendNotification = vi.mocked(sendNotification);
const mockCloseIssue = vi.mocked(closeIssue);
const mockResolveUsername = vi.mocked(resolveUsername);
const mockCheckFeasibility = vi.mocked(checkFeasibility);
const mockPushBranch = vi.mocked(pushBranch);
const mockDetectRemote = vi.mocked(detectRemote);
const mockCreateGitHubPr = vi.mocked(createGitHubPr);

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
});
