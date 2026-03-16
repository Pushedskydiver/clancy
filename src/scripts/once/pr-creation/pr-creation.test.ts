import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';
import type { RemoteInfo } from '~/types/index.js';

import { attemptPrCreation, buildManualPrUrl } from './pr-creation.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/pull-request/github/github.js', () => ({
  createPullRequest: vi.fn(() =>
    Promise.resolve({
      ok: true,
      url: 'https://github.com/o/r/pull/1',
      number: 1,
    }),
  ),
}));

vi.mock('~/scripts/shared/pull-request/gitlab/gitlab.js', () => ({
  createMergeRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://gitlab.com/mr/1', number: 1 }),
  ),
}));

vi.mock('~/scripts/shared/pull-request/bitbucket/bitbucket.js', () => ({
  createPullRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://bitbucket.org/pr/1', number: 1 }),
  ),
  createServerPullRequest: vi.fn(() =>
    Promise.resolve({ ok: true, url: 'https://bb.acme.com/pr/1', number: 1 }),
  ),
}));

vi.mock('~/scripts/shared/remote/remote.js', () => ({
  buildApiBaseUrl: vi.fn(() => 'https://api.github.com'),
}));

const { createPullRequest: mockCreateGitHubPr } =
  await import('~/scripts/shared/pull-request/github/github.js');
const { createMergeRequest: mockCreateGitLabMr } =
  await import('~/scripts/shared/pull-request/gitlab/gitlab.js');
const {
  createPullRequest: mockCreateBBPr,
  createServerPullRequest: mockCreateBBServerPr,
} = await import('~/scripts/shared/pull-request/bitbucket/bitbucket.js');

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

// ─── Tests: attemptPrCreation ────────────────────────────────────────────────

describe('attemptPrCreation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches to GitHub createPullRequest', async () => {
    const result = await attemptPrCreation(
      jiraConfig,
      githubRemote,
      'feature/proj-1',
      'main',
      'feat(PROJ-1): Add login',
      'PR body',
    );

    expect(result).toEqual({
      ok: true,
      url: 'https://github.com/o/r/pull/1',
      number: 1,
    });
    expect(mockCreateGitHubPr).toHaveBeenCalledWith(
      'ghp_test',
      'acme/app',
      'feature/proj-1',
      'main',
      'feat(PROJ-1): Add login',
      'PR body',
      'https://api.github.com',
    );
  });

  it('dispatches to GitLab createMergeRequest', async () => {
    const result = await attemptPrCreation(
      jiraConfig,
      gitlabRemote,
      'feature/proj-1',
      'main',
      'feat(PROJ-1): Add login',
      'MR body',
    );

    expect(result).toEqual({
      ok: true,
      url: 'https://gitlab.com/mr/1',
      number: 1,
    });
    expect(mockCreateGitLabMr).toHaveBeenCalled();
  });

  it('dispatches to Bitbucket Cloud createPullRequest', async () => {
    const result = await attemptPrCreation(
      jiraConfig,
      bitbucketRemote,
      'feature/proj-1',
      'main',
      'title',
      'body',
    );

    expect(result?.ok).toBe(true);
    expect(mockCreateBBPr).toHaveBeenCalled();
  });

  it('dispatches to Bitbucket Server createServerPullRequest', async () => {
    const result = await attemptPrCreation(
      jiraConfig,
      bitbucketServerRemote,
      'feature/proj-1',
      'main',
      'title',
      'body',
    );

    expect(result?.ok).toBe(true);
    expect(mockCreateBBServerPr).toHaveBeenCalled();
  });

  it('returns undefined when no credentials are available', async () => {
    const bare: BoardConfig = {
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
      },
    };

    const result = await attemptPrCreation(
      bare,
      githubRemote,
      'feature/proj-1',
      'main',
      'title',
      'body',
    );

    expect(result).toBeUndefined();
  });
});

// ─── Tests: buildManualPrUrl ─────────────────────────────────────────────────

describe('buildManualPrUrl', () => {
  it('returns GitHub compare URL', () => {
    const url = buildManualPrUrl(githubRemote, 'feature/proj-1', 'main');
    expect(url).toBe(
      'https://github.com/acme/app/compare/main...feature%2Fproj-1',
    );
  });

  it('returns GitLab merge request URL', () => {
    const url = buildManualPrUrl(gitlabRemote, 'feature/proj-1', 'main');
    expect(url).toContain('gitlab.com/acme/app/-/merge_requests/new');
    expect(url).toContain('merge_request[source_branch]=feature%2Fproj-1');
    expect(url).toContain('merge_request[target_branch]=main');
  });

  it('returns Bitbucket Cloud pull request URL', () => {
    const url = buildManualPrUrl(bitbucketRemote, 'feature/proj-1', 'main');
    expect(url).toContain('bitbucket.org/acme/app/pull-requests/new');
    expect(url).toContain('source=feature%2Fproj-1');
  });

  it('returns Bitbucket Server pull request URL', () => {
    const url = buildManualPrUrl(
      bitbucketServerRemote,
      'feature/proj-1',
      'main',
    );
    expect(url).toContain('bb.acme.com/projects/PROJ/repos/app/pull-requests');
    expect(url).toContain('sourceBranch=refs/heads/feature%2Fproj-1');
  });

  it('returns undefined for unknown remote', () => {
    const unknown: RemoteInfo = {
      host: 'unknown',
      url: 'https://git.example.com',
    };
    const url = buildManualPrUrl(unknown, 'feature/proj-1', 'main');
    expect(url).toBeUndefined();
  });

  it('returns undefined for no remote', () => {
    const none: RemoteInfo = { host: 'none' };
    const url = buildManualPrUrl(none, 'feature/proj-1', 'main');
    expect(url).toBeUndefined();
  });
});
