/**
 * MSW handlers for GitHub PR creation.
 * Smoke handler — happy path only.
 */
import { http, HttpResponse } from 'msw';

export const githubPrHandlers = [
  // List PRs (used by PR review state checking / rework detection)
  http.get('https://api.github.com/repos/:owner/:repo/pulls', () =>
    HttpResponse.json([]),
  ),

  http.post(
    'https://api.github.com/repos/:owner/:repo/pulls',
    () =>
      HttpResponse.json(
        {
          number: 1,
          html_url: 'https://github.com/test-owner/test-repo/pull/1',
          state: 'open',
        },
        { status: 201 },
      ),
  ),

  // Re-request review
  http.post(
    'https://api.github.com/repos/:owner/:repo/pulls/:number/requested_reviewers',
    () => HttpResponse.json({}, { status: 201 }),
  ),
];
