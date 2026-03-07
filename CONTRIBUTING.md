# Contributing to Clancy

Thank you for your interest in contributing. Clancy is intentionally simple — shell scripts, markdown, and JSON. No build step, no transpilation.

## How to contribute

### Reporting bugs

Open a GitHub issue using the bug report template. Include your board type, OS, and the full script output.

### Suggesting features

Open a GitHub issue using the feature request template. Be specific about what you want and why.

### Pull requests

1. Fork the repository
2. Create a branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run the unit tests: `npm test`
5. Open a PR using the PR template

## Adding a new board

Adding board support is the most common contribution. Here's exactly what's needed:

### 1. Shell script

Create `src/templates/scripts/clancy-once-{board}.sh`. Use `clancy-once.sh` (Jira) as your reference.

Required structure:
- `#!/usr/bin/env bash` + `set -euo pipefail`
- Full preflight checks (copy from existing script, adapt credential checks)
- Board API fetch (one ticket, don't paginate)
- Create feature branch from `$CLANCY_BASE_BRANCH`
- Pipe prompt to `claude --dangerously-skip-permissions`
- Squash merge back to epic branch
- Delete local ticket branch
- Log to `.clancy/progress.txt`

### 2. boards.json entry

Add to `registry/boards.json`. The `author` and `url` fields are **required** — PRs without them will not be merged.

```json
{
  "id": "your-board",
  "name": "Your Board Name",
  "author": "Company Name",
  "url": "https://your-board.com",
  "env": ["YOUR_BOARD_TOKEN", "CLANCY_BASE_BRANCH"],
  "script": "clancy-once-{board}.sh"
}
```

### 3. .env.example

Create `src/templates/.env.example.{board}` with all required environment variables documented.

### 4. Fixtures

Create at minimum:
- `test/fixtures/{board}-happy-path.json` — one ticket, all fields populated
- `test/fixtures/{board}-empty.json` — empty queue response
- `test/fixtures/{board}-auth-failure.json` — authentication error response

### 5. Unit tests

Create `test/unit/{board}.test.sh` covering:
- Issue count parsing
- Key/identifier extraction
- Title/summary extraction
- Epic/parent extraction (or "none" when absent)
- Branch name derivation
- Auth failure detection

### 6. Update test/README.md

Document your new fixtures in the table.

## Style guide

- Shell scripts: POSIX bash, `#!/usr/bin/env bash`, `set -euo pipefail`
- JSON: 2-space indentation
- Markdown: ATX-style headings, fenced code blocks
- No Node.js dependencies beyond what's already in package.json

## Running tests

```bash
# Unit tests (no credentials required)
npm test

# Individual suite
bash test/unit/jira.test.sh

# Smoke tests (requires valid .env in a configured project)
bash test/smoke/smoke.sh
```

## Questions

Open an issue or start a discussion on GitHub.
