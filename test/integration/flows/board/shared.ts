/**
 * Shared helpers for per-board integration tests.
 *
 * Each board test file imports from here to avoid duplicating setup/teardown,
 * config objects, spy helpers, and handler factories across 6 files.
 *
 * vi.mock calls CANNOT live here — they are hoisted per-file and must be
 * declared at the top level of each test file.
 */
import { execFileSync } from 'node:child_process';
import { vi } from 'vitest';
import type { RequestHandler } from 'msw';

import { resetUsernameCache } from '~/scripts/board/github/github.js';
import {
  resetLabelCache as resetShortcutLabelCache,
  resetWorkflowCache as resetShortcutWorkflowCache,
} from '~/scripts/board/shortcut/shortcut.js';

import {
  azdoEnv,
  githubEnv,
  githubGitHostEnv,
  jiraEnv,
  linearEnv,
  notionEnv,
  shortcutEnv,
  type BoardProvider,
} from '../../helpers/env-fixtures.js';
import {
  createClancyScaffold,
  createTempRepo,
  type TempRepoResult,
} from '../../helpers/temp-repo.js';
import {
  azdoAuthFailureHandlers,
  azdoBlockedHandlers,
  azdoEmptyHandlers,
  azdoHandlers,
} from '../../mocks/handlers/azure-devops.js';
import {
  githubIssuesAuthFailureHandlers,
  githubIssuesEmptyHandlers,
  githubIssuesHandlers,
} from '../../mocks/handlers/github-issues.js';
import { githubPrHandlers } from '../../mocks/handlers/github-pr.js';
import {
  jiraAuthFailureHandlers,
  jiraBlockedHandlers,
  jiraEmptyHandlers,
  jiraEpicHandlers,
  jiraHandlers,
} from '../../mocks/handlers/jira.js';
import {
  linearAuthFailureHandlers,
  linearBlockedHandlers,
  linearEmptyHandlers,
  linearHandlers,
} from '../../mocks/handlers/linear.js';
import {
  notionAuthFailureHandlers,
  notionEmptyHandlers,
  notionHandlers,
} from '../../mocks/handlers/notion.js';
import {
  shortcutAuthFailureHandlers,
  shortcutBlockedHandlers,
  shortcutEmptyHandlers,
  shortcutHandlers,
} from '../../mocks/handlers/shortcut.js';

// ─── Re-exports ─────────────────────────────────────────────────────────────

export {
  azdoEnv,
  githubEnv,
  githubGitHostEnv,
  jiraEnv,
  linearEnv,
  notionEnv,
  shortcutEnv,
};
export type { BoardProvider, TempRepoResult };
export { createEpicBranch, withCwd } from '../../helpers/temp-repo.js';
export { simulateClaudeSuccess } from '../../helpers/claude-simulator.js';
export {
  createIntegrationServer,
  startServer,
} from '../../helpers/msw-server.js';

// Re-export handler sets for boards that need them directly
export { githubPrHandlers, jiraEpicHandlers };

// ─── Implementer board configs ──────────────────────────────────────────────

export type BoardTestConfig = {
  provider: BoardProvider;
  env: Record<string, string>;
  handlers: RequestHandler[];
  emptyHandlers: RequestHandler[];
  authFailureHandlers: RequestHandler[];
  remoteUrl: string;
  expectedTicketKey: string;
  expectedBranch: string;
  simulatorSlug: string;
};

export type BlockedTestConfig = {
  provider: BoardProvider;
  env: Record<string, string>;
  blockedHandlers: RequestHandler[];
  remoteUrl: string;
};

const REMOTE_URL = 'https://github.com/test-owner/test-repo.git';

export const githubConfig: BoardTestConfig = {
  provider: 'github',
  env: githubEnv,
  handlers: [...githubIssuesHandlers, ...githubPrHandlers],
  emptyHandlers: githubIssuesEmptyHandlers,
  authFailureHandlers: githubIssuesAuthFailureHandlers,
  remoteUrl: REMOTE_URL,
  expectedTicketKey: '#1',
  expectedBranch: 'feature/issue-1',
  simulatorSlug: 'issue-1',
};

export const jiraConfig: BoardTestConfig = {
  provider: 'jira',
  env: jiraEnv,
  handlers: [...jiraHandlers, ...githubPrHandlers],
  emptyHandlers: jiraEmptyHandlers,
  authFailureHandlers: jiraAuthFailureHandlers,
  remoteUrl: REMOTE_URL,
  expectedTicketKey: 'TEST-1',
  expectedBranch: 'feature/test-1',
  simulatorSlug: 'test-1',
};

