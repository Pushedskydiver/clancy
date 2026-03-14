import { describe, expect, it } from 'vitest';

import {
  buildApiBaseUrl,
  detectPlatformFromHostname,
  parseRemote,
} from './remote.js';

describe('remote', () => {
  describe('parseRemote', () => {
    // ─── GitHub ──────────────────────────────────────────────────────────
    it('parses GitHub HTTPS URL', () => {
      expect(
        parseRemote('https://github.com/Pushedskydiver/clancy.git'),
      ).toEqual({
        host: 'github',
        owner: 'Pushedskydiver',
        repo: 'clancy',
        hostname: 'github.com',
      });
    });

    it('parses GitHub SSH URL', () => {
      expect(parseRemote('git@github.com:Pushedskydiver/clancy.git')).toEqual({
        host: 'github',
        owner: 'Pushedskydiver',
        repo: 'clancy',
        hostname: 'github.com',
      });
    });

    it('parses GitHub Enterprise HTTPS URL', () => {
      expect(parseRemote('https://github.acme.com/team/project.git')).toEqual({
        host: 'github',
        owner: 'team',
        repo: 'project',
        hostname: 'github.acme.com',
      });
    });

    it('parses GitHub Enterprise SSH URL', () => {
      expect(parseRemote('git@github.acme.com:team/project.git')).toEqual({
        host: 'github',
        owner: 'team',
        repo: 'project',
        hostname: 'github.acme.com',
      });
    });

    it('strips trailing .git', () => {
      expect(parseRemote('https://github.com/owner/repo.git')).toEqual({
        host: 'github',
        owner: 'owner',
        repo: 'repo',
        hostname: 'github.com',
      });
    });

    it('handles URL without .git suffix', () => {
      expect(parseRemote('https://github.com/owner/repo')).toEqual({
        host: 'github',
        owner: 'owner',
        repo: 'repo',
        hostname: 'github.com',
      });
    });

    // ─── GitLab ──────────────────────────────────────────────────────────
    it('parses GitLab HTTPS URL', () => {
      expect(parseRemote('https://gitlab.com/mygroup/myproject.git')).toEqual({
        host: 'gitlab',
        projectPath: 'mygroup/myproject',
        hostname: 'gitlab.com',
      });
    });

    it('parses GitLab SSH URL', () => {
      expect(parseRemote('git@gitlab.com:mygroup/myproject.git')).toEqual({
        host: 'gitlab',
        projectPath: 'mygroup/myproject',
        hostname: 'gitlab.com',
      });
    });

    it('parses GitLab nested group path', () => {
      expect(
        parseRemote('https://gitlab.com/group/subgroup/project.git'),
      ).toEqual({
        host: 'gitlab',
        projectPath: 'group/subgroup/project',
        hostname: 'gitlab.com',
      });
    });

    it('parses self-hosted GitLab', () => {
      expect(parseRemote('https://gitlab.acme.com/team/project.git')).toEqual({
        host: 'gitlab',
        projectPath: 'team/project',
        hostname: 'gitlab.acme.com',
      });
    });

    // ─── Bitbucket Cloud ─────────────────────────────────────────────────
    it('parses Bitbucket Cloud HTTPS URL', () => {
      expect(parseRemote('https://bitbucket.org/workspace/repo.git')).toEqual({
        host: 'bitbucket',
        workspace: 'workspace',
        repoSlug: 'repo',
        hostname: 'bitbucket.org',
      });
    });

    it('parses Bitbucket Cloud HTTPS URL with username', () => {
      expect(
        parseRemote('https://user@bitbucket.org/workspace/repo.git'),
      ).toEqual({
        host: 'bitbucket',
        workspace: 'workspace',
        repoSlug: 'repo',
        hostname: 'bitbucket.org',
      });
    });

    it('parses Bitbucket Cloud SSH URL', () => {
      expect(parseRemote('git@bitbucket.org:workspace/repo.git')).toEqual({
        host: 'bitbucket',
        workspace: 'workspace',
        repoSlug: 'repo',
        hostname: 'bitbucket.org',
      });
    });

    // ─── Bitbucket Server ────────────────────────────────────────────────
    it('parses Bitbucket Server /scm/ URL', () => {
      expect(
        parseRemote('https://bitbucket.acme.com/scm/PROJ/repo.git'),
      ).toEqual({
        host: 'bitbucket-server',
        projectKey: 'PROJ',
        repoSlug: 'repo',
        hostname: 'bitbucket.acme.com',
      });
    });

    // ─── Azure DevOps ────────────────────────────────────────────────────
    it('parses Azure DevOps URL', () => {
      const result = parseRemote('https://dev.azure.com/org/project/_git/repo');
      expect(result.host).toBe('azure');
    });

    // ─── Unknown / Edge cases ────────────────────────────────────────────
    it('returns unknown for unrecognised host', () => {
      expect(parseRemote('https://git.acme.com/team/project.git')).toEqual({
        host: 'unknown',
        url: 'https://git.acme.com/team/project.git',
      });
    });

    it('returns unknown for empty string', () => {
      expect(parseRemote('')).toEqual({
        host: 'unknown',
        url: '',
      });
    });

    it('returns unknown for malformed URL', () => {
      expect(parseRemote('not-a-url')).toEqual({
        host: 'unknown',
        url: 'not-a-url',
      });
    });

    // ─── SSH-URL format ──────────────────────────────────────────────────
    it('parses ssh:// format for GitHub', () => {
      expect(parseRemote('ssh://git@github.com/owner/repo.git')).toEqual({
        host: 'github',
        owner: 'owner',
        repo: 'repo',
        hostname: 'github.com',
      });
    });

    it('parses ssh:// format with port for Bitbucket Server', () => {
      expect(
        parseRemote('ssh://git@bitbucket.acme.com:7999/scm/PROJ/repo.git'),
      ).toEqual({
        host: 'bitbucket-server',
        projectKey: 'PROJ',
        repoSlug: 'repo',
        hostname: 'bitbucket.acme.com',
      });
    });
  });

  describe('detectPlatformFromHostname', () => {
    it('detects github.com', () => {
      expect(detectPlatformFromHostname('github.com')).toBe('github');
    });

    it('detects GitHub Enterprise', () => {
      expect(detectPlatformFromHostname('github.acme.com')).toBe('github');
    });

    it('detects gitlab.com', () => {
      expect(detectPlatformFromHostname('gitlab.com')).toBe('gitlab');
    });

    it('detects self-hosted GitLab', () => {
      expect(detectPlatformFromHostname('gitlab.acme.com')).toBe('gitlab');
    });

    it('detects bitbucket.org', () => {
      expect(detectPlatformFromHostname('bitbucket.org')).toBe('bitbucket');
    });

    it('detects Azure DevOps', () => {
      expect(detectPlatformFromHostname('dev.azure.com')).toBe('azure');
    });

    it('returns unknown for custom domain', () => {
      expect(detectPlatformFromHostname('git.acme.com')).toBe('unknown');
    });
  });

  describe('buildApiBaseUrl', () => {
    it('returns api.github.com for github.com', () => {
      expect(
        buildApiBaseUrl({
          host: 'github',
          owner: 'o',
          repo: 'r',
          hostname: 'github.com',
        }),
      ).toBe('https://api.github.com');
    });

    it('returns GHE API URL for enterprise', () => {
      expect(
        buildApiBaseUrl({
          host: 'github',
          owner: 'o',
          repo: 'r',
          hostname: 'github.acme.com',
        }),
      ).toBe('https://github.acme.com/api/v3');
    });

    it('returns GitLab API URL', () => {
      expect(
        buildApiBaseUrl({
          host: 'gitlab',
          projectPath: 'g/p',
          hostname: 'gitlab.com',
        }),
      ).toBe('https://gitlab.com/api/v4');
    });

    it('returns Bitbucket Cloud API URL', () => {
      expect(
        buildApiBaseUrl({
          host: 'bitbucket',
          workspace: 'w',
          repoSlug: 'r',
          hostname: 'bitbucket.org',
        }),
      ).toBe('https://api.bitbucket.org/2.0');
    });

    it('returns Bitbucket Server API URL', () => {
      expect(
        buildApiBaseUrl({
          host: 'bitbucket-server',
          projectKey: 'P',
          repoSlug: 'r',
          hostname: 'bitbucket.acme.com',
        }),
      ).toBe('https://bitbucket.acme.com/rest/api/1.0');
    });

    it('returns undefined for unknown host', () => {
      expect(
        buildApiBaseUrl({ host: 'unknown', url: 'https://git.acme.com/x' }),
      ).toBeUndefined();
    });

    it('uses apiUrlOverride when provided', () => {
      expect(
        buildApiBaseUrl(
          { host: 'unknown', url: 'https://git.acme.com/x' },
          'https://git.acme.com/api/v4',
        ),
      ).toBe('https://git.acme.com/api/v4');
    });

    it('strips trailing slash from override', () => {
      expect(
        buildApiBaseUrl(
          { host: 'unknown', url: 'x' },
          'https://git.acme.com/api/v4/',
        ),
      ).toBe('https://git.acme.com/api/v4');
    });
  });
});
