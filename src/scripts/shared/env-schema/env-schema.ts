/**
 * Clancy environment validation and board detection.
 *
 * Validates `.clancy/.env` variables using Zod schemas and determines
 * which board provider is configured. Returns a typed discriminated union
 * so downstream code gets board-specific env vars without casting.
 */
import * as z from 'zod/mini';

// ─── Shared optional env vars ────────────────────────────────────────────────

const sharedEnvSchema = z.object({
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

const jiraEnvSchema = z.extend(sharedEnvSchema, {
  JIRA_BASE_URL: z.string(),
  JIRA_USER: z.string(),
  JIRA_API_TOKEN: z.string(),
  JIRA_PROJECT_KEY: z.string(),
  CLANCY_JQL_STATUS: z.optional(z.string()),
  CLANCY_JQL_SPRINT: z.optional(z.string()),
});

const githubEnvSchema = z.extend(sharedEnvSchema, {
  GITHUB_TOKEN: z.string(),
  GITHUB_REPO: z.string(),
});

const linearEnvSchema = z.extend(sharedEnvSchema, {
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

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Detect which board is configured from raw env vars and return a typed config.
 *
 * Detection priority: Jira → GitHub → Linear (checked by presence of
 * board-specific required keys). Returns the first match.
 *
 * @param raw - The raw key-value record from `.clancy/.env`.
 * @returns A typed `BoardConfig` or an error string if no board is detected
 *   or validation fails.
 *
 * @example
 * ```ts
 * const result = detectBoard({ GITHUB_TOKEN: 'ghp_xxx', GITHUB_REPO: 'acme/app' });
 * if (typeof result === 'string') console.error(result);
 * else console.log(result.provider); // 'github'
 * ```
 */
export function detectBoard(raw: Record<string, string>): BoardConfig | string {
  // Jira — check for JIRA_BASE_URL as the distinguishing key
  if (raw.JIRA_BASE_URL) {
    const parsed = jiraEnvSchema.safeParse(raw);

    if (!parsed.success) {
      return `✗ Jira env validation failed: ${parsed.error.message}`;
    }

    return { provider: 'jira', env: parsed.data };
  }

  // GitHub — check for GITHUB_TOKEN as the distinguishing key
  if (raw.GITHUB_TOKEN) {
    const parsed = githubEnvSchema.safeParse(raw);

    if (!parsed.success) {
      return `✗ GitHub env validation failed: ${parsed.error.message}`;
    }

    return { provider: 'github', env: parsed.data };
  }

  // Linear — check for LINEAR_API_KEY as the distinguishing key
  if (raw.LINEAR_API_KEY) {
    const parsed = linearEnvSchema.safeParse(raw);

    if (!parsed.success) {
      return `✗ Linear env validation failed: ${parsed.error.message}`;
    }

    return { provider: 'linear', env: parsed.data };
  }

  return '✗ No board detected — set Jira, GitHub, or Linear credentials in .clancy/.env';
}
