/**
 * Board detection from raw `.clancy/.env` variables.
 *
 * Validates env vars against Zod schemas and returns a typed
 * discriminated union for the detected board provider.
 */
import type { BoardConfig, SharedEnv } from '~/schemas/env.js';
import {
  githubEnvSchema,
  jiraEnvSchema,
  linearEnvSchema,
  notionEnvSchema,
  shortcutEnvSchema,
} from '~/schemas/env.js';

// Re-export types for downstream consumers
export type {
  BoardConfig,
  GitHubEnv,
  JiraEnv,
  LinearEnv,
  NotionEnv,
  SharedEnv,
  ShortcutEnv,
} from '~/schemas/env.js';

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

  // GitHub — check for GITHUB_TOKEN + GITHUB_REPO (GITHUB_TOKEN alone may be
  // a git host token for Jira/Linear users, not a GitHub Issues board)
  if (raw.GITHUB_TOKEN && raw.GITHUB_REPO) {
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

  // Shortcut — check for SHORTCUT_API_TOKEN as the distinguishing key
  if (raw.SHORTCUT_API_TOKEN) {
    const parsed = shortcutEnvSchema.safeParse(raw);

    if (!parsed.success) {
      return `✗ Shortcut env validation failed: ${parsed.error.message}`;
    }

    return { provider: 'shortcut', env: parsed.data };
  }

  // Notion — check for NOTION_DATABASE_ID as the distinguishing key
  if (raw.NOTION_DATABASE_ID) {
    const parsed = notionEnvSchema.safeParse(raw);

    if (!parsed.success) {
      return `✗ Notion env validation failed: ${parsed.error.message}`;
    }

    return { provider: 'notion', env: parsed.data };
  }

  return '✗ No board detected — set Jira, GitHub, Linear, Shortcut, or Notion credentials in .clancy/.env';
}

/** Type-safe access to shared env vars across all board configs. */
export function sharedEnv(config: BoardConfig): SharedEnv {
  return config.env;
}