export const linearConfig: BoardTestConfig = {
  provider: 'linear',
  env: linearEnv,
  handlers: [...linearHandlers, ...githubPrHandlers],
  emptyHandlers: linearEmptyHandlers,
  authFailureHandlers: linearAuthFailureHandlers,
  remoteUrl: REMOTE_URL,
  expectedTicketKey: 'TEAM-1',
  expectedBranch: 'feature/team-1',
  simulatorSlug: 'team-1',
};

export const shortcutConfig: BoardTestConfig = {
  provider: 'shortcut',
  env: shortcutEnv,
  handlers: [...shortcutHandlers, ...githubPrHandlers],
  emptyHandlers: shortcutEmptyHandlers,
  authFailureHandlers: shortcutAuthFailureHandlers,
  remoteUrl: REMOTE_URL,
  expectedTicketKey: 'sc-1',
  expectedBranch: 'feature/sc-1',
  simulatorSlug: 'sc-1',
};

export const notionConfig: BoardTestConfig = {
  provider: 'notion',
  env: notionEnv,
  handlers: [...notionHandlers, ...githubPrHandlers],
  emptyHandlers: notionEmptyHandlers,
  authFailureHandlers: notionAuthFailureHandlers,
  remoteUrl: REMOTE_URL,
  expectedTicketKey: 'notion-ab12cd34',
  expectedBranch: 'feature/notion-ab12cd34',
  simulatorSlug: 'notion-ab12cd34',
};

export const azdoConfig: BoardTestConfig = {
  provider: 'azdo',
  env: azdoEnv,
  handlers: [...azdoHandlers, ...githubPrHandlers],
  emptyHandlers: azdoEmptyHandlers,
  authFailureHandlers: azdoAuthFailureHandlers,
  remoteUrl: REMOTE_URL,
  expectedTicketKey: 'azdo-1',
  expectedBranch: 'feature/azdo-1',
  simulatorSlug: 'azdo-1',
};

// Blocked configs (boards with native blocker detection)
export const jiraBlockedConfig: BlockedTestConfig = {
  provider: 'jira',
  env: jiraEnv,
  blockedHandlers: jiraBlockedHandlers,
  remoteUrl: REMOTE_URL,
};

export const linearBlockedConfig: BlockedTestConfig = {
  provider: 'linear',
  env: linearEnv,
  blockedHandlers: linearBlockedHandlers,
  remoteUrl: REMOTE_URL,
};

export const shortcutBlockedConfig: BlockedTestConfig = {
  provider: 'shortcut',
  env: shortcutEnv,
  blockedHandlers: shortcutBlockedHandlers,
  remoteUrl: REMOTE_URL,
};

export const azdoBlockedConfig: BlockedTestConfig = {
  provider: 'azdo',
  env: azdoEnv,
  blockedHandlers: azdoBlockedHandlers,
  remoteUrl: REMOTE_URL,
};

// ─── Shared setup / teardown ────────────────────────────────────────────────

export function setupTestRepo(
  board: BoardProvider,
  env: Record<string, string>,
  remoteUrl: string,
): TempRepoResult {
  const result = createTempRepo();

  execFileSync('git', ['remote', 'add', 'origin', remoteUrl], {
    cwd: result.repoPath,
    stdio: 'pipe',
  });

  createClancyScaffold(result.repoPath, board, env);

  execFileSync('git', ['add', '-A'], {
    cwd: result.repoPath,
    stdio: 'pipe',
  });
  execFileSync('git', ['commit', '-m', 'chore: add clancy scaffold'], {
    cwd: result.repoPath,
    stdio: 'pipe',
  });

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }

  return result;
}

export function resetMocks(): void {
  vi.unstubAllEnvs();
  resetUsernameCache();
  resetShortcutWorkflowCache();
  resetShortcutLabelCache();
}

// ─── Write operation spy helpers ────────────────────────────────────────────

export type CapturedRequest = {
  method: string;
  url: string;
  body?: unknown;
};

export function createRequestSpy() {
  const captured: CapturedRequest[] = [];
  return {
    captured,
    record(method: string, url: string, body?: unknown) {
      captured.push({ method, url, body });
    },
  };
}

// ─── Write operation constants ──────────────────────────────────────────────

export const JIRA_BASE = 'https://test.atlassian.net';
export const GITHUB_API = 'https://api.github.com';
export const LINEAR_API = 'https://api.linear.app/graphql';
export const SHORTCUT_BASE = 'https://api.app.shortcut.com/api/v3';
export const NOTION_BASE = 'https://api.notion.com';
export const AZDO_BASE =
  'https://dev.azure.com/test-org/test-project/_apis';

export const TEST_LABEL = 'clancy:build';
export const NEW_LABEL = 'clancy:plan';
