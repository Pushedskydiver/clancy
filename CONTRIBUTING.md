# Contributing to Clancy

Thank you for your interest in contributing. Clancy uses TypeScript ESM for board modules and shared logic, with markdown commands and JSON configuration.

## How to contribute

### Reporting bugs

Open a GitHub issue using the bug report template. Include your board type, OS, and the full output.

### Suggesting features

Open a GitHub issue using the feature request template. Be specific about what you want and why.

### Pull requests

1. Fork the repository
2. Create a branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run the tests: `npm test`
5. Open a PR using the PR template

## Adding a new board

Adding board support is the most common contribution. Here's exactly what's needed:

### 1. Board module

Create a TypeScript module at `src/scripts/board/{board}/{board}.ts`. Use the existing Jira module (`src/scripts/board/jira/`) as your reference.

Required exports:
- `fetch{Board}Issue(env)` — fetch one ticket from the board API
- Zod schema for the board's env vars in `src/schemas/`

The unified orchestrator (`src/scripts/once/once.ts`) handles branching, Claude invocation, merging, and logging — your module only needs to handle board-specific API calls.

### 2. boards.json entry

Add to `registry/boards.json`. The `author` and `url` fields are **required** — PRs without them will not be merged.

```json
{
  "id": "your-board",
  "name": "Your Board Name",
  "author": "Company Name",
  "url": "https://your-board.com",
  "env": ["YOUR_BOARD_TOKEN", "CLANCY_BASE_BRANCH"]
}
```

### 3. .env.example

Add the board's `.env.example` content to `src/workflows/scaffold.md` under the `.env.example files` section.

### 4. Unit tests

Create co-located test files (`{board}/{board}.test.ts`) covering:
- Issue count parsing
- Key/identifier extraction
- Title/summary extraction
- Epic/parent extraction (or "none" when absent)
- Auth failure detection

## Style guide

- TypeScript: ESM with `.js` extensions in imports, `zod/mini` for validation
- JSON: 2-space indentation
- Markdown: ATX-style headings, fenced code blocks
- See `docs/CONVENTIONS.md` for full details

## Running tests

```bash
# Unit tests (no credentials required)
npm test

# Typecheck
npm run typecheck

# Lint
npm run lint
```

## Questions

Open an issue or start a discussion on GitHub.
