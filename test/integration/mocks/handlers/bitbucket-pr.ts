/**
 * MSW handlers for Bitbucket PR creation.
 * Smoke handler — happy path only.
 */
import { http, HttpResponse } from 'msw';

export const bitbucketPrHandlers = [
  http.post(
    'https://api.bitbucket.org/2.0/repositories/:workspace/:repo/pullrequests',
    () =>
      HttpResponse.json(
        {
          id: 1,
          links: {
            html: {
              href: 'https://bitbucket.org/test/repo/pull-requests/1',
            },
          },
          state: 'OPEN',
        },
        { status: 201 },
      ),
  ),
];
