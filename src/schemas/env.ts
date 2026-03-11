/**
 * Zod schemas for `.clancy/.env` configuration variables.
 *
 * Validates board credentials and shared Clancy settings at startup.
 */
import * as z from 'zod/mini';

// ─── Shared optional env vars ────────────────────────────────────────────────

export const sharedEnvSchema = z.object({
  CLANCY_BASE_BRANCH: z.optional(z.string()),
  CLANCY_LABEL: z.optional(z.string()),
  CLANCY_MODEL: z.optional(z.string()),
  CLANCY_NOTIFY_WEBHOOK: z.optional(z.string()),
  CLANCY_STATUS_IN_PROGRESS: z.optional(z.string()),
  CLANCY_STATUS_DONE: z.optional(z.string()),
  MAX_ITERATIONS: z.optional(z.string()),
  PLAYWRIGHT_ENABLED: z.optional(z.string()),
  PLAYWRIGHT_DEV_PORT: z.optional(z.string()),
});

// ─── Board-specific schemas ──────────────────────────────────────────────────

export const jiraEnvSchema = z.extend(sharedEnvSchema, {
  JIRA_BASE_URL: z.string(),
  JIRA_USER: z.string(),
  JIRA_API_TOKEN: z.string(),
  JIRA_PROJECT_KEY: z.string(),
  CLANCY_JQL_STATUS: z.optional(z.string()),
  CLANCY_JQL_SPRINT: z.optional(z.string()),
});

export const githubEnvSchema = z.extend(sharedEnvSchema, {
  GITHUB_TOKEN: z.string(),
  GITHUB_REPO: z.string(),
});

export const linearEnvSchema = z.extend(sharedEnvSchema, {
  LINEAR_API_KEY: z.string(),
  LINEAR_TEAM_ID: z.string(),
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
