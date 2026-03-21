/**
 * MSW handlers for Azure DevOps REST API.
 * Two-step fetch: WIQL query -> work items GET (with ids query param).
 * Happy path + empty queue + auth failure variants.
 */
import { http, HttpResponse } from 'msw';

import fixture from '../fixtures/azure-devops/workitem-happy-path.json' with { type: 'json' };

const BASE = 'https://dev.azure.com/test-org/test-project/_apis';

export const azdoHandlers = [
  // Auth check (project info)
  http.get('https://dev.azure.com/test-org/_apis/projects/test-project', () =>
    HttpResponse.json({
      id: 'proj-uuid',
      name: 'test-project',
      state: 'wellFormed',
    }),
  ),

  // WIQL query
  http.post(`${BASE}/wit/wiql`, () => HttpResponse.json(fixture.wiql)),

  // Work items batch GET (actual endpoint: GET /wit/workitems?ids=1,2&$expand=relations)
  http.get(`${BASE}/wit/workitems`, () => HttpResponse.json(fixture.batch)),

  // Single work item GET
  http.get(`${BASE}/wit/workitems/:id`, () =>
    HttpResponse.json(fixture.batch.value[0]),
  ),

  // Update work item (JSON Patch)
  http.patch(`${BASE}/wit/workitems/:id`, () =>
    HttpResponse.json(fixture.batch.value[0]),
  ),
];

/** Empty queue — WIQL returns no work items. */
export const azdoEmptyHandlers = [
  http.get('https://dev.azure.com/test-org/_apis/projects/test-project', () =>
    HttpResponse.json({
      id: 'proj-uuid',
      name: 'test-project',
      state: 'wellFormed',
    }),
  ),
  http.post(`${BASE}/wit/wiql`, () =>
    HttpResponse.json({ workItems: [] }),
  ),
];

/** Auth failure — board ping returns 401. */
export const azdoAuthFailureHandlers = [
  http.get('https://dev.azure.com/test-org/_apis/projects/test-project', () =>
    HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
  ),
];
