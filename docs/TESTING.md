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
│   ├── once/once.test.ts                                    — orchestrator lifecycle
│   ├── afk/afk.test.ts                                      — AFK loop runner
│   ├── board/
│   │   ├── jira/jira.test.ts                                — Jira API (sync + async)
│   │   ├── github/github.test.ts                            — GitHub Issues API
│   │   └── linear/linear.test.ts                            — Linear GraphQL API
│   └── shared/
│       ├── branch/branch.test.ts                            — branch computation
│       ├── claude-cli/claude-cli.test.ts                    — Claude CLI invocation
│       ├── env-parser/env-parser.test.ts                    — .env file parsing
│       ├── env-schema/env-schema.test.ts                    — board detection + validation
│       ├── feasibility/feasibility.test.ts                  — ticket feasibility check
│       ├── feedback/feedback.test.ts                        — reviewer comment fetching
│       ├── format/format.test.ts                            — shared formatters
│       ├── git-ops/git-ops.test.ts                          — git operations
│       ├── http/http.test.ts                                — HTTP helpers + pingEndpoint
│       ├── notify/notify.test.ts                            — Slack/Teams notifications
│       ├── preflight/preflight.test.ts                      — binary + git checks
│       ├── progress/progress.test.ts                        — progress logging
│       ├── prompt/prompt.test.ts                            — prompt builder
│       ├── pull-request/
│       │   ├── bitbucket/bitbucket.test.ts                  — Bitbucket Cloud + Server PR
│       │   ├── github/github.test.ts                        — GitHub PR creation
│       │   ├── gitlab/gitlab.test.ts                        — GitLab MR creation
│       │   ├── post-pr/post-pr.test.ts                      — shared PR utility
│       │   └── pr-body/pr-body.test.ts                      — PR body builder
│       └── remote/remote.test.ts                            — git host detection
├── installer/
│   ├── file-ops/file-ops.test.ts                            — file copy operations
│   ├── hook-installer/hook-installer.test.ts                — hook registration
│   └── manifest/manifest.test.ts                            — SHA-256 manifest generation
└── utils/
    ├── ansi/ansi.test.ts                                    — ANSI colour helpers
    └── parse-json/parse-json.test.ts                        — safe JSON parsing
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
