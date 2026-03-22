# QA-004b: TESTING.md rewrite + final verification

## Summary

Rewrite `docs/TESTING.md` to document the full 3-layer QA architecture. Audit package.json scripts. Run final verification across all test layers.

## Why

The test infrastructure exists but isn't documented. Contributors don't know the tests exist, how to run them, or how to add new ones. This ticket closes the documentation gap and confirms everything works end-to-end.

## Acceptance Criteria

### 1. Rewrite docs/TESTING.md

- [ ] Structure:

1. **Test runner** — Vitest, co-located files, npm scripts
2. **Layer 1: Unit tests** — module-level, `vi.mock()`, co-located `<name>/<name>.test.ts`
   - How to run: `npm test`
   - Adding tests for a new board module
   - Adding tests for a new shared utility
3. **Layer 2: Integration tests** — MSW + Claude simulator, real module collaboration
   - How they work: 2 mock boundaries (network + Claude) + controlled test environment
   - How to run: `npm run test:integration`
   - File structure: `test/integration/{flows,mocks,helpers}/`
   - Adding integration tests for a new board
   - Fixture freshness: Zod validation, E2E feedback loop
4. **Layer 3: E2E tests** — real APIs, weekly CI
   - How they work: real board APIs, ticket factory, cleanup
   - How to run locally: `npm run test:e2e -- github`
   - CI schedule and failure handling
   - Credential setup: reference `.env.e2e.example`
5. **Running everything** — summary of all npm scripts

### 2. Contributor requirements

- [ ] Add to TESTING.md:

**PRs adding a new board must include:**
- Co-located unit tests for raw API module and Board wrapper
- Minimum scenarios: happy path fetch, empty queue, auth failure

**Integration test coverage (maintainer follow-up, not PR blocker):**
- MSW handler file + fixture + flow test

**All PRs must pass CI:**
- `npm test` + `npm run test:integration` + `npm run typecheck` + `npm run lint`

### 3. Package.json script audit

- [ ] Verify all test scripts are present and correct:

| Script | Command | Purpose |
|---|---|---|
| `test` | `vitest run` | Unit tests only (fast, local dev) |
| `test:integration` | `vitest run --config test/integration/vitest.config.integration.ts` | Integration tests |
| `test:e2e` | `vitest run --config test/e2e/vitest.config.e2e.ts` | E2E tests (real APIs) |
| `test:all` | `npm test && npm run test:integration` | Unit + integration (CI gate) |
| `test:e2e:gc` | `npx tsx test/e2e/helpers/gc.ts` | Orphan ticket cleanup |
| `test:fixtures:validate` | `npx tsx test/integration/validate-fixtures.ts` | Fixture vs Zod schema |
| `test:fixtures:live` | `npx tsx test/e2e/validate-live-schemas.ts` | Live API vs Zod schema |

### 4. Final verification

Concrete pass criteria:

- [ ] `npm test` — all unit tests pass
- [ ] `npm run test:integration` — all integration tests pass
- [ ] `npm run typecheck` — clean
- [ ] `npm run lint` — clean
- [ ] `npm run test:fixtures:validate` — all fixtures valid against Zod schemas
- [ ] Manual GitHub Actions dispatch of `tests.yml` — both jobs pass on a clean PR branch
- [ ] Document final test counts: unit tests (X), integration tests (X), E2E tests (X if credentials available)
- [ ] Update README test badge if count has changed significantly

## Out of scope

- Writing new tests (all test code written in prior tickets)
- Changes to production source code

## Dependencies

- **QA-004a** — CI pipeline must be wired
- **QA-003a** through **QA-003e** — all E2E tickets should be complete for full documentation accuracy

## Notes

- If any tests are flaky during verification: fix if the fix is obvious (timeout too short, missing cleanup). Create a follow-up if the fix requires architectural changes.
- The README test badge reflects unit test count only for simplicity.
