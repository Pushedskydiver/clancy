# QA-003-prereq: Human setup — sandbox accounts and credentials

## Summary

Set up sandbox accounts, repos, and credentials for all 6 board platforms so E2E tests can create real tickets, run the orchestrator, and verify outcomes via API.

## Why

E2E tests hit real APIs. Each board needs a dedicated sandbox environment with test credentials. This is manual work that must be done before any E2E test code can be written or run.

## Owner

Alex (human — not automatable).

## Checklist

### Board platforms

- [ ] **Jira:** Project `CLANCYQA`, test user with API token
- [ ] **GitHub Issues:** Repo `Pushedskydiver/clancy-qa-sandbox` with fine-grained PAT (Issues + Contents + Pull Requests scopes)
- [ ] **Linear:** Team "Clancy QA" with API key
- [ ] **Shortcut:** Workspace with API token
- [ ] **Notion:** Database with properties matching Clancy's expected schema + integration token
- [ ] **Azure DevOps:** Org + project with PAT (read/write work items + `destroy` if possible)

### Git host sandbox

- [ ] **GitHub:** `Pushedskydiver/clancy-qa-sandbox` (shared with GitHub Issues setup)
- [ ] GitLab and Bitbucket deferred — start with GitHub only

### Credentials

- [ ] Add all credentials as GitHub Actions secrets (names listed in QA-003e)
- [ ] Create `.env.e2e.example` listing all required env vars (committed, no values)
- [ ] Populate local `.env.e2e` with real credentials (gitignored)

### Credential expiry notes

| Board | Expiry |
|---|---|
| Jira API token | No expiry (unless admin revokes) |
| GitHub fine-grained PAT | Configurable (set to 1 year, note renewal date) |
| Linear API key | No expiry |
| Shortcut API token | No expiry |
| Notion integration token | No expiry (unless integration removed) |
| Azure DevOps PAT | Configurable (set to 1 year, note renewal date) |

When the weekly E2E run fails with 401 for a specific board, expired credential is the first thing to check.

## Dependencies

- Layer 1 complete (shipped)

## Notes

- Start with GitHub — it's the simplest and doubles as the git host sandbox. QA-003a only needs GitHub ready.
- Other boards can be set up incrementally as QA-003b and QA-003c are picked up.
