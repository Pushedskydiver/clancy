import { describe, expect, it } from 'vitest';

import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';
import type { RemoteInfo } from '~/types/index.js';

import { resolveGitToken } from './git-token.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const jiraConfig: BoardConfig = {
  provider: 'jira',
  env: {
    JIRA_BASE_URL: 'https://example.atlassian.net',
    JIRA_USER: 'user@test.com',
    JIRA_API_TOKEN: 'token',
    JIRA_PROJECT_KEY: 'PROJ',
    GITHUB_TOKEN: 'ghp_test',
    GITLAB_TOKEN: 'glpat_test',
    BITBUCKET_USER: 'bb_user',
    BITBUCKET_TOKEN: 'bb_token',
  },
};

const githubRemote: RemoteInfo = {
  host: 'github',
  owner: 'acme',
  repo: 'app',
  hostname: 'github.com',
};

const gitlabRemote: RemoteInfo = {
  host: 'gitlab',
  projectPath: 'acme/app',
  hostname: 'gitlab.com',
};

const bitbucketRemote: RemoteInfo = {
  host: 'bitbucket',
  workspace: 'acme',
  repoSlug: 'app',
  hostname: 'bitbucket.org',
};

const bitbucketServerRemote: RemoteInfo = {
  host: 'bitbucket-server',
  projectKey: 'PROJ',
  repoSlug: 'app',
  hostname: 'bb.acme.com',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolveGitToken', () => {
  it('returns GITHUB_TOKEN for GitHub remote', () => {
    const result = resolveGitToken(jiraConfig, githubRemote);
    expect(result).toEqual({ token: 'ghp_test' });
  });

  it('returns GITLAB_TOKEN for GitLab remote', () => {
    const result = resolveGitToken(jiraConfig, gitlabRemote);
    expect(result).toEqual({ token: 'glpat_test' });
  });

  it('returns BITBUCKET_TOKEN + username for Bitbucket Cloud remote', () => {
    const result = resolveGitToken(jiraConfig, bitbucketRemote);
    expect(result).toEqual({ token: 'bb_token', username: 'bb_user' });
  });

  it('returns BITBUCKET_TOKEN for Bitbucket Server remote', () => {
    const result = resolveGitToken(jiraConfig, bitbucketServerRemote);
    expect(result).toEqual({ token: 'bb_token' });
  });

  it('returns undefined when no matching token is configured', () => {
    const bare: BoardConfig = {
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
      },
    };
    const result = resolveGitToken(bare, githubRemote);
    expect(result).toBeUndefined();
  });

  it('returns undefined for Bitbucket Cloud when only token is set (no user)', () => {
    const noUser: BoardConfig = {
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
        BITBUCKET_TOKEN: 'bb_token',
      },
    };
    const result = resolveGitToken(noUser, bitbucketRemote);
    expect(result).toBeUndefined();
  });

  it('returns undefined for unknown remote host', () => {
    const unknownRemote: RemoteInfo = {
      host: 'unknown',
      url: 'https://git.example.com',
    };
    const result = resolveGitToken(jiraConfig, unknownRemote);
    expect(result).toBeUndefined();
  });
});
