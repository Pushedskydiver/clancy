# QA-004a: CI pipeline for unit + integration tests

## Summary

Wire unit tests, typecheck, lint, and integration tests into a CI pipeline that runs on every PR. Update branch protection rules to require these checks.

## Why

Integration tests exist but aren't gated on PRs. Without CI integration, contributors can merge changes that break integration tests. This closes the loop between writing tests and enforcing them.

## Acceptance Criteria

### 1. CI workflow

- [ ] Create or update `.github/workflows/tests.yml`:

```yaml
jobs:
  unit-and-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: rm -rf node_modules package-lock.json && npm install
      - run: npm test
      - run: npm run typecheck
      - run: npm run lint

  integration:
    needs: unit-and-lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: rm -rf node_modules package-lock.json && npm install
      - run: npm run test:integration
```

- [ ] Integration tests depend on unit + typecheck + lint passing (`needs: unit-and-lint`)
- [ ] Both jobs must pass before a PR can be merged
- [ ] Runs on: `pull_request` and `push` to `main`

### 2. Branch protection

- [ ] Update branch protection rules to require the `integration` job as a status check (manual GitHub action by Alex)

### 3. Verify existing scripts

- [ ] `npm test` runs only unit tests (fast, no integration)
- [ ] `npm run test:integration` runs only integration tests
- [ ] `npm run test:all` runs both (`npm test && npm run test:integration`)

## Out of scope

- E2E workflow (QA-003e — separate weekly schedule)
- TESTING.md documentation (QA-004b)

## Dependencies

- **QA-003a** — E2E infrastructure must exist so the test:e2e script is in package.json (CI doesn't run it, but the script should exist)

## Notes

- Integration tests should complete in under 2 minutes on CI. If slower, investigate the temp repo global setup.
- The `rm -rf node_modules package-lock.json && npm install` pattern is required due to the existing npm bug with platform-specific optional deps (rollup on Linux).
- E2E tests remain on their own weekly schedule (QA-003e) — they are NOT part of the PR gate.
