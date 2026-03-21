/**
 * MSW handlers for Notion REST API.
 * Happy path + empty queue + auth failure variants.
 */
import { http, HttpResponse } from 'msw';

import fixture from '../fixtures/notion/page-happy-path.json' with { type: 'json' };

const BASE = 'https://api.notion.com';

export const notionHandlers = [
  // Auth check
  http.get(`${BASE}/v1/users/me`, () =>
    HttpResponse.json({ id: 'bot-user-uuid', type: 'bot', name: 'Clancy' }),
  ),

  // Database query
  http.post(`${BASE}/v1/databases/:id/query`, () =>
    HttpResponse.json(fixture),
  ),

  // Get page
  http.get(`${BASE}/v1/pages/:id`, () =>
    HttpResponse.json(fixture.results[0]),
  ),

  // Update page (transition, labels)
  http.patch(`${BASE}/v1/pages/:id`, () =>
    HttpResponse.json(fixture.results[0]),
  ),
];

/** Empty queue — no pages returned. */
export const notionEmptyHandlers = [
  http.get(`${BASE}/v1/users/me`, () =>
    HttpResponse.json({ id: 'bot-user-uuid', type: 'bot', name: 'Clancy' }),
  ),
  http.post(`${BASE}/v1/databases/:id/query`, () =>
    HttpResponse.json({ results: [], has_more: false, next_cursor: null }),
  ),
];

/** Auth failure — board ping returns 401. */
export const notionAuthFailureHandlers = [
  http.get(`${BASE}/v1/users/me`, () =>
    HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
  ),
];
