/**
 * MSW handlers for Shortcut REST API v3.
 * Happy path + empty queue + auth failure variants.
 */
import { http, HttpResponse } from 'msw';

import fixture from '../fixtures/shortcut/story-happy-path.json' with { type: 'json' };

const BASE = 'https://api.app.shortcut.com/api/v3';

export const shortcutHandlers = [
  // Ping — GET /api/v3/member-info
  http.get(`${BASE}/member-info`, () =>
    HttpResponse.json({ id: 'member-uuid', mention_name: 'testuser' }),
  ),

  // Workflows (for state resolution)
  http.get(`${BASE}/workflows`, () =>
    HttpResponse.json([
      {
        id: 1,
        name: 'Engineering',
        states: [
          { id: 100, name: 'Unstarted', type: 'unstarted' },
          { id: 101, name: 'In Progress', type: 'started' },
          { id: 102, name: 'Done', type: 'done' },
        ],
      },
    ]),
  ),

  // Stories search — returns full { data: [...] } shape
  http.post(`${BASE}/stories/search`, () => HttpResponse.json(fixture)),

  // Single story
  http.get(`${BASE}/stories/:id`, () => HttpResponse.json(fixture.data[0])),

  // Story update (transition, labels)
  http.put(`${BASE}/stories/:id`, () => HttpResponse.json(fixture.data[0])),

  // Labels list
  http.get(`${BASE}/labels`, () =>
    HttpResponse.json([{ id: 1, name: 'clancy:build' }]),
  ),

  // Create label
  http.post(`${BASE}/labels`, () =>
    HttpResponse.json({ id: 42, name: 'clancy:build' }, { status: 201 }),
  ),
];

/** Empty queue — no stories returned. */
export const shortcutEmptyHandlers = [
  http.get(`${BASE}/member-info`, () =>
    HttpResponse.json({ id: 'member-uuid', mention_name: 'testuser' }),
  ),
  http.get(`${BASE}/workflows`, () =>
    HttpResponse.json([
      {
        id: 1,
        name: 'Engineering',
        states: [
          { id: 100, name: 'Unstarted', type: 'unstarted' },
        ],
      },
    ]),
  ),
  http.post(`${BASE}/stories/search`, () =>
    HttpResponse.json({ data: [] }),
  ),
];

/** Auth failure — board ping returns 401. */
export const shortcutAuthFailureHandlers = [
  http.get(`${BASE}/member-info`, () =>
    HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
  ),
];
