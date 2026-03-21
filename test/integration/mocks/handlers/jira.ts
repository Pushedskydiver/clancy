/**
 * MSW handlers for Jira REST API.
 * Happy path + empty queue + auth failure + blocked ticket variants.
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

/**
 * Epic ticket — search returns a ticket with a parent (epic), and the
 * children status query returns multiple children (no single-child skip).
 */
export const jiraEpicHandlers = [
  // Ping
  http.get(`${BASE}/rest/api/3/project/:projectKey`, () =>
    HttpResponse.json({ key: 'TEST', name: 'Test Project' }),
  ),

  // Ticket search AND children status both use POST /search/jql.
  // Differentiate by maxResults (0 = children count query).
  http.post(`${BASE}/rest/api/3/search/jql`, async ({ request }) => {
    const body = (await request.json()) as {
      maxResults?: number;
      jql?: string;
    };

    if (body.maxResults === 0) {
      // Children status query — return 2 children (prevents single-child skip)
      return HttpResponse.json({ total: 2, issues: [] });
    }

    // Normal ticket search — return ticket with parent
    return HttpResponse.json({
      issues: [
        {
          key: 'TEST-1',
          fields: {
            ...fixture.issues[0].fields,
            parent: { key: 'TEST-100' },
          },
        },
      ],
    });
  }),

  // Transitions
  http.get(`${BASE}/rest/api/3/issue/:key/transitions`, () =>
    HttpResponse.json({
      transitions: [
        { id: '31', name: 'In Progress' },
        { id: '41', name: 'Done' },
      ],
    }),
  ),
  http.post(`${BASE}/rest/api/3/issue/:key/transitions`, () =>
    new HttpResponse(null, { status: 204 }),
  ),

  // Label update
  http.put(`${BASE}/rest/api/3/issue/:key`, () =>
    new HttpResponse(null, { status: 204 }),
  ),

  // Get issue (blocker check — no blockers)
  http.get(`${BASE}/rest/api/3/issue/:key`, () =>
    HttpResponse.json({
      key: 'TEST-1',
      fields: {
        ...fixture.issues[0].fields,
        parent: { key: 'TEST-100' },
        issuelinks: [],
      },
    }),
  ),
];

/**
 * Blocked ticket — search returns a ticket, but issuelinks indicate
 * an unresolved blocker (inward "Blocks" link with non-done status).
 */
export const jiraBlockedHandlers = [
  // Ping
  http.get(`${BASE}/rest/api/3/project/:projectKey`, () =>
    HttpResponse.json({ key: 'TEST', name: 'Test Project' }),
  ),

  // Search returns the ticket
  http.post(`${BASE}/rest/api/3/search/jql`, () =>
    HttpResponse.json(fixture),
  ),

  // Issue GET for blocker check — returns unresolved blocker link
  http.get(`${BASE}/rest/api/3/issue/:key`, () =>
    HttpResponse.json({
      key: 'TEST-1',
      fields: {
        issuelinks: [
          {
            type: { name: 'Blocks' },
            inwardIssue: {
              key: 'TEST-99',
              fields: {
                status: {
                  name: 'In Progress',
                  statusCategory: { key: 'indeterminate' },
                },
              },
            },
          },
        ],
      },
    }),
  ),
];
