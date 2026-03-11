# Testing

## Test Runner

Tests use Vitest with co-located test files (`<name>/<name>.test.ts`).

```bash
npm test                    # run all unit tests
npx vitest run --coverage   # with coverage report
npm run typecheck           # tsc --noEmit
npm run lint                # eslint
```

## Test Structure

Tests are co-located with their modules:

```
src/
├── scripts/
│   ├── once/once.test.ts                     — orchestrator tests
│   ├── shared/
│   │   ├── env-schema/env-schema.test.ts     — board detection + env validation
│   │   ├── branch/branch.test.ts             — branch computation
│   │   ├── prompt/prompt.test.ts             — prompt builder
│   │   ├── progress/progress.test.ts         — progress logging
│   │   ├── claude-cli/claude-cli.test.ts     — Claude CLI invocation
│   │   └── ...
│   └── board/
│       ├── jira/jira.test.ts                 — Jira API parsing
│       ├── github/github.test.ts             — GitHub API parsing
│       └── linear/linear.test.ts             — Linear API parsing
├── schemas/                                  — (tested via board module tests)
├── installer/
│   ├── hook-installer/hook-installer.test.ts
│   ├── manifest/manifest.test.ts
│   └── ...
└── utils/
    ├── ansi/ansi.test.ts
    └── parse-json/parse-json.test.ts
```

## How Tests Work

### Board module tests

Each board module test validates API response parsing, ticket extraction, and error handling using inline mock data. Tests use `vi.mock()` to stub HTTP calls and verify the module handles all response shapes correctly.

### Orchestrator tests

The once orchestrator tests mock all dependencies (board modules, git-ops, env-schema, etc.) and verify the full lifecycle: preflight → detect board → fetch ticket → branch → invoke Claude → merge → log.

### Env schema tests

Validate Zod schema parsing for each board's env vars, board detection priority (Jira → GitHub → Linear), missing var errors, and shared env var handling.

## Adding Tests

### For a new board

1. Create the board module with a co-located test file
2. Mock API responses inline (no fixture files needed)
3. Cover at minimum: happy path, empty queue, auth failure
4. Add env schema validation for the board's required vars

### For a new shared utility

1. Create the utility with a co-located `<name>.test.ts`
2. Test pure functions directly, mock side effects
3. Follow existing patterns in `src/scripts/shared/`
