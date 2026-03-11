# Testing

## Test Runner

All tests are bash scripts. No test framework — just assertions, pass/fail counters, and exit codes.

```bash
npm test                                    # run all unit tests (94 total)
bash test/unit/jira.test.sh                 # individual suite
bash test/unit/credential-guard.test.sh     # individual suite
bash test/smoke/smoke.sh                    # live API tests (requires .env)
```

## Test Structure

```
test/
├── unit/
│   ├── jira.test.sh                — 18 tests: Jira API response parsing
│   ├── github.test.sh              — 17 tests: GitHub Issues API response parsing
│   ├── linear.test.sh              — 20 tests: Linear GraphQL response parsing
│   ├── scaffold.test.sh            — 7 tests: scaffold.md ↔ source template drift
│   └── credential-guard.test.sh    — 32 tests: credential guard hook patterns
├── fixtures/
│   ├── jira-*.json                 — 8 Jira fixtures
│   ├── github-*.json               — 6 GitHub fixtures
│   └── linear-*.json               — 4 Linear fixtures
└── smoke/
    └── smoke.sh                    — live API validation (requires configured .env)
```

## How Tests Work

### Board parsing tests (Jira, GitHub, Linear)

Each test extracts fields from JSON fixture files using the same `jq` expressions the shell scripts use. This validates that the parsing logic handles all response shapes correctly.

Pattern:
```bash
RESULT=$(jq -r '<expression>' "$FIXTURE")
if [ "$RESULT" = "expected" ]; then pass "description"; else fail "description" "expected" "$RESULT"; fi
```

Fixtures cover: happy path, empty queue, auth failure, null fields, edge cases (rate limits, multiple blockers, PR filtering, etc.).

### Scaffold drift tests

Extracts each embedded code block from `src/workflows/scaffold.md` and diffs it against the source file in `src/templates/`. Fails if they diverge. This prevents the scaffold from getting out of sync with the actual templates.

### Credential guard tests

Invokes the Node.js hook directly via `node hooks/clancy-credential-guard.js '<json>'` and checks stdout for the expected `decision` field (`approve` or `block`).

Covers:
- Non-file-writing tools passthrough (Read, Bash, Glob)
- Allowed path exemptions (.clancy/.env, .env.example, .env.local, .env.development, .env.test)
- Clean content approval
- 13 credential pattern categories (GitHub PAT, AWS keys, Stripe, Slack, private keys, connection strings, etc.)
- Edit and MultiEdit tool support
- Block reason content verification
- Error resilience (empty input, invalid JSON, missing fields)

**Important:** Credential test values are constructed at runtime via string concatenation to avoid triggering GitHub's push protection scanner. See the `fake_cred()` helper in the test file.

### Smoke tests

Live API tests that require a configured `.clancy/.env` with real credentials. Not run in CI. Used for manual validation that board integrations work end-to-end.

## Adding Tests

### For a new board

1. Create fixtures in `test/fixtures/<board>-*.json` (minimum: happy-path, empty, auth-failure)
2. Create `test/unit/<board>.test.sh`
3. Add the test script to the `npm test` chain in `package.json`
4. Document fixtures in `test/README.md`

### For a new hook

1. Create `test/unit/<hook-name>.test.sh`
2. Invoke the hook via `node hooks/<hook>.js '<json>'` and assert stdout
3. Add to the `npm test` chain in `package.json`

### Test helpers

Each test file defines its own helpers:

```bash
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; echo "        expected: $2"; echo "        got:      $3"; FAIL=$((FAIL + 1)); }
```

Exit code is 1 if any test fails, 0 otherwise.
