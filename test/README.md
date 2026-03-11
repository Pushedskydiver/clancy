# Tests

## Unit tests

Unit tests use Vitest and validate Clancy's TypeScript modules against fixture JSON files. No live API calls. No credentials required.

```bash
# Run all unit tests
npm test

# Run with coverage
npx vitest run --coverage
```

## Fixtures

Fixtures live in `test/fixtures/` and cover:

| File | What it tests |
|---|---|
| `jira-happy-path.json` | Normal Jira ticket with epic parent |
| `jira-empty-queue.json` | No tickets in queue |
| `jira-no-epic.json` | Ticket where parent and customfield_10014 are both null |
| `jira-adf-complex.json` | Deeply nested ADF with tables, code blocks, blockers |
| `jira-auth-failure.json` | Jira 401 response |
| `jira-rate-limit.json` | HTTP 429 simulation |
| `github-happy-path.json` | One real issue, no pull_request key |
| `github-pr-first.json` | First result is a PR — second is the real issue |
| `github-empty.json` | Empty issue list |
| `github-auth-failure.json` | GitHub bad credentials response |
| `linear-happy-path.json` | One issue with parent (epic) |
| `linear-empty.json` | Empty nodes array |
| `linear-auth-failure.json` | Linear authentication error |

## Adding a fixture for a new board

1. Create `test/fixtures/{board}-{scenario}.json` with a representative API response
2. Add test cases to the board's co-located test file
3. Cover at minimum: happy path, empty queue, auth failure
4. Document the new fixture in this README

## Adding a new board

See `CONTRIBUTING.md` — adding a board requires:
1. A TypeScript module in `src/scripts/shared/boards/{board}/`
2. A boards.json entry in `registry/boards.json` (with `author` and `url` — required)
3. Fixtures in `test/fixtures/{board}-*.json`
4. Co-located test files
