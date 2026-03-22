# QA-003e: GitHub Actions E2E workflow

## Summary

Create the GitHub Actions workflow for E2E tests: weekly schedule, manual dispatch with board selection, per-board matrix, orphan GC job, and nightly schema validation.

## Why

E2E tests are only valuable if they run regularly. A weekly schedule catches API drift within days. Manual dispatch lets you re-run a single board after fixing a failure. The GC job prevents sandbox pollution from failed runs.

## Acceptance Criteria

### 1. E2E workflow

- [ ] Create `.github/workflows/e2e-tests.yml`:

```yaml
name: E2E Smoke Tests
on:
  schedule:
    - cron: '0 6 * * 1'  # Weekly Monday 6am UTC
  workflow_dispatch:
    inputs:
      board:
        description: 'Run for specific board (or all)'
        required: false
        default: 'all'
        type: choice
        options: [all, jira, github, linear, shortcut, notion, azure-devops]
```

### 2. GC job (runs first)

- [ ] `gc` job runs `npm run test:e2e:gc` before the test matrix
- [ ] Cleans up orphan tickets from any prior failed runs
- [ ] Uses same credential env vars as the test matrix

### 3. Per-board test matrix

- [ ] `e2e` job with `needs: gc` (GC runs first)
- [ ] Matrix: `[jira, github, linear, shortcut, notion, azure-devops]`
- [ ] `fail-fast: false` — one board failure doesn't skip others
- [ ] `timeout-minutes: 30`
- [ ] Board filter from `workflow_dispatch` input applied to matrix

### 4. Credential mapping

- [ ] All credentials mapped from GitHub Actions secrets:

| Secret name | Env var | Board |
|---|---|---|
| `JIRA_BASE_URL` | `JIRA_BASE_URL` | Jira |
| `JIRA_USER` | `JIRA_USER` | Jira |
| `JIRA_API_TOKEN` | `JIRA_API_TOKEN` | Jira |
| `QA_GITHUB_TOKEN` | `GITHUB_TOKEN` | GitHub Issues |
| `QA_GITHUB_REPO` | `GITHUB_REPO` | GitHub Issues |
| `LINEAR_API_KEY` | `LINEAR_API_KEY` | Linear |
| `LINEAR_TEAM_ID` | `LINEAR_TEAM_ID` | Linear |
| `SHORTCUT_TOKEN` | `SHORTCUT_TOKEN` | Shortcut |
| `NOTION_TOKEN` | `NOTION_TOKEN` | Notion |
| `NOTION_DATABASE_ID` | `NOTION_DATABASE_ID` | Notion |
| `AZURE_ORG` | `AZURE_ORG` | Azure DevOps |
| `AZURE_PROJECT` | `AZURE_PROJECT` | Azure DevOps |
| `AZURE_PAT` | `AZURE_PAT` | Azure DevOps |

Note: `QA_GITHUB_TOKEN` secret name avoids collision with GitHub's built-in `GITHUB_TOKEN`.

### 5. Nightly schema check

- [ ] Add a nightly cron trigger or separate job:
  ```yaml
  schema-check:
    if: github.event.schedule == '0 4 * * *'
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:fixtures:live
  ```
- [ ] Hits each board's auth endpoint with real credentials, validates response against Zod schema
- [ ] Catches API drift faster than the weekly E2E cycle (days, not weeks)

### 6. Concurrency

- [ ] Add `concurrency` group to prevent overlapping runs (cron + manual dispatch):
  ```yaml
  concurrency:
    group: e2e-tests
    cancel-in-progress: false
  ```

## Out of scope

- CI pipeline for unit + integration tests (QA-004a)
- Branch protection rules (QA-004a)

## Dependencies

- **QA-003a** — E2E infrastructure and at least one passing board test
- **QA-003d** — Fixture feedback loop scripts (for nightly schema check)
- **QA-003-prereq** — All GitHub Actions secrets configured

## Notes

- The workflow uses `rm -rf node_modules package-lock.json && npm install` due to the existing npm bug with platform-specific optional deps (rollup on Linux). This matches the existing CI pattern.
- If two CI runs execute simultaneously despite the concurrency guard (edge case), the unique `runId` in ticket titles prevents data conflicts. Each run's cleanup is scoped to its own prefix.
- When the weekly run fails with 401, check credential expiry first (see QA-003-prereq for expiry notes).
