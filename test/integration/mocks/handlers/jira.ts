/**
 * MSW handlers for Jira REST API.
 * Smoke handler — happy path only. Full scenario variants in QA-002a.
 */
import { http, HttpResponse } from 'msw';

import fixture from '../fixtures/jira/issue-happy-path.json';

const BASE = 'https://test.atlassian.net';

export const jiraHandlers = [
  // Auth check
  http.get(`${BASE}/rest/api/2/myself`, () =>
    HttpResponse.json({ emailAddress: 'test@example.com' }),
  ),

  // Ticket search (POST — new Jira endpoint)
  http.post(`${BASE}/rest/api/3/search/jql`, () =>
    HttpResponse.json(fixture),
  ),

  // Transitions lookup
  http.get(`${BASE}/rest/api/3/issue/:key/transitions`, () =>
    HttpResponse.json({
      transitions: [
        { id: '31', name: 'In Progress' },
        { id: '41', name: 'Done' },
      ],
    }),
  ),

  // Transition execution
  http.post(`${BASE}/rest/api/3/issue/:key/transitions`, () =>
    new HttpResponse(null, { status: 204 }),
  ),

  // Label update (PUT full issue)
  http.put(`${BASE}/rest/api/3/issue/:key`, () =>
    new HttpResponse(null, { status: 204 }),
  ),

  // Get issue (for label read before write)
  http.get(`${BASE}/rest/api/3/issue/:key`, () =>
    HttpResponse.json(fixture.issues[0]),
  ),
];
