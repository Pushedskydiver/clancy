/**
 * MSW handlers for Shortcut REST API v3.
 * Happy path + empty queue + auth failure + blocked ticket variants.
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

/**
 * Blocked ticket — search returns a story with `blocked: true` and
 * a story_link pointing to an unresolved blocker story.
 */
export const shortcutBlockedHandlers = [
  // Ping
  http.get(`${BASE}/member-info`, () =>
    HttpResponse.json({ id: 'member-uuid', mention_name: 'testuser' }),
  ),

  // Workflows (needed for done-state resolution)
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

  // Search returns the story
  http.post(`${BASE}/stories/search`, () =>
    HttpResponse.json({
      data: [
        {
          ...fixture.data[0],
          blocked: true,
          story_links: [
            {
              id: 100,
              verb: 'is blocked by',
              subject_id: 1,
              object_id: 99,
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-01T00:00:00Z',
            },
          ],
        },
      ],
    }),
  ),

  // Single story GET — for blocker status check (returns same blocked story)
  // The handler returns stories based on ID:
  // - story 1 (the candidate): blocked with link to story 99
  // - story 99 (the blocker): in-progress (not done)
  http.get(`${BASE}/stories/:id`, ({ params }) => {
    const id = Number(params.id);
    if (id === 99) {
      // Blocker story — in progress (not done)
      return HttpResponse.json({
        id: 99,
        name: 'Blocker story',
        workflow_state_id: 101, // In Progress, not done
        blocked: false,
        story_links: [],
        labels: [],
      });
    }
    // The candidate story itself (blocked)
    return HttpResponse.json({
      ...fixture.data[0],
      blocked: true,
      story_links: [
        {
          id: 100,
          verb: 'is blocked by',
          subject_id: 1,
          object_id: 99,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ],
    });
  }),

  // Labels list
  http.get(`${BASE}/labels`, () =>
    HttpResponse.json([{ id: 1, name: 'clancy:build' }]),
  ),
];
