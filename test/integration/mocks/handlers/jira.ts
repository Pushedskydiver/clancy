/**
 * MSW handlers for Jira REST API.
 * Happy path + empty queue + auth failure variants.
 */
import { http, HttpResponse } from 'msw';

import fixture from '../fixtures/jira/issue-happy-path.json' with { type: 'json' };

const BASE = 'https://test.atlassian.net';

export const jiraHandlers = [
  // Ping — GET /rest/api/3/project/{projectKey}
  http.get(`${BASE}/rest/api/3/project/:projectKey`, () =>
    HttpResponse.json({ key: 'TEST', name: 'Test Project' }),
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

/** Empty queue — no issues returned. */
export const jiraEmptyHandlers = [
  http.get(`${BASE}/rest/api/3/project/:projectKey`, () =>
    HttpResponse.json({ key: 'TEST', name: 'Test Project' }),
  ),
  http.post(`${BASE}/rest/api/3/search/jql`, () =>
    HttpResponse.json({ issues: [] }),
  ),
];

/** Auth failure — board ping returns 401. */
export const jiraAuthFailureHandlers = [
  http.get(`${BASE}/rest/api/3/project/:projectKey`, () =>
    HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
  ),
];
