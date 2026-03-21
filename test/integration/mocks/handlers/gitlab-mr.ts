/**
 * MSW handlers for GitLab MR creation.
 * Smoke handler — happy path only.
 */
import { http, HttpResponse } from 'msw';

export const gitlabMrHandlers = [
  http.post(
    'https://gitlab.com/api/v4/projects/:id/merge_requests',
    () =>
      HttpResponse.json(
        {
          iid: 1,
          web_url: 'https://gitlab.com/test/repo/-/merge_requests/1',
          state: 'opened',
        },
        { status: 201 },
      ),
  ),
];
