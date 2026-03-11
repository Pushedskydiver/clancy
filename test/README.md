# Tests

## Unit tests

Unit tests use Vitest and validate Clancy's TypeScript modules. Tests are co-located with their modules (`<name>/<name>.test.ts`). No live API calls. No credentials required.

```bash
# Run all unit tests
npm test

# Run with coverage
npx vitest run --coverage
```

## Adding a new board

See `CONTRIBUTING.md` — adding a board requires:
1. A TypeScript module in `src/scripts/shared/boards/{board}/`
2. A boards.json entry in `registry/boards.json` (with `author` and `url` — required)
3. Co-located test files covering: happy path, empty queue, auth failure
