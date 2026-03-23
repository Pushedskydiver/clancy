import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';

import { resolvePlatformHandlers } from './rework-handlers.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/remote/remote.js', () => ({
  buildApiBaseUrl: vi.fn(() => 'https://api.example.com'),
  detectRemote: vi.fn(() => ({
    host: 'github',
    owner: 'owner',
    repo: 'repo',
    hostname: 'github.com',
  })),
}));

vi.mock('../git-token/git-token.js', () => ({
  resolveGitToken: vi.fn(() => ({ token: 'tok', username: 'user' })),
}));

vi.mock('~/scripts/shared/pull-request/github/github.js', () => ({
  checkPrReviewState: vi.fn(() => Promise.resolve(undefined)),
  fetchPrReviewComments: vi.fn(() => Promise.resolve(['comment'])),
  postPrComment: vi.fn(() => Promise.resolve(true)),
  requestReview: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('~/scripts/shared/pull-request/gitlab/gitlab.js', () => ({
  checkMrReviewState: vi.fn(() => Promise.resolve(undefined)),
  fetchMrReviewComments: vi.fn(() =>
    Promise.resolve({ comments: ['gl-comment'], discussionIds: ['d1'] }),
  ),
  postMrNote: vi.fn(() => Promise.resolve(true)),
  resolveDiscussions: vi.fn(() => Promise.resolve(2)),
}));

vi.mock('~/scripts/shared/pull-request/bitbucket/bitbucket.js', () => ({
  checkPrReviewState: vi.fn(() => Promise.resolve(undefined)),
  checkServerPrReviewState: vi.fn(() => Promise.resolve(undefined)),
  fetchPrReviewComments: vi.fn(() => Promise.resolve(['bb-comment'])),
  fetchServerPrReviewComments: vi.fn(() => Promise.resolve(['bbs-comment'])),
  postCloudPrComment: vi.fn(() => Promise.resolve(true)),
  postServerPrComment: vi.fn(() => Promise.resolve(true)),
}));

const { detectRemote } = await import('~/scripts/shared/remote/remote.js');

const config: BoardConfig = {
  provider: 'github',
  env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolvePlatformHandlers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns undefined for unsupported hosts', () => {
    vi.mocked(detectRemote).mockReturnValue({ host: 'none' });
    expect(resolvePlatformHandlers(config)).toBeUndefined();

    vi.mocked(detectRemote).mockReturnValue({
      host: 'unknown',
      url: 'https://x',
    });
    expect(resolvePlatformHandlers(config)).toBeUndefined();

    vi.mocked(detectRemote).mockReturnValue({
      host: 'azure',
      url: 'https://x',
    });
    expect(resolvePlatformHandlers(config)).toBeUndefined();
  });

  it('returns handlers for GitHub', () => {
    vi.mocked(detectRemote).mockReturnValue({
      host: 'github',
      owner: 'o',
      repo: 'r',
      hostname: 'github.com',
    });

    const h = resolvePlatformHandlers(config);
    expect(h).toBeDefined();
    expect(h!.resolveThreads).toBeDefined();
    expect(h!.reRequestReview).toBeDefined();
  });

  it('GitHub resolveThreads is a no-op returning 0', async () => {
    vi.mocked(detectRemote).mockReturnValue({
      host: 'github',
      owner: 'o',
      repo: 'r',
      hostname: 'github.com',
    });

    const h = resolvePlatformHandlers(config)!;
    expect(await h.resolveThreads(1, ['d1'])).toBe(0);
  });

  it('returns handlers for GitLab', () => {
    vi.mocked(detectRemote).mockReturnValue({
      host: 'gitlab',
      projectPath: 'owner/repo',
      hostname: 'gitlab.com',
    });

    const h = resolvePlatformHandlers(config);
    expect(h).toBeDefined();
  });

  it('GitLab reRequestReview is a no-op returning false', async () => {
    vi.mocked(detectRemote).mockReturnValue({
      host: 'gitlab',
      projectPath: 'owner/repo',
      hostname: 'gitlab.com',
    });

    const h = resolvePlatformHandlers(config)!;
    expect(await h.reRequestReview(1, ['alice'])).toBe(false);
  });

  it('GitLab resolveThreads calls resolveDiscussions', async () => {
    vi.mocked(detectRemote).mockReturnValue({
      host: 'gitlab',
      projectPath: 'owner/repo',
      hostname: 'gitlab.com',
    });

    const h = resolvePlatformHandlers(config)!;
    const resolved = await h.resolveThreads(42, ['d1', 'd2']);
    expect(resolved).toBe(2);
  });

  it('returns handlers for Bitbucket Cloud', () => {
    vi.mocked(detectRemote).mockReturnValue({
      host: 'bitbucket',
      workspace: 'ws',
      repoSlug: 'repo',
      hostname: 'bitbucket.org',
    });

    const h = resolvePlatformHandlers(config);
    expect(h).toBeDefined();
  });

  it('Bitbucket Cloud no-ops return correct defaults', async () => {
    vi.mocked(detectRemote).mockReturnValue({
      host: 'bitbucket',
      workspace: 'ws',
      repoSlug: 'repo',
      hostname: 'bitbucket.org',
    });

    const h = resolvePlatformHandlers(config)!;
    expect(await h.resolveThreads(1, ['d1'])).toBe(0);
    expect(await h.reRequestReview(1, ['alice'])).toBe(false);
  });

  it('returns handlers for Bitbucket Server', () => {
    vi.mocked(detectRemote).mockReturnValue({
      host: 'bitbucket-server',
      projectKey: 'PROJ',
      repoSlug: 'repo',
      hostname: 'bb.acme.com',
    });

    const h = resolvePlatformHandlers(config);
    expect(h).toBeDefined();
  });

  it('GitLab fetchComments returns discussionIds', async () => {
    vi.mocked(detectRemote).mockReturnValue({
      host: 'gitlab',
      projectPath: 'owner/repo',
      hostname: 'gitlab.com',
    });

    const h = resolvePlatformHandlers(config)!;
    const result = await h.fetchComments(1);
    expect(result.comments).toEqual(['gl-comment']);
    expect(result.discussionIds).toEqual(['d1']);
  });

  it('GitHub fetchComments wraps string[] in object without discussionIds', async () => {
    vi.mocked(detectRemote).mockReturnValue({
      host: 'github',
      owner: 'o',
      repo: 'r',
      hostname: 'github.com',
    });

    const h = resolvePlatformHandlers(config)!;
    const result = await h.fetchComments(1);
    expect(result.comments).toEqual(['comment']);
    expect(result.discussionIds).toBeUndefined();
  });
});
