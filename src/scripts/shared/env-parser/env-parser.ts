/**
 * Clancy .env file parser.
 *
 * Reads key=value pairs from `.clancy/.env` files. Supports quoted values,
 * comments, and blank lines. Does NOT use dotenv — zero dependencies.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Parse a .env file content string into a key-value record.
 *
 * Handles single-quoted, double-quoted, and unquoted values.
 * Ignores blank lines and lines starting with `#`.
 *
 * @param content - The raw .env file content.
 * @returns A record of environment variable key-value pairs.
 *
 * @example
 * ```ts
 * parseEnvContent('JIRA_BASE_URL=https://example.atlassian.net\nJIRA_USER=user@example.com');
 * // { JIRA_BASE_URL: 'https://example.atlassian.net', JIRA_USER: 'user@example.com' }
 * ```
 */
export function parseEnvContent(content: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');

    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

/**
 * Load environment variables from a `.clancy/.env` file.
 *
 * @param projectRoot - The root directory of the project containing `.clancy/`.
 * @returns The parsed environment variables, or `undefined` if the file doesn't exist.
 *
 * @example
 * ```ts
 * const env = loadClancyEnv('/path/to/project');
 * // env?.JIRA_BASE_URL === 'https://example.atlassian.net'
 * ```
 */
export function loadClancyEnv(
  projectRoot: string,
): Record<string, string> | undefined {
  const envPath = join(projectRoot, '.clancy', '.env');

  if (!existsSync(envPath)) return undefined;

  const content = readFileSync(envPath, 'utf8');

  return parseEnvContent(content);
}
