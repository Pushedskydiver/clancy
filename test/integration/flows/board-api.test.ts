/**
 * QA-002b-1: Board write operations — ensureLabel, addLabel, removeLabel,
 * transitionTicket across all 6 boards.
 *
 * Tests call Board type methods directly with MSW intercepting HTTP/GraphQL.
 * Request bodies are captured via MSW resolver spies to assert correct API
 * calls for each board's distinct protocol.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { SetupServer } from 'msw/node';

import { createBoard } from '~/scripts/board/factory/factory.js';
import type { Board } from '~/scripts/board/board.js';
import { resetUsernameCache } from '~/scripts/board/github/github.js';
import {
  resetLabelCache as resetShortcutLabelCache,
  resetWorkflowCache as resetShortcutWorkflowCache,
} from '~/scripts/board/shortcut/shortcut.js';

import {
  githubEnv,
  jiraEnv,
  linearEnv,
  shortcutEnv,
  notionEnv,
  azdoEnv,
} from '../helpers/env-fixtures.js';
import {
  createIntegrationServer,
  startServer,
} from '../helpers/msw-server.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const JIRA_BASE = 'https://test.atlassian.net';
const GITHUB_API = 'https://api.github.com';
const LINEAR_API = 'https://api.linear.app/graphql';
const SHORTCUT_BASE = 'https://api.app.shortcut.com/api/v3';
const NOTION_BASE = 'https://api.notion.com';
const AZDO_BASE = 'https://dev.azure.com/test-org/test-project/_apis';

const TEST_LABEL = 'clancy:build';
const NEW_LABEL = 'clancy:plan';

// ─── Spy helpers ────────────────────────────────────────────────────────────

type CapturedRequest = {
  method: string;
  url: string;
  body?: unknown;
};

function createRequestSpy() {
  const captured: CapturedRequest[] = [];
  return {
    captured,
    record(method: string, url: string, body?: unknown) {
      captured.push({ method, url, body });
    },
  };
}

// ─── Handler factories ──────────────────────────────────────────────────────

function createGitHubHandlers(spy: ReturnType<typeof createRequestSpy>): RequestHandler[] {
  return [
    // ensureLabel — GET label check
    http.get(`${GITHUB_API}/repos/:owner/:repo/labels/:name`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json({ name: TEST_LABEL });
    }),

    // ensureLabel — GET returns 404 (label not found)
    // Handled by per-test override when needed

    // ensureLabel — POST create label
    http.post(`${GITHUB_API}/repos/:owner/:repo/labels`, async ({ request }) => {
      spy.record('POST', request.url, await request.json());
      return HttpResponse.json({ name: NEW_LABEL }, { status: 201 });
    }),

    // addLabel — POST labels to issue
    http.post(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels`, async ({ request }) => {
      spy.record('POST', request.url, await request.json());
      return HttpResponse.json([{ name: TEST_LABEL }]);
    }),

    // removeLabel — DELETE label from issue
    http.delete(`${GITHUB_API}/repos/:owner/:repo/issues/:number/labels/:name`, ({ request }) => {
      spy.record('DELETE', request.url);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

function createJiraHandlers(spy: ReturnType<typeof createRequestSpy>): RequestHandler[] {
  return [
    // GET issue (for addLabel/removeLabel — reads current labels)
    http.get(`${JIRA_BASE}/rest/api/3/issue/:key`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json({
        fields: { labels: [TEST_LABEL] },
      });
    }),

    // PUT issue (label update)
    http.put(`${JIRA_BASE}/rest/api/3/issue/:key`, async ({ request }) => {
      spy.record('PUT', request.url, await request.json());
      return new HttpResponse(null, { status: 204 });
    }),

    // GET transitions
    http.get(`${JIRA_BASE}/rest/api/3/issue/:key/transitions`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json({
        transitions: [
          { id: '31', name: 'In Progress' },
          { id: '41', name: 'Done' },
        ],
      });
    }),

    // POST transition
    http.post(`${JIRA_BASE}/rest/api/3/issue/:key/transitions`, async ({ request }) => {
      spy.record('POST', request.url, await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

function createLinearHandlers(spy: ReturnType<typeof createRequestSpy>): RequestHandler[] {
  return [
    http.post(LINEAR_API, async ({ request }) => {
      const body = (await request.json()) as { query: string; variables?: Record<string, unknown> };
      const query = body.query ?? '';

      spy.record('POST', request.url, body);

      // Team labels query (ensureLabel step 1)
      if (query.includes('team') && query.includes('labels') && !query.includes('issueLabels')) {
        return HttpResponse.json({
          data: {
            team: {
              labels: { nodes: [{ id: 'label-build-id', name: TEST_LABEL }] },
            },
          },
        });
      }

      // Workspace labels query (ensureLabel step 2 — fallback)
      if (query.includes('issueLabels')) {
        return HttpResponse.json({
          data: {
            issueLabels: { nodes: [{ id: 'label-build-id', name: TEST_LABEL }] },
          },
        });
      }

      // Label create mutation (ensureLabel step 3)
      if (query.includes('issueLabelCreate')) {
        return HttpResponse.json({
          data: {
            issueLabelCreate: {
              issueLabel: { id: 'label-new-id' },
              success: true,
            },
          },
        });
      }

      // Issue search for label management (addLabel/removeLabel)
      if (query.includes('issueSearch') || (query.includes('issues') && query.includes('identifier'))) {
        return HttpResponse.json({
          data: {
            issueSearch: {
              nodes: [
                {
                  id: 'issue-uuid-001',
                  labels: {
                    nodes: [{ id: 'label-build-id', name: TEST_LABEL }],
                  },
                },
              ],
            },
          },
        });
      }

      // Issue update mutation (addLabel/removeLabel/transition)
      if (query.includes('issueUpdate')) {
        return HttpResponse.json({
          data: { issueUpdate: { success: true } },
        });
      }

      // Workflow states (for transition)
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

      return HttpResponse.json(
        { errors: [{ message: `Unhandled: ${query.slice(0, 80)}` }] },
        { status: 400 },
      );
    }),
  ];
}

function createShortcutHandlers(spy: ReturnType<typeof createRequestSpy>): RequestHandler[] {
  return [
    // Labels list
    http.get(`${SHORTCUT_BASE}/labels`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json([
        { id: 1, name: TEST_LABEL },
        { id: 42, name: NEW_LABEL },
      ]);
    }),

    // Create label
    http.post(`${SHORTCUT_BASE}/labels`, async ({ request }) => {
      spy.record('POST', request.url, await request.json());
      return HttpResponse.json({ id: 99, name: 'new-label' }, { status: 201 });
    }),

    // Get story (for label IDs)
    http.get(`${SHORTCUT_BASE}/stories/:id`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json({
        id: 1,
        name: 'Test story',
        label_ids: [1],
        labels: [{ id: 1, name: TEST_LABEL }],
        workflow_state_id: 100,
        story_links: [],
        blocked: false,
      });
    }),

    // Update story (labels, transition)
    http.put(`${SHORTCUT_BASE}/stories/:id`, async ({ request }) => {
      spy.record('PUT', request.url, await request.json());
      return HttpResponse.json({ id: 1, name: 'Test story' });
    }),

    // Workflows (for transition)
    http.get(`${SHORTCUT_BASE}/workflows`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json([
        {
          id: 1,
          name: 'Engineering',
          states: [
            { id: 100, name: 'Unstarted', type: 'unstarted' },
            { id: 101, name: 'In Progress', type: 'started' },
            { id: 102, name: 'Done', type: 'done' },
          ],
        },
      ]);
    }),
  ];
}

function createNotionHandlers(spy: ReturnType<typeof createRequestSpy>): RequestHandler[] {
  const page = {
    id: 'ab12cd34-5678-9abc-def0-123456789abc',
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'Test page' }] },
      Status: { type: 'status', status: { name: 'Not started' } },
      Labels: {
        type: 'multi_select',
        multi_select: [{ name: TEST_LABEL }],
      },
    },
  };

  return [
    // Database query (for resolvePageFromKey — queryAllPages)
    http.post(`${NOTION_BASE}/v1/databases/:id/query`, async ({ request }) => {
      spy.record('POST', request.url, await request.json());
      return HttpResponse.json({
        results: [page],
        has_more: false,
        next_cursor: null,
      });
    }),

    // Update page (labels, transition)
    http.patch(`${NOTION_BASE}/v1/pages/:id`, async ({ request }) => {
      spy.record('PATCH', request.url, await request.json());
      return HttpResponse.json(page);
    }),
  ];
}

function createAzdoHandlers(spy: ReturnType<typeof createRequestSpy>): RequestHandler[] {
  return [
    // Get work item (for label read)
    http.get(`${AZDO_BASE}/wit/workitems/:id`, ({ request }) => {
      spy.record('GET', request.url);
      return HttpResponse.json({
        id: 1,
        fields: {
          'System.Title': 'Test item',
          'System.State': 'New',
          'System.Tags': TEST_LABEL,
          'System.WorkItemType': 'Task',
        },
        relations: null,
      });
    }),

    // Update work item (JSON Patch — labels, transition)
    http.patch(`${AZDO_BASE}/wit/workitems/:id`, async ({ request }) => {
      spy.record('PATCH', request.url, await request.json());
      return HttpResponse.json({
        id: 1,
        fields: {
          'System.Title': 'Test item',
          'System.State': 'Active',
          'System.Tags': TEST_LABEL,
        },
      });
    }),
  ];
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('QA-002b-1: Board write operations', () => {
  // ── GitHub ──────────────────────────────────────────────────────────────

  describe('github', () => {
    let board: Board;
    let spy: ReturnType<typeof createRequestSpy>;
    let server: SetupServer;

    beforeEach(() => {
      spy = createRequestSpy();
      server = createIntegrationServer(...createGitHubHandlers(spy));
      startServer(server);
      board = createBoard({ provider: 'github', env: githubEnv as never });
    });

    afterEach(() => {
      server.close();
      vi.unstubAllEnvs();
      resetUsernameCache();
    });

    describe('ensureLabel', () => {
      it('skips creation when label already exists (GET 200)', async () => {
        await board.ensureLabel(TEST_LABEL);

        const gets = spy.captured.filter(
          (r) => r.method === 'GET' && r.url.includes('/labels/'),
        );
        const posts = spy.captured.filter(
          (r) => r.method === 'POST' && r.url.includes('/labels') && !r.url.includes('/issues/'),
        );

        expect(gets).toHaveLength(1);
        expect(posts).toHaveLength(0);
      });

      it('creates label when GET returns 404', async () => {
        // Override GET to return 404
        server.use(
          http.get(`${GITHUB_API}/repos/:owner/:repo/labels/:name`, () =>
            HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
          ),
        );

        await board.ensureLabel(NEW_LABEL);

        const posts = spy.captured.filter(
          (r) => r.method === 'POST' && r.url.includes('/repos/') && r.url.endsWith('/labels'),
        );

        expect(posts).toHaveLength(1);
        expect(posts[0].body).toEqual({
          name: NEW_LABEL,
          color: '0075ca',
        });
      });

      it('handles 422 gracefully (label already exists race)', async () => {
        server.use(
          http.get(`${GITHUB_API}/repos/:owner/:repo/labels/:name`, () =>
            HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
          ),
          http.post(`${GITHUB_API}/repos/:owner/:repo/labels`, async ({ request }) => {
            spy.record('POST', request.url, await request.json());
            return HttpResponse.json(
              { message: 'Validation Failed' },
              { status: 422 },
            );
          }),
        );

        // Should not throw
        await expect(board.ensureLabel(NEW_LABEL)).resolves.toBeUndefined();
      });
    });

    describe('addLabel', () => {
      it('calls ensureLabel then POSTs to issue labels endpoint', async () => {
        await board.addLabel('#1', TEST_LABEL);

        const issueLabels = spy.captured.filter(
          (r) => r.method === 'POST' && r.url.includes('/issues/1/labels'),
        );

        expect(issueLabels).toHaveLength(1);
        expect(issueLabels[0].body).toEqual({ labels: [TEST_LABEL] });
      });
    });

    describe('removeLabel', () => {
      it('DELETEs the label from the issue', async () => {
        await board.removeLabel('#1', TEST_LABEL);

        const deletes = spy.captured.filter((r) => r.method === 'DELETE');

        expect(deletes).toHaveLength(1);
        expect(deletes[0].url).toContain(`/issues/1/labels/${encodeURIComponent(TEST_LABEL)}`);
      });

      it('ignores 404 when label is not on the issue', async () => {
        server.use(
          http.delete(
            `${GITHUB_API}/repos/:owner/:repo/issues/:number/labels/:name`,
            ({ request }) => {
              spy.record('DELETE', request.url);
              return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
            },
          ),
        );

        await expect(board.removeLabel('#1', TEST_LABEL)).resolves.toBeUndefined();
      });
    });

    describe('addLabel — edge cases', () => {
      it('makes no HTTP calls for invalid issue key (NaN)', async () => {
        await board.addLabel('not-a-number', TEST_LABEL);

        const issueLabels = spy.captured.filter(
          (r) => r.method === 'POST' && r.url.includes('/issues/'),
        );
        expect(issueLabels).toHaveLength(0);
      });
    });

    describe('transitionTicket', () => {
      it('returns false (GitHub Issues has no status transitions)', async () => {
        const result = await board.transitionTicket(
          { key: '#1', title: 'Test', description: '', parentInfo: 'none', blockers: 'None', labels: [], status: 'open' },
          'closed',
        );

        expect(result).toBe(false);
      });
    });
  });

  // ── Jira ────────────────────────────────────────────────────────────────

  describe('jira', () => {
    let board: Board;
    let spy: ReturnType<typeof createRequestSpy>;
    let server: SetupServer;

    beforeEach(() => {
      spy = createRequestSpy();
      server = createIntegrationServer(...createJiraHandlers(spy));
      startServer(server);
      board = createBoard({ provider: 'jira', env: jiraEnv as never });
    });

    afterEach(() => {
      server.close();
      vi.unstubAllEnvs();
    });

    describe('ensureLabel', () => {
      it('is a no-op (Jira auto-creates labels)', async () => {
        await board.ensureLabel(TEST_LABEL);

        // No HTTP calls should be made
        expect(spy.captured).toHaveLength(0);
      });
    });

    describe('addLabel', () => {
      it('GETs current labels then PUTs updated array', async () => {
        await board.addLabel('TEST-1', NEW_LABEL);

        const gets = spy.captured.filter(
          (r) => r.method === 'GET' && r.url.includes('/issue/TEST-1'),
        );
        const puts = spy.captured.filter((r) => r.method === 'PUT');

        expect(gets).toHaveLength(1);
        expect(puts).toHaveLength(1);
        expect(puts[0].body).toEqual({
          fields: { labels: [TEST_LABEL, NEW_LABEL] },
        });
      });

      it('skips PUT when label already present', async () => {
        await board.addLabel('TEST-1', TEST_LABEL);

        const puts = spy.captured.filter((r) => r.method === 'PUT');
        expect(puts).toHaveLength(0);
      });

      it('makes no HTTP calls for invalid issue key', async () => {
        await board.addLabel('invalid-key', NEW_LABEL);

        expect(spy.captured).toHaveLength(0);
      });
    });

    describe('removeLabel', () => {
      it('GETs current labels then PUTs filtered array', async () => {
        await board.removeLabel('TEST-1', TEST_LABEL);

        const puts = spy.captured.filter((r) => r.method === 'PUT');

        expect(puts).toHaveLength(1);
        expect(puts[0].body).toEqual({
          fields: { labels: [] },
        });
      });

      it('skips PUT when label not present', async () => {
        await board.removeLabel('TEST-1', 'nonexistent');

        const puts = spy.captured.filter((r) => r.method === 'PUT');
        expect(puts).toHaveLength(0);
      });
    });

    describe('transitionTicket', () => {
      it('looks up transition ID then POSTs transition', async () => {
        const result = await board.transitionTicket(
          { key: 'TEST-1', title: 'Test', description: '', parentInfo: 'none', blockers: 'None', labels: [], status: 'To Do' },
          'In Progress',
        );

        expect(result).toBe(true);

        const transitionGets = spy.captured.filter(
          (r) => r.method === 'GET' && r.url.includes('/transitions'),
        );
        const transitionPosts = spy.captured.filter(
          (r) => r.method === 'POST' && r.url.includes('/transitions'),
        );

        expect(transitionGets).toHaveLength(1);
        expect(transitionPosts).toHaveLength(1);
        expect(transitionPosts[0].body).toEqual({
          transition: { id: '31' },
        });
      });

      it('returns false when target status not found in transitions', async () => {
        const result = await board.transitionTicket(
          { key: 'TEST-1', title: 'Test', description: '', parentInfo: 'none', blockers: 'None', labels: [], status: 'To Do' },
          'Nonexistent Status',
        );

        expect(result).toBe(false);
      });
    });
  });

  // ── Linear ──────────────────────────────────────────────────────────────

  describe('linear', () => {
    let board: Board;
    let spy: ReturnType<typeof createRequestSpy>;
    let server: SetupServer;

    beforeEach(() => {
      spy = createRequestSpy();
      server = createIntegrationServer(...createLinearHandlers(spy));
      startServer(server);
      board = createBoard({ provider: 'linear', env: linearEnv as never });
    });

    afterEach(() => {
      server.close();
      vi.unstubAllEnvs();
    });

    describe('ensureLabel', () => {
      it('finds label in team labels and caches it (no create)', async () => {
        await board.ensureLabel(TEST_LABEL);

        const queries = spy.captured.filter(
          (r) => (r.body as { query: string }).query?.includes('team') &&
                 (r.body as { query: string }).query?.includes('labels'),
        );

        expect(queries.length).toBeGreaterThanOrEqual(1);

        // No create mutation should be called
        const creates = spy.captured.filter(
          (r) => (r.body as { query: string }).query?.includes('issueLabelCreate'),
        );
        expect(creates).toHaveLength(0);
      });

      it('creates label when not found in team or workspace', async () => {
        server.use(
          http.post(LINEAR_API, async ({ request }) => {
            const body = (await request.json()) as { query: string; variables?: Record<string, unknown> };
            const query = body.query ?? '';

            spy.record('POST', request.url, body);

            // Team labels — empty
            if (query.includes('team') && query.includes('labels') && !query.includes('issueLabels')) {
              return HttpResponse.json({
                data: { team: { labels: { nodes: [] } } },
              });
            }

            // Workspace labels — empty
            if (query.includes('issueLabels')) {
              return HttpResponse.json({
                data: { issueLabels: { nodes: [] } },
              });
            }

            // Create label
            if (query.includes('issueLabelCreate')) {
              return HttpResponse.json({
                data: {
                  issueLabelCreate: {
                    issueLabel: { id: 'label-new-id' },
                    success: true,
                  },
                },
              });
            }

            return HttpResponse.json(
              { errors: [{ message: `Unhandled: ${query.slice(0, 80)}` }] },
              { status: 400 },
            );
          }),
        );

        await board.ensureLabel(NEW_LABEL);

        const creates = spy.captured.filter(
          (r) => (r.body as { query: string }).query?.includes('issueLabelCreate'),
        );
        expect(creates).toHaveLength(1);
        expect((creates[0].body as { variables: Record<string, unknown> }).variables).toMatchObject({
          teamId: 'test-team-id',
          name: NEW_LABEL,
        });
      });

      it('second call uses cache — makes zero GraphQL requests', async () => {
        // First call populates cache
        await board.ensureLabel(TEST_LABEL);
        const countAfterFirst = spy.captured.length;

        // Second call should hit cache — no additional requests
        await board.ensureLabel(TEST_LABEL);
        expect(spy.captured.length).toBe(countAfterFirst);
      });
    });

    describe('addLabel', () => {
      it('resolves issue UUID then sends issueUpdate with appended label ID', async () => {
        await board.addLabel('TEAM-1', TEST_LABEL);

        const updates = spy.captured.filter(
          (r) => (r.body as { query: string }).query?.includes('issueUpdate'),
        );

        // ensureLabel finds it in cache from team query, then addLabel
        // checks if already present — label-build-id is already on the issue,
        // so no update should happen
        expect(updates).toHaveLength(0);
      });

      it('appends new label ID when not already on issue', async () => {
        // Override to return issue without the target label
        server.use(
          http.post(LINEAR_API, async ({ request }) => {
            const body = (await request.json()) as { query: string; variables?: Record<string, unknown> };
            const query = body.query ?? '';

            spy.record('POST', request.url, body);

            // Team labels — return the label we want to add
            if (query.includes('team') && query.includes('labels') && !query.includes('issueLabels')) {
              return HttpResponse.json({
                data: {
                  team: {
                    labels: { nodes: [{ id: 'label-plan-id', name: NEW_LABEL }] },
                  },
                },
              });
            }

            // Issue search — issue has no labels
            if (query.includes('issueSearch') || (query.includes('issues') && query.includes('identifier'))) {
              return HttpResponse.json({
                data: {
                  issueSearch: {
                    nodes: [{ id: 'issue-uuid-001', labels: { nodes: [] } }],
                  },
                },
              });
            }

            // Issue update
            if (query.includes('issueUpdate')) {
              return HttpResponse.json({
                data: { issueUpdate: { success: true } },
              });
            }

            return HttpResponse.json(
              { errors: [{ message: `Unhandled: ${query.slice(0, 80)}` }] },
              { status: 400 },
            );
          }),
        );

        await board.addLabel('TEAM-1', NEW_LABEL);

        const updates = spy.captured.filter(
          (r) => (r.body as { query: string }).query?.includes('issueUpdate'),
        );

        expect(updates).toHaveLength(1);
        expect((updates[0].body as { variables: Record<string, unknown> }).variables).toMatchObject({
          issueId: 'issue-uuid-001',
          labelIds: ['label-plan-id'],
        });
      });
    });

    describe('removeLabel', () => {
      it('resolves issue then sends issueUpdate with filtered label IDs', async () => {
        await board.removeLabel('TEAM-1', TEST_LABEL);

        const updates = spy.captured.filter(
          (r) => (r.body as { query: string }).query?.includes('issueUpdate'),
        );

        expect(updates).toHaveLength(1);
        expect((updates[0].body as { variables: Record<string, unknown> }).variables).toMatchObject({
          issueId: 'issue-uuid-001',
          labelIds: [], // clancy:build removed
        });
      });

      it('skips update when label not on issue', async () => {
        server.use(
          http.post(LINEAR_API, async ({ request }) => {
            const body = (await request.json()) as { query: string; variables?: Record<string, unknown> };
            const query = body.query ?? '';

            spy.record('POST', request.url, body);

            if (query.includes('issueSearch') || (query.includes('issues') && query.includes('identifier'))) {
              return HttpResponse.json({
                data: {
                  issueSearch: {
                    nodes: [{ id: 'issue-uuid-001', labels: { nodes: [] } }],
                  },
                },
              });
            }

            return HttpResponse.json(
              { errors: [{ message: `Unhandled: ${query.slice(0, 80)}` }] },
              { status: 400 },
            );
          }),
        );

        await board.removeLabel('TEAM-1', 'nonexistent-label');

        const updates = spy.captured.filter(
          (r) => (r.body as { query: string }).query?.includes('issueUpdate'),
        );
        expect(updates).toHaveLength(0);
      });
    });

    describe('transitionTicket', () => {
      it('looks up workflow state ID then sends issueUpdate', async () => {
        const result = await board.transitionTicket(
          {
            key: 'TEAM-1', title: 'Test', description: '', parentInfo: 'none',
            blockers: 'None', labels: [], status: 'unstarted',
            linearIssueId: 'issue-uuid-001', issueId: 'issue-uuid-001',
          },
          'In Progress',
        );

        expect(result).toBe(true);

        const updates = spy.captured.filter(
          (r) => (r.body as { query: string }).query?.includes('issueUpdate'),
        );
        expect(updates.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ── Shortcut ────────────────────────────────────────────────────────────

  describe('shortcut', () => {
    let board: Board;
    let spy: ReturnType<typeof createRequestSpy>;
    let server: SetupServer;

    beforeEach(() => {
      resetShortcutWorkflowCache();
      resetShortcutLabelCache();
      spy = createRequestSpy();
      server = createIntegrationServer(...createShortcutHandlers(spy));
      startServer(server);
      board = createBoard({ provider: 'shortcut', env: shortcutEnv as never });
    });

    afterEach(() => {
      server.close();
      vi.unstubAllEnvs();
      resetShortcutWorkflowCache();
      resetShortcutLabelCache();
    });

    describe('ensureLabel', () => {
      it('skips creation when label already exists', async () => {
        await board.ensureLabel(TEST_LABEL);

        const posts = spy.captured.filter(
          (r) => r.method === 'POST' && r.url.includes('/labels'),
        );
        expect(posts).toHaveLength(0);
      });

      it('creates label when not found', async () => {
        server.use(
          http.get(`${SHORTCUT_BASE}/labels`, ({ request }) => {
            spy.record('GET', request.url);
            return HttpResponse.json([]);
          }),
        );

        await board.ensureLabel('new-label');

        const posts = spy.captured.filter(
          (r) => r.method === 'POST' && r.url.includes('/labels'),
        );
        expect(posts).toHaveLength(1);
      });
    });

    describe('addLabel', () => {
      it('fetches labels, gets story label IDs, PUTs updated array', async () => {
        await board.addLabel('sc-1', NEW_LABEL);

        const puts = spy.captured.filter((r) => r.method === 'PUT');

        expect(puts).toHaveLength(1);
        // updateStoryLabelIds sends { label_ids: [current + new] }
        expect(puts[0].body).toEqual({ label_ids: [1, 42] });
      });

      it('skips PUT when label already on story', async () => {
        await board.addLabel('sc-1', TEST_LABEL);

        const puts = spy.captured.filter((r) => r.method === 'PUT');
        expect(puts).toHaveLength(0);
      });
    });

    describe('removeLabel', () => {
      it('PUTs story with filtered label IDs', async () => {
        await board.removeLabel('sc-1', TEST_LABEL);

        const puts = spy.captured.filter((r) => r.method === 'PUT');

        expect(puts).toHaveLength(1);
        // updateStoryLabelIds sends { label_ids: [] } after removing the only label
        expect(puts[0].body).toEqual({ label_ids: [] });
      });
    });

    describe('transitionTicket', () => {
      it('resolves workflow state ID then PUTs story', async () => {
        const result = await board.transitionTicket(
          { key: 'sc-1', title: 'Test', description: '', parentInfo: 'none', blockers: 'None', labels: [], status: 'unstarted', issueId: '1' },
          'In Progress',
        );

        expect(result).toBe(true);

        const puts = spy.captured.filter(
          (r) => r.method === 'PUT' && r.url.includes('/stories/'),
        );
        expect(puts).toHaveLength(1);
        expect(puts[0].body).toMatchObject({
          workflow_state_id: 101,
        });
      });

      it('returns false when workflow state not found', async () => {
        const result = await board.transitionTicket(
          { key: 'sc-1', title: 'Test', description: '', parentInfo: 'none', blockers: 'None', labels: [], status: 'unstarted', issueId: '1' },
          'Nonexistent State',
        );

        expect(result).toBe(false);
      });
    });
  });

  // ── Notion ──────────────────────────────────────────────────────────────

  describe('notion', () => {
    let board: Board;
    let spy: ReturnType<typeof createRequestSpy>;
    let server: SetupServer;

    beforeEach(() => {
      spy = createRequestSpy();
      server = createIntegrationServer(...createNotionHandlers(spy));
      startServer(server);
      board = createBoard({ provider: 'notion', env: notionEnv as never });
    });

    afterEach(() => {
      server.close();
      vi.unstubAllEnvs();
    });

    describe('ensureLabel', () => {
      it('is a no-op (Notion auto-creates multi_select options)', async () => {
        await board.ensureLabel(TEST_LABEL);

        expect(spy.captured).toHaveLength(0);
      });
    });

    describe('addLabel', () => {
      it('queries database for page then PATCHes with appended label', async () => {
        await board.addLabel('notion-ab12cd34', NEW_LABEL);

        const patches = spy.captured.filter((r) => r.method === 'PATCH');

        expect(patches).toHaveLength(1);
        expect(patches[0].body).toMatchObject({
          properties: {
            Labels: {
              multi_select: expect.arrayContaining([
                { name: TEST_LABEL },
                { name: NEW_LABEL },
              ]),
            },
          },
        });
      });

      it('skips PATCH when label already present', async () => {
        await board.addLabel('notion-ab12cd34', TEST_LABEL);

        const patches = spy.captured.filter((r) => r.method === 'PATCH');
        expect(patches).toHaveLength(0);
      });
    });

    describe('removeLabel', () => {
      it('PATCHes page with filtered multi_select', async () => {
        await board.removeLabel('notion-ab12cd34', TEST_LABEL);

        const patches = spy.captured.filter((r) => r.method === 'PATCH');

        expect(patches).toHaveLength(1);
        expect(patches[0].body).toMatchObject({
          properties: {
            Labels: { multi_select: [] },
          },
        });
      });
    });

    describe('transitionTicket', () => {
      it('PATCHes page with status property', async () => {
        const result = await board.transitionTicket(
          {
            key: 'notion-ab12cd34', title: 'Test', description: '', parentInfo: 'none',
            blockers: 'None', labels: [], status: 'To-do',
            issueId: 'ab12cd34-5678-9abc-def0-123456789abc',
          },
          'In Progress',
        );

        expect(result).toBe(true);

        const patches = spy.captured.filter((r) => r.method === 'PATCH');
        expect(patches).toHaveLength(1);
        expect(patches[0].body).toMatchObject({
          properties: {
            Status: { status: { name: 'In Progress' } },
          },
        });
      });
    });
  });

  // ── Azure DevOps ────────────────────────────────────────────────────────

  describe('azdo', () => {
    let board: Board;
    let spy: ReturnType<typeof createRequestSpy>;
    let server: SetupServer;

    beforeEach(() => {
      spy = createRequestSpy();
      server = createIntegrationServer(...createAzdoHandlers(spy));
      startServer(server);
      board = createBoard({ provider: 'azdo', env: azdoEnv as never });
    });

    afterEach(() => {
      server.close();
      vi.unstubAllEnvs();
    });

    describe('ensureLabel', () => {
      it('is a no-op (Azure DevOps tags auto-create)', async () => {
        await board.ensureLabel(TEST_LABEL);

        expect(spy.captured).toHaveLength(0);
      });
    });

    describe('addLabel', () => {
      it('GETs work item then PATCHes with appended tag', async () => {
        await board.addLabel('azdo-1', NEW_LABEL);

        const patches = spy.captured.filter((r) => r.method === 'PATCH');

        expect(patches).toHaveLength(1);
        expect(patches[0].body).toEqual([
          {
            op: 'replace',
            path: '/fields/System.Tags',
            value: `${TEST_LABEL}; ${NEW_LABEL}`,
          },
        ]);
      });

      it('skips PATCH when tag already present', async () => {
        await board.addLabel('azdo-1', TEST_LABEL);

        const patches = spy.captured.filter((r) => r.method === 'PATCH');
        expect(patches).toHaveLength(0);
      });
    });

    describe('removeLabel', () => {
      it('GETs work item then PATCHes with filtered tags', async () => {
        await board.removeLabel('azdo-1', TEST_LABEL);

        const patches = spy.captured.filter((r) => r.method === 'PATCH');

        expect(patches).toHaveLength(1);
        expect(patches[0].body).toEqual([
          {
            op: 'replace',
            path: '/fields/System.Tags',
            value: '',
          },
        ]);
      });
    });

    describe('transitionTicket', () => {
      it('PATCHes work item with System.State', async () => {
        const result = await board.transitionTicket(
          {
            key: 'azdo-1', title: 'Test', description: '', parentInfo: 'none',
            blockers: 'None', labels: [], status: 'New',
            issueId: '1',
          },
          'Active',
        );

        expect(result).toBe(true);

        const patches = spy.captured.filter((r) => r.method === 'PATCH');
        expect(patches).toHaveLength(1);
        expect(patches[0].body).toEqual([
          {
            op: 'replace',
            path: '/fields/System.State',
            value: 'Active',
          },
        ]);
      });
    });
  });
});
