/**
 * MSW handlers for Linear GraphQL API.
 *
 * Linear uses a single POST endpoint for all operations. The handler
 * dispatches based on the query content in the request body.
 *
 * Happy path + empty queue + auth failure variants.
 */
import { http, HttpResponse } from 'msw';

import fixture from '../fixtures/linear/issue-happy-path.json' with { type: 'json' };

export const linearHandlers = [
  http.post('https://api.linear.app/graphql', async ({ request }) => {
    const body = (await request.json()) as { query: string };
    const query = body.query ?? '';

    // Auth check
    if (query.includes('viewer') && query.includes('id') && !query.includes('assignedIssues')) {
      return HttpResponse.json({
        data: { viewer: { id: 'usr_1', name: 'Test User' } },
      });
    }

    // Fetch assigned issues
    if (query.includes('assignedIssues')) {
      return HttpResponse.json(fixture);
    }

    // Issue update (transition, labels)
    if (query.includes('issueUpdate')) {
      return HttpResponse.json({
        data: { issueUpdate: { success: true, issue: { id: 'issue-id-001' } } },
      });
    }

    // Comment create
    if (query.includes('commentCreate')) {
      return HttpResponse.json({
        data: { commentCreate: { success: true, comment: { id: 'comment-1' } } },
      });
    }

    // Issue create
    if (query.includes('issueCreate')) {
      return HttpResponse.json({
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'new-issue-1', identifier: 'TEAM-99' },
          },
        },
      });
    }

    // Team labels query (ensureLabel checks team first)
    if (query.includes('team') && query.includes('labels')) {
      return HttpResponse.json({
        data: {
          team: {
            labels: { nodes: [{ id: 'label-1', name: 'clancy:build' }] },
          },
        },
      });
    }

    // Workspace labels fallback
    if (query.includes('issueLabels') || query.includes('labels')) {
      return HttpResponse.json({
        data: {
          issueLabels: { nodes: [{ id: 'label-1', name: 'clancy:build' }] },
        },
      });
    }

    // Workflow states
    if (query.includes('workflowStates')) {
      return HttpResponse.json({
        data: {
          workflowStates: {
            nodes: [
              { id: 'state-1', name: 'Todo', type: 'unstarted' },
              { id: 'state-2', name: 'In Progress', type: 'started' },
              { id: 'state-3', name: 'Done', type: 'completed' },
            ],
          },
        },
      });
    }

    // Unmatched query — return 400 to catch missing handler coverage
    return HttpResponse.json(
      { errors: [{ message: `Unhandled GraphQL query: ${query.slice(0, 80)}` }] },
      { status: 400 },
    );
  }),
];

/** Empty queue — no issues returned. */
export const linearEmptyHandlers = [
  http.post('https://api.linear.app/graphql', async ({ request }) => {
    const body = (await request.json()) as { query: string };
    const query = body.query ?? '';

    if (query.includes('viewer') && !query.includes('assignedIssues')) {
      return HttpResponse.json({ data: { viewer: { id: 'usr_1' } } });
    }
    if (query.includes('assignedIssues')) {
      return HttpResponse.json({
        data: { viewer: { assignedIssues: { nodes: [] } } },
      });
    }
    // Unmatched query — fail fast even in empty-queue variant
    return HttpResponse.json(
      { errors: [{ message: `Unhandled GraphQL query: ${query.slice(0, 80)}` }] },
      { status: 400 },
    );
  }),
];

/** Auth failure — viewer query returns error. */
export const linearAuthFailureHandlers = [
  http.post('https://api.linear.app/graphql', () =>
    HttpResponse.json(
      { errors: [{ message: 'Authentication required' }] },
      { status: 401 },
    ),
  ),
];
