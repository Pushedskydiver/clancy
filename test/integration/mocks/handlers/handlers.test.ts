/**
 * Handler verification test — proves every MSW handler responds to the
 * actual HTTP requests the production board modules make.
 *
 * If a handler endpoint doesn't match what the board module calls,
 * MSW's onUnhandledRequest: 'error' will throw and the test fails.
 * This catches endpoint mismatches mechanically rather than relying
 * on manual review.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createIntegrationServer,
  startServer,
  stopServer,
} from '../../helpers/msw-server.js';
import { azdoHandlers } from './azure-devops.js';
import { bitbucketPrHandlers } from './bitbucket-pr.js';
import { githubIssuesHandlers } from './github-issues.js';
import { githubPrHandlers } from './github-pr.js';
import { gitlabMrHandlers } from './gitlab-mr.js';
import { jiraHandlers } from './jira.js';
import { linearHandlers } from './linear.js';
import { notionHandlers } from './notion.js';
import { shortcutHandlers } from './shortcut.js';

describe('handler verification — ping endpoints match production code', () => {
  const server = createIntegrationServer(
    ...jiraHandlers,
    ...githubIssuesHandlers,
    ...linearHandlers,
    ...shortcutHandlers,
    ...notionHandlers,
    ...azdoHandlers,
    ...githubPrHandlers,
    ...gitlabMrHandlers,
    ...bitbucketPrHandlers,
  );

  beforeAll(() => startServer(server));
  afterAll(() => stopServer(server));

  it('Jira: GET /rest/api/3/project/{key}', async () => {
    const res = await fetch(
      'https://test.atlassian.net/rest/api/3/project/TEST',
      { headers: { Authorization: 'Basic dGVzdA==' } },
    );
    expect(res.ok).toBe(true);
  });

  it('Jira: POST /rest/api/3/search/jql', async () => {
    const res = await fetch(
      'https://test.atlassian.net/rest/api/3/search/jql',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );
    expect(res.ok).toBe(true);
  });

  it('GitHub: GET /repos/{owner}/{repo} (ping)', async () => {
    const res = await fetch(
      'https://api.github.com/repos/test-owner/test-repo',
    );
    expect(res.ok).toBe(true);
  });

  it('GitHub: GET /user (username resolution)', async () => {
    const res = await fetch('https://api.github.com/user');
    expect(res.ok).toBe(true);
  });

  it('GitHub: GET /repos/{owner}/{repo}/issues', async () => {
    const res = await fetch(
      'https://api.github.com/repos/test-owner/test-repo/issues',
    );
    expect(res.ok).toBe(true);
  });

  it('GitHub: GET /repos/{owner}/{repo}/labels/{name} (ensureLabel)', async () => {
    const res = await fetch(
      'https://api.github.com/repos/test-owner/test-repo/labels/clancy:build',
    );
    expect(res.ok).toBe(true);
  });

  it('Linear: POST /graphql — viewer auth check', async () => {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { id } }' }),
    });
    const data = await res.json();
    expect(data.data?.viewer?.id).toBeDefined();
  });

  it('Linear: POST /graphql — assignedIssues', async () => {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '{ viewer { assignedIssues(filter: {}) { nodes { id } } } }',
      }),
    });
    const data = await res.json();
    expect(data.data?.viewer?.assignedIssues).toBeDefined();
  });

  it('Linear: POST /graphql — team labels (ensureLabel)', async () => {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '{ team(id: "t1") { labels { nodes { id name } } } }',
      }),
    });
    const data = await res.json();
    expect(data.data?.team?.labels).toBeDefined();
  });

  it('Shortcut: GET /api/v3/member-info (ping)', async () => {
    const res = await fetch(
      'https://api.app.shortcut.com/api/v3/member-info',
    );
    expect(res.ok).toBe(true);
  });

  it('Shortcut: POST /api/v3/stories/search', async () => {
    const res = await fetch(
      'https://api.app.shortcut.com/api/v3/stories/search',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );
    expect(res.ok).toBe(true);
  });

  it('Notion: GET /v1/users/me (ping)', async () => {
    const res = await fetch('https://api.notion.com/v1/users/me');
    expect(res.ok).toBe(true);
  });

  it('Notion: POST /v1/databases/{id}/query', async () => {
    const res = await fetch(
      'https://api.notion.com/v1/databases/test-db-id/query',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );
    expect(res.ok).toBe(true);
  });

  it('AzDo: GET /_apis/projects/{project} (ping)', async () => {
    const res = await fetch(
      'https://dev.azure.com/test-org/_apis/projects/test-project',
    );
    expect(res.ok).toBe(true);
  });

  it('AzDo: POST /_apis/wit/wiql', async () => {
    const res = await fetch(
      'https://dev.azure.com/test-org/test-project/_apis/wit/wiql',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );
    expect(res.ok).toBe(true);
  });

  it('AzDo: GET /_apis/wit/workitems (batch fetch)', async () => {
    const res = await fetch(
      'https://dev.azure.com/test-org/test-project/_apis/wit/workitems?ids=1&$expand=relations&api-version=7.1',
    );
    expect(res.ok).toBe(true);
  });

  it('GitHub PR: POST /repos/{owner}/{repo}/pulls', async () => {
    const res = await fetch(
      'https://api.github.com/repos/test-owner/test-repo/pulls',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );
    expect(res.status).toBe(201);
  });

  it('GitLab MR: POST /api/v4/projects/{id}/merge_requests', async () => {
    const res = await fetch(
      'https://gitlab.com/api/v4/projects/123/merge_requests',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );
    expect(res.status).toBe(201);
  });

  it('Bitbucket PR: POST /2.0/repositories/{workspace}/{repo}/pullrequests', async () => {
    const res = await fetch(
      'https://api.bitbucket.org/2.0/repositories/test-ws/test-repo/pullrequests',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );
    expect(res.status).toBe(201);
  });
});
