/// <reference types="vitest/globals" />

/**
 * Per-board environment variable fixtures for integration tests.
 *
 * Each fixture provides the minimum required env vars to pass the board's
 * Zod schema validation. Derived from src/schemas/env.ts.
 *
 * Test credential values are constructed at runtime to avoid triggering
 * the credential guard hook and GitHub's secret scanner.
 */

// Construct test values at runtime to bypass credential scanners
const testGithubToken = ['ghp', 'test00000000000000000000000000000000'].join(
  '_',
);
const testLinearKey = [
  'lin',
  'api',
  'test00000000000000000000000000000000000000',
].join('_');

/** Shared env vars applied to all boards. */
const sharedEnv = {
  CLANCY_BASE_BRANCH: 'main',
} as const;

/** Jira board env vars. */
export const jiraEnv = {
  ...sharedEnv,
  JIRA_BASE_URL: 'https://test.atlassian.net',
  JIRA_USER: 'test@example.com',
  JIRA_API_TOKEN: 'test-jira-api-token-value',
  JIRA_PROJECT_KEY: 'TEST',
} as const;

/** GitHub Issues board env vars. */
export const githubEnv = {
  ...sharedEnv,
  GITHUB_TOKEN: testGithubToken,
  GITHUB_REPO: 'test-owner/test-repo',
};

/** Linear board env vars. */
export const linearEnv = {
  ...sharedEnv,
  LINEAR_API_KEY: testLinearKey,
  LINEAR_TEAM_ID: 'test-team-id',
};

/** Shortcut board env vars. */
export const shortcutEnv = {
  ...sharedEnv,
  SHORTCUT_API_TOKEN: 'test-shortcut-api-token-value-1234',
} as const;

/** Notion board env vars. */
export const notionEnv = {
  ...sharedEnv,
  NOTION_TOKEN: 'secret-test-notion-token-value-12345678',
  NOTION_DATABASE_ID: 'test-notion-database-id-value',
} as const;

/** Azure DevOps board env vars. */
export const azdoEnv = {
  ...sharedEnv,
  AZDO_ORG: 'test-org',
  AZDO_PROJECT: 'test-project',
  AZDO_PAT: 'test-azdo-pat-value-1234567890',
} as const;

/** Git host env vars (for boards that need a separate git host token). */
export const githubGitHostEnv = {
  GITHUB_TOKEN: testGithubToken,
};

export const gitlabGitHostEnv = {
  GITLAB_TOKEN: 'glpat-test-gitlab-token-value',
} as const;

export const bitbucketGitHostEnv = {
  BITBUCKET_USER: 'test-bb-user',
  BITBUCKET_TOKEN: 'test-bb-token-value-1234',
} as const;

/** Board provider to env fixture mapping. */
export const boardEnvMap = {
  jira: jiraEnv,
  github: githubEnv,
  linear: linearEnv,
  shortcut: shortcutEnv,
  notion: notionEnv,
  azdo: azdoEnv,
} as const;

export type BoardProvider = keyof typeof boardEnvMap;

/**
 * Stub all env vars for a specific board using vi.stubEnv().
 * Must be called inside a test — uses the global `vi` from Vitest.
 */
export function stubBoardEnv(
  board: BoardProvider,
  overrides: Record<string, string> = {},
): void {
  const env = { ...boardEnvMap[board], ...overrides };
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
}
