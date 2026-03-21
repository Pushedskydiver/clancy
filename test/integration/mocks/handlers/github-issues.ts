/**
 * MSW handlers for GitHub Issues REST API.
 * Happy path + empty queue + auth failure variants.
 */
import { http, HttpResponse } from 'msw';

import fixture from '../fixtures/github/issue-happy-path.json' with { type: 'json' };

export const githubIssuesHandlers = [
  // Ping — GET /repos/{owner}/{repo}
  http.get('https://api.github.com/repos/:owner/:repo', () =>
    HttpResponse.json({ full_name: 'test-owner/test-repo', private: false }),
  ),

  // Auth / username resolution
  http.get('https://api.github.com/user', () =>
    HttpResponse.json({ login: 'testuser' }),
  ),

  // Issue search
  http.get('https://api.github.com/search/issues', () =>
    HttpResponse.json({ total_count: 1, items: fixture }),
  ),

  // List issues
  http.get('https://api.github.com/repos/:owner/:repo/issues', () =>
    HttpResponse.json(fixture),
  ),

  // Single issue
  http.get(
    'https://api.github.com/repos/:owner/:repo/issues/:number',
    () => HttpResponse.json(fixture[0]),
  ),

  // Labels
  http.post(
    'https://api.github.com/repos/:owner/:repo/issues/:number/labels',
    () => HttpResponse.json([{ name: 'clancy:build' }]),
  ),
  http.delete(
    'https://api.github.com/repos/:owner/:repo/issues/:number/labels/:name',
    () => new HttpResponse(null, { status: 204 }),
  ),

  // Check label exists (ensureLabel does GET first)
  http.get(
    'https://api.github.com/repos/:owner/:repo/labels/:name',
    () => HttpResponse.json({ name: 'clancy:build' }),
  ),

  // Create label (fallback if GET returns 404)
  http.post('https://api.github.com/repos/:owner/:repo/labels', () =>
    HttpResponse.json({ name: 'clancy:build' }, { status: 201 }),
  ),
];

/** Empty queue — no issues returned. */
export const githubIssuesEmptyHandlers = [
  // Ping succeeds
  http.get('https://api.github.com/repos/:owner/:repo', () =>
    HttpResponse.json({ full_name: 'test-owner/test-repo', private: false }),
  ),
  http.get('https://api.github.com/user', () =>
    HttpResponse.json({ login: 'testuser' }),
  ),

  // Issues endpoint returns empty array
  http.get('https://api.github.com/repos/:owner/:repo/issues', () =>
    HttpResponse.json([]),
  ),
  http.get('https://api.github.com/search/issues', () =>
    HttpResponse.json({ total_count: 0, items: [] }),
  ),
];

/** Auth failure — board ping returns 401. */
export const githubIssuesAuthFailureHandlers = [
  // Ping fails with 401
  http.get('https://api.github.com/repos/:owner/:repo', () =>
    HttpResponse.json(
      { message: 'Bad credentials' },
      { status: 401 },
    ),
  ),
];
