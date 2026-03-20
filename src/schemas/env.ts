/**
 * Zod schemas for `.clancy/.env` configuration variables.
 *
 * Validates board credentials and shared Clancy settings at startup.
 */
import * as z from 'zod/mini';

/** A non-empty string — rejects `""` from the .env file. */
const nonEmpty = z.string().check(z.minLength(1));

/** A valid HTTP(S) URL. */
const httpUrl = z.string().check(z.regex(/^https?:\/\/.+/));

// ─── Shared optional env vars ────────────────────────────────────────────────

export const sharedEnvSchema = z.object({
  CLANCY_BASE_BRANCH: z.optional(z.string()),
  CLANCY_LABEL: z.optional(z.string()),
  CLANCY_MODEL: z.optional(z.string()),
  CLANCY_NOTIFY_WEBHOOK: z.optional(z.string()),
  CLANCY_STATUS_IN_PROGRESS: z.optional(z.string()),
  CLANCY_STATUS_DONE: z.optional(z.string()),
  CLANCY_STATUS_REVIEW: z.optional(z.string()),
  MAX_ITERATIONS: z.optional(z.string()),
  PLAYWRIGHT_ENABLED: z.optional(z.string()),
  PLAYWRIGHT_DEV_PORT: z.optional(z.string()),
  CLANCY_ROLES: z.optional(z.string()),
  CLANCY_PLAN_STATUS: z.optional(z.string()),
  CLANCY_PLAN_LABEL: z.optional(z.string()),
  CLANCY_PLAN_STATE_TYPE: z.optional(z.string()),
  CLANCY_STATUS_PLANNED: z.optional(z.string()),
  CLANCY_SKIP_COMMENTS: z.optional(z.string()),

  // Git host integration (for PR creation on non-GitHub boards)
  GITHUB_TOKEN: z.optional(z.string()),
  GITLAB_TOKEN: z.optional(z.string()),
  BITBUCKET_USER: z.optional(z.string()),
  BITBUCKET_TOKEN: z.optional(z.string()),
  CLANCY_GIT_PLATFORM: z.optional(z.string()),
  CLANCY_GIT_API_URL: z.optional(z.string()),

  // QA rework loop
  CLANCY_MAX_REWORK: z.optional(z.string()),

  // Implementation mode
  CLANCY_TDD: z.optional(z.string()),

  // Strategist role
  CLANCY_MODE: z.optional(z.string()),
  CLANCY_BRIEF_ISSUE_TYPE: z.optional(z.string()),
  CLANCY_BRIEF_EPIC: z.optional(z.string()),
  CLANCY_COMPONENT: z.optional(z.string()),

  // Reliable autonomous mode
  CLANCY_FIX_RETRIES: z.optional(z.string()),
  CLANCY_VERIFY_COMMANDS: z.optional(z.string()),
  CLANCY_TOKEN_RATE: z.optional(z.string()),
  CLANCY_TIME_LIMIT: z.optional(z.string()),
  CLANCY_BRANCH_GUARD: z.optional(z.string()),

  // Pipeline stage labels
  CLANCY_LABEL_BRIEF: z.optional(z.string()),
  CLANCY_LABEL_PLAN: z.optional(z.string()),
  CLANCY_LABEL_BUILD: z.optional(z.string()),
});

// ─── Board-specific schemas ──────────────────────────────────────────────────

export const jiraEnvSchema = z.extend(sharedEnvSchema, {
  JIRA_BASE_URL: httpUrl,
  JIRA_USER: nonEmpty,
  JIRA_API_TOKEN: nonEmpty,
  JIRA_PROJECT_KEY: nonEmpty,
  CLANCY_JQL_STATUS: z.optional(z.string()),
  CLANCY_JQL_SPRINT: z.optional(z.string()),
});

export const githubEnvSchema = z.extend(sharedEnvSchema, {
  GITHUB_TOKEN: nonEmpty,
  GITHUB_REPO: nonEmpty,
});

export const linearEnvSchema = z.extend(sharedEnvSchema, {
  LINEAR_API_KEY: nonEmpty,
  LINEAR_TEAM_ID: nonEmpty,
});

// ─── Inferred types ──────────────────────────────────────────────────────────

export type SharedEnv = z.infer<typeof sharedEnvSchema>;
export type JiraEnv = z.infer<typeof jiraEnvSchema>;
export type GitHubEnv = z.infer<typeof githubEnvSchema>;
export type LinearEnv = z.infer<typeof linearEnvSchema>;

// ─── Board config discriminated union ────────────────────────────────────────

export type BoardConfig =
  | { provider: 'jira'; env: JiraEnv }
  | { provider: 'github'; env: GitHubEnv }
  | { provider: 'linear'; env: LinearEnv };
