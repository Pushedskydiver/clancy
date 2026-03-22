/**
 * Live schema validation — hits each board's auth/health endpoint
 * and validates the response against the corresponding Zod schema.
 *
 * This is the online half of the fixture feedback loop (QA-003d).
 * Catches API drift faster than full E2E (no ticket creation, no Git ops).
 * Skips boards without credentials.
 *
 * Usage: npx tsx test/e2e/validate-live-schemas.ts
 */
import {
  getGitHubCredentials,
  getJiraCredentials,
  getLinearCredentials,
  getShortcutCredentials,
  getNotionCredentials,
  getAzdoCredentials,
} from './helpers/env.js';
import { fetchWithTimeout } from './helpers/fetch-timeout.js';
import { buildJiraAuth } from './helpers/jira-auth.js';
import { buildAzdoAuth, azdoHeaders } from './helpers/azdo-auth.js';

import { linearViewerResponseSchema } from '../../src/schemas/linear.js';
import {
  shortcutMemberInfoResponseSchema,
  shortcutWorkflowsResponseSchema,
} from '../../src/schemas/shortcut.js';
import { notionUserResponseSchema } from '../../src/schemas/notion.js';
import { azdoProjectResponseSchema } from '../../src/schemas/azdo.js';

import type { ZodMiniType } from 'zod/mini';

// ─── Types ──────────────────────────────────────────────────────────────────

interface BoardCheck {
  board: string;
  /** Returns undefined if credentials are missing (skip). */
  run: () => Promise<CheckResult | undefined>;
}

interface CheckResult {
  success: boolean;
  endpoint: string;
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function validateEndpoint(
  url: string,
  init: RequestInit,
  schema: ZodMiniType,
  endpoint: string,
): Promise<CheckResult> {
  try {
    const res = await fetchWithTimeout(url, init);
    if (!res.ok) {
      return {
        success: false,
        endpoint,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    const body = await res.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      return {
        success: false,
        endpoint,
        error: `Schema validation failed: ${String(result.error)}`,
      };
    }
    return { success: true, endpoint };
  } catch (err) {
    return {
      success: false,
      endpoint,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * GitHub and Jira auth endpoints don't have formal Zod schemas in src/schemas/
 * (they're only used for auth pings, not data parsing). Validate basic shape.
 */
async function validateBasicShape(
  url: string,
  init: RequestInit,
  requiredField: string,
  endpoint: string,
): Promise<CheckResult> {
  try {
    const res = await fetchWithTimeout(url, init);
    if (!res.ok) {
      return {
        success: false,
        endpoint,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    const body: unknown = await res.json();
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      return {
        success: false,
        endpoint,
        error: `Expected JSON object, got ${Array.isArray(body) ? 'array' : typeof body}`,
      };
    }
    if (!(requiredField in body)) {
      return {
        success: false,
        endpoint,
        error: `Missing required field "${requiredField}" in response. Keys: ${Object.keys(body).join(', ')}`,
      };
    }
    return { success: true, endpoint };
  } catch (err) {
    return {
      success: false,
      endpoint,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Board checks ───────────────────────────────────────────────────────────

const checks: BoardCheck[] = [
  {
    board: 'GitHub',
    async run() {
      const creds = getGitHubCredentials();
      if (!creds) return undefined;
      return validateBasicShape(
        'https://api.github.com/user',
        {
          headers: {
            Authorization: `Bearer ${creds.token}`,
            Accept: 'application/vnd.github+json',
          },
        },
        'login',
        'GET /user',
      );
    },
  },
  {
    board: 'Jira',
    async run() {
      const creds = getJiraCredentials();
      if (!creds) return undefined;
      const auth = buildJiraAuth(creds.user, creds.apiToken);
      return validateBasicShape(
        `${creds.baseUrl}/rest/api/3/myself`,
        {
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: 'application/json',
          },
        },
        'emailAddress',
        'GET /rest/api/3/myself',
      );
    },
  },
  {
    board: 'Linear',
    async run() {
      const creds = getLinearCredentials();
      if (!creds) return undefined;
      return validateEndpoint(
        'https://api.linear.app/graphql',
        {
          method: 'POST',
          headers: {
            Authorization: creds.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: '{ viewer { id } }' }),
        },
        linearViewerResponseSchema,
        'POST /graphql { viewer { id } }',
      );
    },
  },
  {
    board: 'Shortcut',
    async run() {
      const creds = getShortcutCredentials();
      if (!creds) return undefined;
      const headers = {
        'Shortcut-Token': creds.token,
        'Content-Type': 'application/json',
      };
      // /member-info returns 404 for some token types — fallback to /workflows
      const primary = await validateEndpoint(
        'https://api.app.shortcut.com/api/v3/member-info',
        { headers },
        shortcutMemberInfoResponseSchema,
        'GET /api/v3/member-info',
      );
      if (primary.success) return primary;
      return validateEndpoint(
        'https://api.app.shortcut.com/api/v3/workflows',
        { headers },
        shortcutWorkflowsResponseSchema,
        'GET /api/v3/workflows (fallback)',
      );
    },
  },
  {
    board: 'Notion',
    async run() {
      const creds = getNotionCredentials();
      if (!creds) return undefined;
      return validateEndpoint(
        'https://api.notion.com/v1/users/me',
        {
          headers: {
            Authorization: `Bearer ${creds.token}`,
            'Notion-Version': '2022-06-28',
          },
        },
        notionUserResponseSchema,
        'GET /v1/users/me',
      );
    },
  },
  {
    board: 'Azure DevOps',
    async run() {
      const creds = getAzdoCredentials();
      if (!creds) return undefined;
      const auth = buildAzdoAuth(creds.pat);
      return validateEndpoint(
        `https://dev.azure.com/${encodeURIComponent(creds.org)}/_apis/projects/${encodeURIComponent(creds.project)}?api-version=7.1`,
        { headers: azdoHeaders(auth) },
        azdoProjectResponseSchema,
        'GET /_apis/projects/{project}',
      );
    },
  },
];

// ─── Runner ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const check of checks) {
    const result = await check.run();
    if (!result) {
      console.log(`  -  ${check.board} (skipped — no credentials)`);
      skipped++;
      continue;
    }

    if (result.success) {
      console.log(`  ✓  ${check.board} — ${result.endpoint}`);
      passed++;
    } else {
      console.log(`  ✗  ${check.board} — ${result.endpoint}`);
      failures.push(`  ${check.board}: ${result.error}`);
      failed++;
    }
  }

  console.log('');
  console.log(
    `Live schema validation: ${passed} passed, ${failed} failed, ${skipped} skipped`,
  );

  if (failures.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const f of failures) {
      console.log(f);
    }
    process.exit(1);
  }

  if (passed === 0) {
    console.log('');
    console.log(
      'Warning: no boards validated (all skipped). Set credentials in .env.e2e or CI secrets.',
    );
  }

  process.exit(0);
}

run();
