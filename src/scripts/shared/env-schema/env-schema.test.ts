import { describe, expect, it } from 'vitest';

import type { GitHubEnv, JiraEnv, LinearEnv } from './env-schema.js';
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
      expect((result.env as JiraEnv).JIRA_BASE_URL).toBe(
        'https://example.atlassian.net',
      );
      expect((result.env as JiraEnv).JIRA_PROJECT_KEY).toBe('PROJ');
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

      expect((result.env as JiraEnv).CLANCY_JQL_STATUS).toBe('In Progress');
      expect((result.env as JiraEnv).CLANCY_JQL_SPRINT).toBe('true');
      expect(result.env.CLANCY_LABEL).toBe('clancy');
      expect(result.env.CLANCY_MODEL).toBe('opus');
    });
  });

  describe('github', () => {
    it('detects GitHub from GITHUB_TOKEN + GITHUB_REPO', () => {
      const result = detectBoard(githubEnv());

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.provider).toBe('github');
      expect((result.env as GitHubEnv).GITHUB_TOKEN).toBe('ghp_abc123');
      expect((result.env as GitHubEnv).GITHUB_REPO).toBe('acme/app');
    });

    it('does not detect GitHub when GITHUB_REPO is missing', () => {
      const result = detectBoard({ GITHUB_TOKEN: 'ghp_abc123' });

      expect(typeof result).toBe('string');
      expect(result).toContain('No board detected');
    });

    it('does not mis-detect Linear as GitHub when GITHUB_TOKEN is a shared git host token', () => {
      const result = detectBoard({
        LINEAR_API_KEY: 'lin_api_abc123',
        LINEAR_TEAM_ID: 'team-uuid-123',
        GITHUB_TOKEN: 'ghp_for_pr_creation',
      });

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.provider).toBe('linear');
    });
  });

  describe('linear', () => {
    it('detects Linear from LINEAR_API_KEY', () => {
      const result = detectBoard(linearEnv());

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.provider).toBe('linear');
      expect((result.env as LinearEnv).LINEAR_API_KEY).toBe('lin_api_abc123');
      expect((result.env as LinearEnv).LINEAR_TEAM_ID).toBe('team-uuid-123');
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
          CLANCY_ROLES: 'planner',
          CLANCY_PLAN_STATUS: 'Backlog',
          CLANCY_PLAN_LABEL: 'needs-refinement',
          CLANCY_PLAN_STATE_TYPE: 'backlog',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_ROLES).toBe('planner');
      expect(result.env.CLANCY_PLAN_STATUS).toBe('Backlog');
      expect(result.env.CLANCY_PLAN_LABEL).toBe('needs-refinement');
      expect(result.env.CLANCY_PLAN_STATE_TYPE).toBe('backlog');
    });

    it('passes through rework loop env vars', () => {
      const result = detectBoard(
        githubEnv({
          CLANCY_MAX_REWORK: '3',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_MAX_REWORK).toBe('3');
    });

    it('passes through CLANCY_STATUS_PLANNED and CLANCY_SKIP_COMMENTS', () => {
      const result = detectBoard(
        jiraEnv({
          CLANCY_STATUS_PLANNED: 'Planned',
          CLANCY_SKIP_COMMENTS: 'true',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_STATUS_PLANNED).toBe('Planned');
      expect(result.env.CLANCY_SKIP_COMMENTS).toBe('true');
    });

    it('accepts valid CLANCY_PLAN_STATE_TYPE enum value', () => {
      const result = detectBoard(
        jiraEnv({
          CLANCY_PLAN_STATE_TYPE: 'backlog',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_PLAN_STATE_TYPE).toBe('backlog');
    });

    it('accepts any CLANCY_PLAN_STATE_TYPE value (validated at runtime by workflow)', () => {
      const result = detectBoard(
        jiraEnv({
          CLANCY_PLAN_STATE_TYPE: 'custom-state',
        }),
      );

      expect(typeof result).not.toBe('string');
    });

    it('passes through CLANCY_TDD when set to true', () => {
      const result = detectBoard(
        githubEnv({
          CLANCY_TDD: 'true',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_TDD).toBe('true');
    });

    it('CLANCY_TDD is optional — config parses without it', () => {
      const result = detectBoard(githubEnv());

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_TDD).toBeUndefined();
    });

    it('rework vars are optional — config parses without them', () => {
      const result = detectBoard(githubEnv());

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_MAX_REWORK).toBeUndefined();
    });

    it('passes through CLANCY_MODE for Jira', () => {
      const result = detectBoard(
        jiraEnv({
          CLANCY_MODE: 'afk',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_MODE).toBe('afk');
    });

    it('passes through CLANCY_MODE for GitHub', () => {
      const result = detectBoard(
        githubEnv({
          CLANCY_MODE: 'afk',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_MODE).toBe('afk');
    });

    it('passes through CLANCY_MODE for Linear', () => {
      const result = detectBoard(
        linearEnv({
          CLANCY_MODE: 'afk',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_MODE).toBe('afk');
    });

    it('passes through strategist env vars', () => {
      const result = detectBoard(
        jiraEnv({
          CLANCY_BRIEF_ISSUE_TYPE: 'Story',
          CLANCY_BRIEF_EPIC: 'PROJ-50',
          CLANCY_COMPONENT: 'backend',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_BRIEF_ISSUE_TYPE).toBe('Story');
      expect(result.env.CLANCY_BRIEF_EPIC).toBe('PROJ-50');
      expect(result.env.CLANCY_COMPONENT).toBe('backend');
    });

    it('strategist vars are optional — config parses without them', () => {
      const result = detectBoard(githubEnv());

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_MODE).toBeUndefined();
      expect(result.env.CLANCY_BRIEF_ISSUE_TYPE).toBeUndefined();
      expect(result.env.CLANCY_BRIEF_EPIC).toBeUndefined();
      expect(result.env.CLANCY_COMPONENT).toBeUndefined();
    });

    it('passes through reliable autonomous mode vars for Jira', () => {
      const result = detectBoard(
        jiraEnv({
          CLANCY_FIX_RETRIES: '3',
          CLANCY_VERIFY_COMMANDS: 'npm test,npm run lint',
          CLANCY_TOKEN_RATE: '0.01',
          CLANCY_TIME_LIMIT: '30',
          CLANCY_BRANCH_GUARD: 'true',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_FIX_RETRIES).toBe('3');
      expect(result.env.CLANCY_VERIFY_COMMANDS).toBe('npm test,npm run lint');
      expect(result.env.CLANCY_TOKEN_RATE).toBe('0.01');
      expect(result.env.CLANCY_TIME_LIMIT).toBe('30');
      expect(result.env.CLANCY_BRANCH_GUARD).toBe('true');
    });

    it('passes through reliable autonomous mode vars for GitHub', () => {
      const result = detectBoard(
        githubEnv({
          CLANCY_FIX_RETRIES: '5',
          CLANCY_VERIFY_COMMANDS: 'npm test',
          CLANCY_TOKEN_RATE: '0.02',
          CLANCY_TIME_LIMIT: '60',
          CLANCY_BRANCH_GUARD: 'false',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_FIX_RETRIES).toBe('5');
      expect(result.env.CLANCY_VERIFY_COMMANDS).toBe('npm test');
      expect(result.env.CLANCY_TOKEN_RATE).toBe('0.02');
      expect(result.env.CLANCY_TIME_LIMIT).toBe('60');
      expect(result.env.CLANCY_BRANCH_GUARD).toBe('false');
    });

    it('passes through reliable autonomous mode vars for Linear', () => {
      const result = detectBoard(
        linearEnv({
          CLANCY_FIX_RETRIES: '2',
          CLANCY_VERIFY_COMMANDS: 'npm run typecheck',
          CLANCY_TOKEN_RATE: '0.005',
          CLANCY_TIME_LIMIT: '45',
          CLANCY_BRANCH_GUARD: 'true',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_FIX_RETRIES).toBe('2');
      expect(result.env.CLANCY_VERIFY_COMMANDS).toBe('npm run typecheck');
      expect(result.env.CLANCY_TOKEN_RATE).toBe('0.005');
      expect(result.env.CLANCY_TIME_LIMIT).toBe('45');
      expect(result.env.CLANCY_BRANCH_GUARD).toBe('true');
    });

    it('reliable autonomous mode vars are optional — config parses without them', () => {
      const result = detectBoard(githubEnv());

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_FIX_RETRIES).toBeUndefined();
      expect(result.env.CLANCY_VERIFY_COMMANDS).toBeUndefined();
      expect(result.env.CLANCY_TOKEN_RATE).toBeUndefined();
      expect(result.env.CLANCY_TIME_LIMIT).toBeUndefined();
      expect(result.env.CLANCY_BRANCH_GUARD).toBeUndefined();
    });

    it('passes through pipeline label vars for Jira', () => {
      const result = detectBoard(
        jiraEnv({
          CLANCY_LABEL_BRIEF: 'clancy:brief',
          CLANCY_LABEL_PLAN: 'clancy:plan',
          CLANCY_LABEL_BUILD: 'clancy:build',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_LABEL_BRIEF).toBe('clancy:brief');
      expect(result.env.CLANCY_LABEL_PLAN).toBe('clancy:plan');
      expect(result.env.CLANCY_LABEL_BUILD).toBe('clancy:build');
    });

    it('passes through pipeline label vars for GitHub', () => {
      const result = detectBoard(
        githubEnv({
          CLANCY_LABEL_BRIEF: 'clancy:brief',
          CLANCY_LABEL_PLAN: 'clancy:plan',
          CLANCY_LABEL_BUILD: 'clancy:build',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_LABEL_BRIEF).toBe('clancy:brief');
      expect(result.env.CLANCY_LABEL_PLAN).toBe('clancy:plan');
      expect(result.env.CLANCY_LABEL_BUILD).toBe('clancy:build');
    });

    it('passes through pipeline label vars for Linear', () => {
      const result = detectBoard(
        linearEnv({
          CLANCY_LABEL_BRIEF: 'clancy:brief',
          CLANCY_LABEL_PLAN: 'clancy:plan',
          CLANCY_LABEL_BUILD: 'clancy:build',
        }),
      );

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_LABEL_BRIEF).toBe('clancy:brief');
      expect(result.env.CLANCY_LABEL_PLAN).toBe('clancy:plan');
      expect(result.env.CLANCY_LABEL_BUILD).toBe('clancy:build');
    });

    it('pipeline label vars are optional — config parses without them', () => {
      const result = detectBoard(githubEnv());

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') return;

      expect(result.env.CLANCY_LABEL_BRIEF).toBeUndefined();
      expect(result.env.CLANCY_LABEL_PLAN).toBeUndefined();
      expect(result.env.CLANCY_LABEL_BUILD).toBeUndefined();
    });
  });
});
