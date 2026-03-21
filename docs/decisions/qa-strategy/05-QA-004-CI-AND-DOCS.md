# QA-004: CI integration and documentation update

## Summary

Wire all test layers into the CI pipeline, update `docs/TESTING.md` to document the full QA architecture, and do a final verification pass confirming everything runs green.

## Why

The test infrastructure exists but isn't wired into the development workflow. Without CI integration, contributors can merge PRs that break integration tests. Without documentation, nobody knows the tests exist or how to run them. This ticket closes the loop.

## Acceptance Criteria

### 1. CI pipeline updates

- [ ] Update the existing CI workflow (or create `.github/workflows/tests.yml`):

```yaml
jobs:
  unit-and-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/cache@v4
        with:
          path: node_modules
          key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
      - run: rm -rf node_modules package-lock.json && npm install
      - run: npm test
      - run: npm run typecheck
      - run: npm run lint

  integration:
    needs: unit-and-lint  # only run if basics pass
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/cache@v4
        with:
          path: node_modules
          key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
      - run: rm -rf node_modules package-lock.json && npm install
      - run: npm run test:integration
```

- [ ] Integration tests depend on unit + typecheck + lint passing (`needs: unit-and-lint`)
- [ ] Both jobs must pass before a PR can be merged
- [ ] E2E tests remain on weekly schedule only (separate workflow from QA-003)
- [ ] Update branch protection rules in GitHub to require the `integration` job as a status check

### 2. Update docs/TESTING.md

- [ ] Rewrite `docs/TESTING.md` to cover both layers:

**Structure:**
1. **Test Runner** — Vitest, co-located files, npm scripts
2. **Layer 1: Unit Tests** — module-level, `vi.mock()`, inline data, co-located `<name>/<name>.test.ts`
   - How to run: `npm test`
   - Adding tests for a new board module
   - Adding tests for a new shared utility
3. **Layer 2: Integration Tests** — MSW at network boundary, Claude simulator at invoke boundary, real module collaboration
   - How they work: 2 primary mock boundaries (network + Claude) plus controlled test environment (env vars, temp filesystem, timers)
   - How to run: `npm run test:integration`
   - File structure: `test/integration/{flows,mocks,helpers}/`
   - Adding integration tests for a new board: handler file + fixture + describe block in flow file
   - Fixture freshness: Zod validation, E2E feedback loop
4. **Layer 3: E2E Tests** — real APIs, weekly CI
   - How they work: real board APIs, ticket factory, cleanup
   - How to run locally: `npm run test:e2e -- github`
   - CI schedule and failure handling
   - Credential setup: reference `.env.e2e.example`
5. **Running everything**
   - `npm test` — unit tests only (fast, local dev)
   - `npm run test:integration` — integration tests
   - `npm run test:all` — both unit + integration (CI gate)
   - `npm run test:e2e` — E2E against real APIs (weekly CI, optional local)

### 3. Package.json script audit

- [ ] Verify all test scripts are present and correct:
  ```json
  {
    "test": "vitest run",
    "test:integration": "vitest run --config test/integration/vitest.config.integration.ts",
    "test:e2e": "vitest run --config test/e2e/vitest.config.e2e.ts",
    "test:all": "npm test && npm run test:integration",
    "test:fixtures:validate": "npx tsx test/integration/validate-fixtures.ts",
    "test:fixtures:live": "npx tsx test/e2e/validate-live-schemas.ts",
    "test:e2e:gc": "npx tsx test/e2e/helpers/gc.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  }
  ```
- [ ] `npm run test:all` runs both unit and integration tests (CI gate)
- [ ] `npm test` still runs only unit tests (fast, local dev)

### 4. Contributor requirements

Add to TESTING.md under "Adding tests":

**PRs adding a new board must include:**
- Co-located unit tests for the raw API module (`{board}/{board}.test.ts`)
- Co-located unit tests for the Board wrapper (`{board}/{board}-board.test.ts`)
- Minimum scenarios: happy path fetch, empty queue, auth failure

**Integration test coverage (maintainer follow-up, not PR blocker):**
- MSW handler file with happy-path, empty, and auth-failure variants
- Fixture files validated against Zod schema
- Describe block in `implementer.test.ts` for the new board

**All PRs must pass CI:**
- `npm test` (unit tests)
- `npm run test:integration` (integration tests)
- `npm run typecheck`
- `npm run lint`

**Local development:**
- Run `npm test && npm run typecheck && npm run lint` before pushing (fast, ~30s)
- CI runs integration tests — don't need to run them locally for every change

### 5. Final verification

- [ ] Run `npm test` — all unit tests pass
- [ ] Run `npm run test:integration` — all integration tests pass
- [ ] Run `npm run typecheck` — clean
- [ ] Run `npm run lint` — clean
- [ ] Document total test counts:
  - Unit tests: X passing
  - Integration tests: X passing
  - E2E tests: X passing (if credentials available locally)
- [ ] Update README tests badge if test count has changed significantly (badge reflects unit test count only, for clarity)

### 6. Fixture validation in CI

- [ ] Add `npm run test:fixtures:validate` as a step in the weekly E2E workflow (not in PR CI)
- [ ] Add a nightly schema validation job (separate workflow or additional cron in E2E workflow):
  ```yaml
  schema-check:
    if: github.event.schedule == '0 4 * * *'  # nightly 4am UTC
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:fixtures:live
  ```
- [ ] Nightly schema check hits each board's auth endpoint with real credentials and validates the response against the Zod schema — catches API drift faster than the weekly E2E cycle (days, not weeks)
- [ ] This catches fixture drift on two cadences: nightly (schema shape) and weekly (full flow)

## Out of scope

- Writing new tests (all test code written in QA-001 through QA-003)
- Changes to production source code
- QA agent simulation (deferred post-v1.0.0)

## Dependencies

- **QA-001, QA-002a, QA-002b, QA-003** — all previous QA tickets complete

## Notes

- The CI workflow uses `rm -rf node_modules package-lock.json && npm install` due to the existing npm bug with platform-specific optional deps (rollup on Linux). This is already the pattern used in the existing CI config.
- Integration tests should run in under 2 minutes on CI. If they're slower, investigate the temp repo setup — the global setup pattern should make per-test overhead minimal.
- If any tests are flaky during final verification: fix if the fix is obvious (timeout too short, missing cleanup). Create a follow-up if the fix requires architectural changes to test infrastructure.
- Branch protection rule update is a manual GitHub action — add the `integration` job name as a required status check.
