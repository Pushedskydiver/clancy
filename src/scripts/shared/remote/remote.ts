/**
 * Remote git host detection.
 *
 * Parses `git remote get-url origin` to detect the hosting platform
 * (GitHub, GitLab, Bitbucket, etc.) and extract owner/repo/project info.
 */
import { execFileSync } from 'node:child_process';

import type { GitPlatform, RemoteInfo } from '~/types/index.js';

/**
 * Extract hostname and path from a raw git remote URL.
 *
 * Strips `.git` suffix, then tries SSH (`git@host:path`) and
 * HTTPS/SSH-URL (`https://host/path`, `ssh://git@host/path`) formats.
 *
 * @param rawUrl - The raw git remote URL.
 * @returns The extracted hostname and path, or `undefined` if unparseable.
 */
function extractHostAndPath(
  rawUrl: string,
): { hostname: string; path: string } | undefined {
  const url = rawUrl.trim().replace(/\.git$/, '');

  // SSH format: git@<host>:<path>
  const sshMatch = url.match(/^git@([^:]+):(.+)$/);

  // HTTPS or SSH-URL format: https://<host>/<path> or ssh://git@<host>/<path>
  const httpsMatch = url.match(
    /^(?:https?|ssh):\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/,
  );

  const hostname = sshMatch?.[1] ?? httpsMatch?.[1];
  const path = sshMatch?.[2] ?? httpsMatch?.[2];

  if (!hostname || !path) return undefined;

  return { hostname, path };
}

/**
 * Parse a git remote URL into platform-specific info.
 *
 * Supports HTTPS, SSH, and SSH-URL formats for GitHub, GitLab, Bitbucket
 * (Cloud and Server), Azure DevOps, and self-hosted instances.
 *
 * @param rawUrl - The raw git remote URL.
 * @returns Parsed remote info with platform and path details.
 */
export function parseRemote(rawUrl: string): RemoteInfo {
  const extracted = extractHostAndPath(rawUrl);

  if (!extracted) {
    return { host: 'unknown', url: rawUrl };
  }

  const { hostname, path } = extracted;

  const platform = detectPlatformFromHostname(hostname);

  switch (platform) {
    case 'github': {
      const parts = path.split('/');
      if (parts.length >= 2) {
        return {
          host: 'github',
          owner: parts[0],
          repo: parts[1],
          hostname,
        };
      }
      return { host: 'unknown', url: rawUrl };
    }

    case 'gitlab': {
      return {
        host: 'gitlab',
        projectPath: path,
        hostname,
      };
    }

    case 'bitbucket': {
      // Bitbucket Server uses /scm/<projectKey>/<repo> format
      const scmMatch = path.match(/^scm\/([^/]+)\/(.+)$/);
      if (scmMatch) {
        return {
          host: 'bitbucket-server',
          projectKey: scmMatch[1],
          repoSlug: scmMatch[2],
          hostname,
        };
      }

      // Bitbucket Cloud: <workspace>/<repo>
      const parts = path.split('/');
      if (parts.length >= 2) {
        return {
          host: 'bitbucket',
          workspace: parts[0],
          repoSlug: parts[1],
          hostname,
        };
      }
      return { host: 'unknown', url: rawUrl };
    }

    case 'azure':
      return { host: 'azure', url: rawUrl };

    default:
      return { host: 'unknown', url: rawUrl };
  }
}

/**
 * Detect the git hosting platform from a hostname.
 *
 * Uses known domain patterns. Self-hosted instances with custom domains
 * (e.g. `git.acme.com`) fall through to 'unknown' — use `CLANCY_GIT_PLATFORM`
 * env var to override.
 *
 * @param hostname - The hostname from the remote URL.
 * @returns The detected platform.
 */
export function detectPlatformFromHostname(hostname: string): GitPlatform {
  const lower = hostname.toLowerCase();

  if (lower === 'github.com' || lower.includes('github')) return 'github';
  if (lower === 'gitlab.com' || lower.includes('gitlab')) return 'gitlab';
  if (lower === 'bitbucket.org' || lower.includes('bitbucket'))
    return 'bitbucket';
  if (lower.includes('dev.azure') || lower.includes('visualstudio'))
    return 'azure';

  return 'unknown';
}

/**
 * Detect the remote origin info from the current git repository.
 *
 * Falls back to `{ host: 'none' }` if no remote is configured or
 * if the command fails.
 *
 * @param platformOverride - Override platform detection (from `CLANCY_GIT_PLATFORM` env var).
 * @returns Parsed remote info.
 */
export function detectRemote(platformOverride?: string): RemoteInfo {
  let rawUrl: string;

  try {
    rawUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return { host: 'none' };
  }

  if (!rawUrl) return { host: 'none' };

  // If user explicitly overrides the platform, always use it — they know better
  if (platformOverride) {
    return overrideRemotePlatform(rawUrl, platformOverride);
  }

  return parseRemote(rawUrl);
}

/**
 * Re-parse a remote URL with a known platform override.
 *
 * Used when auto-detection fails (self-hosted with custom domain)
 * and the user sets `CLANCY_GIT_PLATFORM`.
 */
function overrideRemotePlatform(rawUrl: string, platform: string): RemoteInfo {
  const extracted = extractHostAndPath(rawUrl);

  if (!extracted) return { host: 'unknown', url: rawUrl };

  const { hostname, path } = extracted;

  switch (platform.toLowerCase()) {
    case 'github': {
      const parts = path.split('/');
      if (parts.length >= 2) {
        return { host: 'github', owner: parts[0], repo: parts[1], hostname };
      }
      return { host: 'unknown', url: rawUrl };
    }
    case 'gitlab':
      return { host: 'gitlab', projectPath: path, hostname };
    case 'bitbucket': {
      const parts = path.split('/');
      if (parts.length >= 2) {
        return {
          host: 'bitbucket',
          workspace: parts[0],
          repoSlug: parts[1],
          hostname,
        };
      }
      return { host: 'unknown', url: rawUrl };
    }
    case 'bitbucket-server': {
      // Strip leading scm/ prefix used in Bitbucket Server URLs
      const scmMatch = path.match(/^scm\/([^/]+)\/(.+)$/);
      if (scmMatch) {
        return {
          host: 'bitbucket-server',
          projectKey: scmMatch[1],
          repoSlug: scmMatch[2],
          hostname,
        };
      }
      const parts = path.split('/');
      if (parts.length >= 2) {
        return {
          host: 'bitbucket-server',
          projectKey: parts[0],
          repoSlug: parts[1],
          hostname,
        };
      }
      return { host: 'unknown', url: rawUrl };
    }
    default:
      return { host: 'unknown', url: rawUrl };
  }
}

/**
 * Build the API base URL for a given remote.
 *
 * @param remote - The parsed remote info.
 * @param apiUrlOverride - Override from `CLANCY_GIT_API_URL` env var.
 * @returns The API base URL, or undefined if not applicable.
 */
export function buildApiBaseUrl(
  remote: RemoteInfo,
  apiUrlOverride?: string,
): string | undefined {
  if (apiUrlOverride) return apiUrlOverride.replace(/\/$/, '');

  switch (remote.host) {
    case 'github':
      return remote.hostname === 'github.com'
        ? 'https://api.github.com'
        : `https://${remote.hostname}/api/v3`;
    case 'gitlab':
      return `https://${remote.hostname}/api/v4`;
    case 'bitbucket':
      return 'https://api.bitbucket.org/2.0';
    case 'bitbucket-server':
      return `https://${remote.hostname}/rest/api/1.0`;
    default:
      return undefined;
  }
}
