/**
 * E2E test credential loading.
 *
 * Loads credentials from .env.e2e (local development) or process.env (CI).
 * Exports per-board credential objects and a hasCredentials check for
 * conditional test skipping.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseEnvContent } from '~/scripts/shared/env-parser/env-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load .env.e2e if it exists, merging into process.env. */
function loadEnvFile(): void {
  const envPath = resolve(__dirname, '../../../.env.e2e');
  if (!existsSync(envPath)) return;

  const parsed = parseEnvContent(readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    // Don't override existing env vars (CI secrets take precedence)
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// Load on import
loadEnvFile();

/** Read an env var, returning undefined if empty. */
function env(key: string): string | undefined {
  const val = process.env[key];
  return val && val.trim() ? val.trim() : undefined;
}

export type E2EBoard =
  | 'github'
  | 'jira'
  | 'linear'
  | 'shortcut'
  | 'notion'
  | 'azdo';

export interface GitHubCredentials {
  token: string;
  repo: string;
}

export interface JiraCredentials {
  baseUrl: string;
  user: string;
  apiToken: string;
  projectKey: string;
}

export interface LinearCredentials {
  apiKey: string;
  teamId: string;
}

export interface ShortcutCredentials {
  token: string;
}

export interface NotionCredentials {
  token: string;
  databaseId: string;
}

export interface AzdoCredentials {
  org: string;
  project: string;
  pat: string;
}

/** Get GitHub credentials or undefined if not available. */
export function getGitHubCredentials(): GitHubCredentials | undefined {
  const token = env('GITHUB_TOKEN');
  const repo = env('GITHUB_REPO');
  if (!token || !repo) return undefined;
  return { token, repo };
}

/** Get Jira credentials or undefined if not available. */
export function getJiraCredentials(): JiraCredentials | undefined {
  const baseUrl = env('JIRA_BASE_URL');
  const user = env('JIRA_USER');
  const apiToken = env('JIRA_API_TOKEN');
  const projectKey = env('JIRA_PROJECT_KEY') ?? 'CLANCYQA';
  if (!baseUrl || !user || !apiToken) return undefined;
  return { baseUrl, user, apiToken, projectKey };
}

/** Get Linear credentials or undefined if not available. */
export function getLinearCredentials(): LinearCredentials | undefined {
  const apiKey = env('LINEAR_API_KEY');
  const teamId = env('LINEAR_TEAM_ID');
  if (!apiKey || !teamId) return undefined;
  return { apiKey, teamId };
}

/** Get Shortcut credentials or undefined if not available. */
export function getShortcutCredentials(): ShortcutCredentials | undefined {
  const token = env('SHORTCUT_TOKEN');
  if (!token) return undefined;
  return { token };
}

/** Get Notion credentials or undefined if not available. */
export function getNotionCredentials(): NotionCredentials | undefined {
  const token = env('NOTION_TOKEN');
  const databaseId = env('NOTION_DATABASE_ID');
  if (!token || !databaseId) return undefined;
  return { token, databaseId };
}

/** Get Azure DevOps credentials or undefined if not available. */
export function getAzdoCredentials(): AzdoCredentials | undefined {
  const org = env('AZURE_ORG');
  const project = env('AZURE_PROJECT');
  const pat = env('AZURE_PAT');
  if (!org || !project || !pat) return undefined;
  return { org, project, pat };
}

/** Check whether credentials are available for a given board. */
export function hasCredentials(board: E2EBoard): boolean {
  switch (board) {
    case 'github':
      return getGitHubCredentials() !== undefined;
    case 'jira':
      return getJiraCredentials() !== undefined;
    case 'linear':
      return getLinearCredentials() !== undefined;
    case 'shortcut':
      return getShortcutCredentials() !== undefined;
    case 'notion':
      return getNotionCredentials() !== undefined;
    case 'azdo':
      return getAzdoCredentials() !== undefined;
  }
}
