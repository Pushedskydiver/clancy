/**
 * MSW handlers for GitHub Issues REST API.
 * Smoke handler — happy path only. Full scenario variants in QA-002a.
 */
import { http, HttpResponse } from 'msw';

import fixture from '../fixtures/github/issue-happy-path.json';

export const githubIssuesHandlers = [
  // Auth check
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

  // Ensure label exists
  http.post('https://api.github.com/repos/:owner/:repo/labels', () =>
    HttpResponse.json({ name: 'clancy:build' }, { status: 201 }),
  ),
];
