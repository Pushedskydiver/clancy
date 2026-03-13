import { describe, expect, it } from 'vitest';

import { detectBoard } from './env-schema.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jiraEnv(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    JIRA_BASE_URL: 'https://example.atlassian.net',
    JIRA_USER: 'user@example.com',
    JIRA_API_TOKEN: 'token123',
    JIRA_PROJECT_KEY: 'PROJ',
    ...overrides,
  };
}

function githubEnv(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    GITHUB_TOKEN: 'ghp_abc123',
    GITHUB_REPO: 'acme/app',
    ...overrides,
  };
}

function linearEnv(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    LINEAR_API_KEY: 'lin_api_abc123',
    LINEAR_TEAM_ID: 'team-uuid-123',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('detectBoard', () => {
  describe('jira', () => {
    it('detects Jira from JIRA_BASE_URL', () => {
      const result = detectBoard(jiraEnv());

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.provider).toBe('jira');
      expect(result.env.JIRA_BASE_URL).toBe('https://example.atlassian.net');
      expect(result.env.JIRA_PROJECT_KEY).toBe('PROJ');
    });

    it('returns error when required Jira field is missing', () => {
      const raw = { JIRA_BASE_URL: 'https://example.atlassian.net' };
      const result = detectBoard(raw);

      expect(typeof result).toBe('string');
      expect(result).toContain('Jira env validation failed');
    });

    it('includes optional fields when present', () => {
      const result = detectBoard(
        jiraEnv({
          CLANCY_JQL_STATUS: 'In Progress',
          CLANCY_JQL_SPRINT: 'true',
          CLANCY_LABEL: 'clancy',
          CLANCY_MODEL: 'opus',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_JQL_STATUS).toBe('In Progress');
      expect(result.env.CLANCY_JQL_SPRINT).toBe('true');
      expect(result.env.CLANCY_LABEL).toBe('clancy');
      expect(result.env.CLANCY_MODEL).toBe('opus');
    });
  });

  describe('github', () => {
    it('detects GitHub from GITHUB_TOKEN', () => {
      const result = detectBoard(githubEnv());

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.provider).toBe('github');
      expect(result.env.GITHUB_TOKEN).toBe('ghp_abc123');
      expect(result.env.GITHUB_REPO).toBe('acme/app');
    });

    it('returns error when GITHUB_REPO is missing', () => {
      const result = detectBoard({ GITHUB_TOKEN: 'ghp_abc123' });

      expect(typeof result).toBe('string');
      expect(result).toContain('GitHub env validation failed');
    });
  });

  describe('linear', () => {
    it('detects Linear from LINEAR_API_KEY', () => {
      const result = detectBoard(linearEnv());

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.provider).toBe('linear');
      expect(result.env.LINEAR_API_KEY).toBe('lin_api_abc123');
      expect(result.env.LINEAR_TEAM_ID).toBe('team-uuid-123');
    });

    it('returns error when LINEAR_TEAM_ID is missing', () => {
      const result = detectBoard({ LINEAR_API_KEY: 'lin_api_abc123' });

      expect(typeof result).toBe('string');
      expect(result).toContain('Linear env validation failed');
    });
  });

  describe('priority', () => {
    it('prefers Jira over GitHub when both present', () => {
      const result = detectBoard({ ...jiraEnv(), ...githubEnv() });

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.provider).toBe('jira');
    });

    it('prefers GitHub over Linear when both present', () => {
      const result = detectBoard({ ...githubEnv(), ...linearEnv() });

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.provider).toBe('github');
    });
  });

  describe('no board', () => {
    it('returns error when no board keys present', () => {
      const result = detectBoard({ CLANCY_LABEL: 'clancy' });

      expect(typeof result).toBe('string');
      expect(result).toContain('No board detected');
    });

    it('returns error for empty env', () => {
      const result = detectBoard({});

      expect(typeof result).toBe('string');
      expect(result).toContain('No board detected');
    });
  });

  describe('shared env vars', () => {
    it('passes through shared optional vars', () => {
      const result = detectBoard(
        githubEnv({
          CLANCY_BASE_BRANCH: 'develop',
          CLANCY_NOTIFY_WEBHOOK: 'https://hooks.slack.com/xxx',
          CLANCY_STATUS_IN_PROGRESS: 'In Progress',
          CLANCY_STATUS_DONE: 'Done',
          MAX_ITERATIONS: '10',
          PLAYWRIGHT_ENABLED: 'true',
          PLAYWRIGHT_DEV_PORT: '3000',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_BASE_BRANCH).toBe('develop');
      expect(result.env.CLANCY_NOTIFY_WEBHOOK).toBe(
        'https://hooks.slack.com/xxx',
      );
      expect(result.env.MAX_ITERATIONS).toBe('10');
      expect(result.env.PLAYWRIGHT_ENABLED).toBe('true');
    });

    it('passes through planner env vars', () => {
      const result = detectBoard(
        jiraEnv({
          CLANCY_PLAN_STATUS: 'Backlog',
          CLANCY_PLAN_LABEL: 'needs-refinement',
          CLANCY_PLAN_STATE_TYPE: 'backlog',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_PLAN_STATUS).toBe('Backlog');
      expect(result.env.CLANCY_PLAN_LABEL).toBe('needs-refinement');
      expect(result.env.CLANCY_PLAN_STATE_TYPE).toBe('backlog');
    });
  });
});
