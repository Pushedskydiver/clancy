# QA-003d: Fixture feedback loop

## Summary

Build the feedback loop between Layer 2 (E2E) and Layer 1 (integration tests): captured API responses from E2E runs, a script to validate MSW fixtures against Zod schemas, and a script to validate schemas against live API endpoints.

## Why

MSW fixtures can drift from real API responses over time. This creates a two-cadence detection system: nightly schema checks (fast, cheap — hits auth endpoints only) and weekly E2E runs (full flow). When drift is detected, the fix flows backward: update Zod schema → update MSW fixture → Layer 1 tests stay accurate.

## Acceptance Criteria

### 1. Captured response writer

- [ ] Each E2E test optionally captures raw API responses when a board API call succeeds
- [ ] Captured responses written to `test/e2e/captured-responses/{board}/{endpoint}.json` (gitignored)
- [ ] Capture is opt-in (env var or flag) — not on by default in CI

### 2. Fixture validation script

- [ ] Create `test/integration/validate-fixtures.ts`
- [ ] Reads each MSW fixture from `test/integration/mocks/fixtures/`
- [ ] Runs it through the corresponding Zod schema from `src/schemas/`
- [ ] Reports any validation failures (fixture has drifted from expected shape)
- [ ] Add `"test:fixtures:validate": "npx tsx test/integration/validate-fixtures.ts"` to package.json

### 3. Live schema validation script

- [ ] Create `test/e2e/validate-live-schemas.ts`
- [ ] Hits each board's auth/health endpoint with real credentials:
  - Jira: `GET /rest/api/3/myself`
  - GitHub: `GET /user`
  - Linear: `POST /graphql` with `{ query: "{ viewer { id } }" }`
  - Shortcut: `GET /api/v3/member`
  - Notion: `GET /v1/users/me`
  - Azure DevOps: `GET /_apis/connectionData`
- [ ] Validates each response against the corresponding Zod schema
- [ ] Reports pass/fail per board with response shape details on failure
- [ ] Skips boards without credentials (same `hasCredentials` check from QA-003a)
- [ ] Add `"test:fixtures:live": "npx tsx test/e2e/validate-live-schemas.ts"` to package.json

### 4. Feedback loop documentation

- [ ] Add a comment block at the top of `validate-fixtures.ts` explaining the feedback loop:
  1. E2E test fails due to API response shape change
  2. Investigate captured response to understand the change
  3. Update Zod schema if the change is intentional
  4. Update MSW fixture to match
  5. Layer 1 tests stay accurate

## Out of scope

- CI integration for these scripts (QA-003e handles that)
- Automated fixture updating (manual investigation required)

## Dependencies

- **QA-003a** — E2E infrastructure must exist (env loading, credential helpers)

## Notes

- The fixture validation script can run without any credentials — it only reads local files and validates against Zod schemas. This makes it safe to run in any CI job.
- The live schema validation is cheaper than full E2E (one API call per board vs ~10) and can run nightly to catch drift faster than the weekly E2E cycle.
- Captured responses are gitignored because they contain real API data. They're a debugging tool for investigating E2E failures, not a test artifact.
