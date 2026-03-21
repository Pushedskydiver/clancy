/**
 * MSW handlers for Notion REST API.
 * Smoke handler — happy path only. Full scenario variants in QA-002a.
 */
import { http, HttpResponse } from 'msw';

import fixture from '../fixtures/notion/page-happy-path.json';

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
