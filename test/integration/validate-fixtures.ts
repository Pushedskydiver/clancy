/**
 * Fixture validation script — validates MSW fixtures against Zod schemas.
 *
 * This is the offline half of the fixture feedback loop (QA-003d).
 * It runs without credentials, safe for CI.
 *
 * The feedback cycle:
 *   1. E2E test fails against a real API → investigate captured response
 *   2. Update the Zod schema in src/schemas/ to match reality
 *   3. Run this script — any fixture that no longer passes is stale
 *   4. Update the MSW fixture to match the new schema
 *   5. Layer 1 integration tests stay accurate
 *
 * Usage: npx tsx test/integration/validate-fixtures.ts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { githubIssuesResponseSchema } from '../../src/schemas/github.js';
import { jiraSearchResponseSchema } from '../../src/schemas/jira.js';
import { linearIssuesResponseSchema } from '../../src/schemas/linear.js';
import { shortcutStorySearchResponseSchema } from '../../src/schemas/shortcut.js';
import { notionDatabaseQueryResponseSchema } from '../../src/schemas/notion.js';
import {
  azdoWiqlResponseSchema,
  azdoWorkItemsBatchResponseSchema,
} from '../../src/schemas/azdo.js';

import type { ZodMiniType } from 'zod/mini';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FixtureMapping {
  /** Path to fixture JSON relative to fixtures dir. */
  fixture: string;
  /** Zod schema to validate against, or a custom validator for composite fixtures. */
  validate: ZodMiniType | ((data: unknown) => ValidationResult);
  /** Human-readable description. */
  description: string;
}

interface ValidationResult {
  success: boolean;
  errors?: string[];
}

// ─── Fixture → Schema mapping ───────────────────────────────────────────────

/**
 * Azure DevOps uses a composite fixture with separate `wiql` and `batch` keys.
 * Validate each part against its own schema.
 */
function validateAzdoComposite(data: unknown): ValidationResult {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      success: false,
      errors: ['  Expected composite object with "wiql" and "batch" keys'],
    };
  }
  const errors: string[] = [];
  const record = data as Record<string, unknown>;

  const wiqlResult = azdoWiqlResponseSchema.safeParse(record.wiql);
  if (!wiqlResult.success) {
    errors.push(`  wiql: ${String(wiqlResult.error)}`);
  }

  const batchResult = azdoWorkItemsBatchResponseSchema.safeParse(record.batch);
  if (!batchResult.success) {
    errors.push(`  batch: ${String(batchResult.error)}`);
  }

  return { success: errors.length === 0, errors };
}

const FIXTURE_MAPPINGS: FixtureMapping[] = [
  {
    fixture: 'github/issue-happy-path.json',
    validate: githubIssuesResponseSchema,
    description: 'GitHub Issues — array of issues',
  },
  {
    fixture: 'jira/issue-happy-path.json',
    validate: jiraSearchResponseSchema,
    description: 'Jira — POST /rest/api/3/search/jql response',
  },
  {
    fixture: 'linear/issue-happy-path.json',
    validate: linearIssuesResponseSchema,
    description: 'Linear — viewer.assignedIssues GraphQL response',
  },
  {
    fixture: 'shortcut/story-happy-path.json',
    validate: shortcutStorySearchResponseSchema,
    description: 'Shortcut — POST /stories/search response',
  },
  {
    fixture: 'notion/page-happy-path.json',
    validate: notionDatabaseQueryResponseSchema,
    description: 'Notion — POST /databases/{id}/query response',
  },
  {
    fixture: 'azure-devops/workitem-happy-path.json',
    validate: validateAzdoComposite,
    description: 'Azure DevOps — WIQL + batch composite',
  },
];

// ─── Runner ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'mocks', 'fixtures');

function run(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  // Also discover any fixture files not covered by the mapping
  const unmapped: string[] = [];
  const mappedPaths = new Set(FIXTURE_MAPPINGS.map((m) => m.fixture));

  for (const entry of readdirSync(fixturesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const boardDir = join(fixturesDir, entry.name);
    for (const file of readdirSync(boardDir)) {
      if (!file.endsWith('.json')) continue;
      const relative = `${entry.name}/${file}`;
      if (!mappedPaths.has(relative)) {
        unmapped.push(relative);
      }
    }
  }

  for (const mapping of FIXTURE_MAPPINGS) {
    const filePath = join(fixturesDir, mapping.fixture);

    if (!existsSync(filePath)) {
      failures.push(`  MISSING  ${mapping.fixture}`);
      failed++;
      continue;
    }

    const raw = readFileSync(filePath, 'utf-8');
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      failures.push(`  INVALID JSON  ${mapping.fixture}`);
      failed++;
      continue;
    }

    if (typeof mapping.validate === 'function' && !('safeParse' in mapping.validate)) {
      // Custom validator (e.g. Azure DevOps composite)
      const result = (mapping.validate as (data: unknown) => ValidationResult)(data);
      if (result.success) {
        console.log(`  ✓  ${mapping.description}`);
        passed++;
      } else {
        failures.push(`  ✗  ${mapping.description}\n${result.errors?.join('\n') ?? ''}`);
        failed++;
      }
    } else {
      // Zod schema
      const schema = mapping.validate as ZodMiniType;
      const result = schema.safeParse(data);
      if (result.success) {
        console.log(`  ✓  ${mapping.description}`);
        passed++;
      } else {
        failures.push(`  ✗  ${mapping.description}\n     ${String(result.error)}`);
        failed++;
      }
    }
  }

  console.log('');
  console.log(`Fixture validation: ${passed} passed, ${failed} failed`);

  if (unmapped.length > 0) {
    console.log('');
    console.log(`Warning: ${unmapped.length} fixture(s) not covered by validation:`);
    for (const u of unmapped) {
      console.log(`  ? ${u}`);
    }
  }

  if (failures.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const f of failures) {
      console.log(f);
    }
    process.exit(1);
  }
}

run();
