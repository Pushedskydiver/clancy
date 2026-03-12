import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchIssue as fetchGitHubIssue } from '~/scripts/board/github/github.js';
import { closeIssue } from '~/scripts/board/github/github.js';
import { fetchTicket as fetchJiraTicket } from '~/scripts/board/jira/jira.js';
import { invokeClaudeSession } from '~/scripts/shared/claude-cli/claude-cli.js';
import { detectBoard } from '~/scripts/shared/env-schema/env-schema.js';
import {
  checkout,
  deleteBranch,
  ensureBranch,
  squashMerge,
} from '~/scripts/shared/git-ops/git-ops.js';
import { sendNotification } from '~/scripts/shared/notify/notify.js';
// ─── Import mocked modules ──────────────────────────────────────────────────

import { runPreflight } from '~/scripts/shared/preflight/preflight.js';
import { appendProgress } from '~/scripts/shared/progress/progress.js';

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
  squashMerge: vi.fn(() => true),
}));

vi.mock('~/scripts/shared/claude-cli/claude-cli.js', () => ({
  invokeClaudeSession: vi.fn(() => true),
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

  it('falls back to baseBranch when no epic', async () => {
    setupJiraHappyPath();
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

    expect(mockEnsureBranch).toHaveBeenCalledWith('main', 'main');
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
