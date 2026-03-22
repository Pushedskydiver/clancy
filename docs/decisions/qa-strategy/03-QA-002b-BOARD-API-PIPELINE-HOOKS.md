# QA-002b: Integration tests — Board API interactions, pipeline labels, installer, and hooks

> **Status: Shipped** — v0.8.9–v0.8.15, PRs #64–#68. 167 integration tests across 5 sub-tickets. Layer 1 complete.

## Summary

Write MSW-backed integration tests for the remaining flows: board API write operations (the functions that prompt-driven commands call), cross-role pipeline label transitions, installer sub-modules, and expanded hook scenarios. This completes Layer 1.

## Why

QA-002a covers the Implementer path — the most common flow. But Clancy's value includes the full brief -> plan -> build pipeline, and safety hooks protect against real-world edge cases. The prompt-driven commands (planner, strategist, doctor, etc.) cannot be invoked programmatically, but the board API functions they call can and should be integration-tested through MSW.

## What's testable vs. what's not

| What | Testable? | How |
|---|---|---|
| Board comment posting (planner posts plans) | Yes | Call board module's comment function with MSW |
| Board ticket creation (strategist creates tickets) | Yes | Call board module's create function with MSW |
| Board label mutations (pipeline transitions) | Yes | Call board module's label functions with MSW |
| Board status transitions | Yes | Call board module's transition function with MSW |
| Plan quality / prompt output | No | Prompt-driven, non-deterministic |
| Grill phase interaction | No | Prompt-driven, interactive |
| Doctor diagnostic checks | No | Prompt-driven, Claude interprets workflow |
| Map-codebase output | No | Prompt-driven, spawns 5 agents |

## Acceptance Criteria

### 1. Board API write operation tests

- [ ] Create `test/integration/flows/board-api.test.ts`
- [ ] Test for at least Jira, GitHub Issues, and Linear (the 3 boards with the most distinct APIs):

**Comment posting (what planner does):**
- Set up MSW handler that captures comment POST body
- Call the board module's comment-posting function with a realistic plan body
- Assert: MSW captured the request with correct ticket key, correct body format
- Assert: Jira uses `POST /rest/api/3/issue/{key}/comment`, GitHub uses `POST /repos/{o}/{r}/issues/{n}/comments`, Linear uses GraphQL `commentCreate` mutation

**Ticket creation (what strategist does):**
- Set up MSW handler that captures ticket creation request body
- Call the board module's ticket creation function with title, description, labels
- Assert: MSW captured request with correct fields
- Assert: `clancy:brief` label included in creation
- Assert: Jira returns `key`, GitHub returns `number`, Linear returns `id`

**Label add/remove (pipeline transitions):**
- Set up MSW handlers for label operations
- Call board's `addLabel()` then `removeLabel()` via the Board type interface
- Assert: correct API calls made in order (add-before-remove for crash safety)
- Assert: Jira uses `PUT /rest/api/3/issue/{key}` with labels array, GitHub uses `POST /repos/{o}/{r}/issues/{n}/labels` + `DELETE`, Linear uses `issueUpdate` mutation

**Status transition:**
- Call board's transition function
- Assert: MSW captured transition with correct target state
- Assert: Jira uses `POST /transitions` with transition ID, GitHub uses label-based state, Linear uses `issueUpdate` with state ID

### 2. Pipeline label transitions (cross-role)

- [ ] Create `test/integration/flows/pipeline.test.ts`
- [ ] Test for at least GitHub Issues (simplest label API):

**Brief -> Plan -> Build full pipeline via board functions:**
1. Call board's `addLabel(ticketKey, 'clancy:brief')` — assert MSW captured label add
2. Call board's `removeLabel(ticketKey, 'clancy:brief')` then `addLabel(ticketKey, 'clancy:plan')` — assert correct order (add-before-remove)
3. Call board's `removeLabel(ticketKey, 'clancy:plan')` then `addLabel(ticketKey, 'clancy:build')` — assert correct order
4. Run the once orchestrator (`run([])` with MSW returning the ticket with `clancy:build` label) to verify the build phase picks it up
5. Assert: full pipeline completed — ticket went through all 3 label stages, progress.txt has DONE entry

**Plan-label guard:**
- MSW returns ticket with BOTH `clancy:plan` and `clancy:build` labels
- Run `run([])`
- Assert: plan-label guard in `fetch-ticket.ts` prevents dual-label race condition — ticket skipped or `clancy:plan` label takes precedence

**Label crash safety:**
- Simulate: `addLabel` succeeds but `removeLabel` fails (MSW returns 500 for remove)
- Assert: ticket has both labels (crash-safe state — old label not removed but new label present)
- Assert: no crash, clean exit

### 3. Installer sub-module tests

- [ ] Create `test/integration/flows/installer.test.ts`
- [ ] Test the independently importable sub-modules (not the CLI entry point):

**File operations (`file-ops`):**
- Create a source directory with files
- Call `copyDir(src, dest)`
- Assert: all files copied correctly, directory structure preserved

**Manifest-based change detection (`manifest`):**
- Create initial scaffold, call `buildManifest()` to generate hashes
- Modify a file inside the scaffold
- Call `detectModifiedFiles()` with the original manifest
- Assert: modified file detected, unmodified files not flagged

**Backup on update (`manifest`):**
- Detect a modified file
- Call `backupModifiedFiles()`
- Assert: original file backed up before overwrite, backup contains the user's modifications

**Hook installation (`hook-installer`):**
- Call `installHooks()` with a temp project directory
- Assert: hook files copied, `settings.json` updated with hook registrations
- Assert: existing `settings.json` content preserved (merge, not overwrite)

**Role filtering:**
- Set `CLANCY_ROLES=planner,strategist` in env
- Verify installer logic would include optional role files
- Set `CLANCY_ROLES` to empty
- Verify only core roles included

### 4. Hook scenario tests

- [ ] Create `test/integration/flows/hooks.test.ts`
- [ ] Test hooks via their stdin/stdout JSON contract (same as existing hook tests, but with expanded scenarios):

**Credential guard — all pattern categories:**
- Test EACH pattern from the `CREDENTIAL_PATTERNS` array in `clancy-credential-guard.js`:
  - Generic API key, secret, token, password
  - AWS access key (`AKIA...`), AWS secret key
  - GitHub PAT classic (`ghp_`), fine-grained (`github_pat_`), OAuth (`gho_`)
  - Slack token (`xox[bpors]-`)
  - Stripe key (`sk_live_`, `pk_test_`)
  - Private keys (RSA, EC, DSA, OPENSSH)
  - Atlassian API token
  - Linear API key (`lin_api_`)
  - Database connection strings (mongodb://, postgres://)
- Assert: each pattern returns `{ "decision": "block" }` with explanatory message

**Credential guard — allowed paths:**
- Send file content containing a credential pattern BUT with path `.clancy/.env`
- Assert: returns `{ "decision": "allow" }` (allowed path exemption)
- Repeat for `.env.local`, `.env.example`, `.env.development`, `.env.test`

**Credential guard — edge cases:**
- Credential pattern inside a code comment — assert: still blocked (guard is conservative)
- Credential pattern in a test file — assert: still blocked
- String that looks like a key but is too short — assert: allowed
- Normal TypeScript code with no credentials — assert: allowed

**Branch guard — all protected operations:**
- `git push --force` -> blocked
- `git push -f` -> blocked
- `git push --force-with-lease` -> **allowed** (safe force push)
- `git push origin main` -> blocked (protected branch)
- `git push origin master` -> blocked (protected branch)
- `git push origin develop` -> blocked (protected branch)
- `git reset --hard` -> blocked
- `git clean -fd` -> blocked
- `git checkout .` -> blocked (bulk discard)
- `git checkout -- .` -> blocked (bulk discard)
- `git restore .` -> blocked (bulk discard)
- `git branch -D feature/something` -> blocked (force delete)
- `git push origin feature/TICKET-123` -> allowed
- `git commit -m "feat: something"` -> allowed
- `git push origin main-feature` -> allowed (not a protected branch, partial match)

**Context monitor — threshold + debounce logic:**
- Create bridge file with 40% remaining -> assert: no warning
- Create bridge file with 35% remaining -> assert: WARNING level message
- Create bridge file with 25% remaining -> assert: CRITICAL level message
- Call 5 times at same severity -> assert: debounce suppresses repeated warnings
- Escalate from WARNING to CRITICAL -> assert: debounce bypassed, critical message emitted

**Context monitor — time guard:**
- Create lock file with `startedAt` at 80% of `CLANCY_TIME_LIMIT` ago -> assert: time WARNING
- Create lock file with `startedAt` at 100%+ of `CLANCY_TIME_LIMIT` ago -> assert: time CRITICAL

**PostCompact re-injection:**
- Create lock file with ticket context (key, branch, title, description)
- Pipe PostCompact event to hook
- Assert: returns `additionalContext` containing ticket key, branch name, and requirements

### 5. All Layer 1 tests pass together

- [ ] `npm run test:integration` passes with all flow tests from QA-002a and QA-002b
- [ ] No test depends on execution order
- [ ] Total integration test count documented

## Out of scope

- Testing prompt-driven commands end-to-end (not possible without Claude Code runtime)
- E2E tests against real APIs (QA-003)
- Testing prompt quality or AI output (not deterministic, not regression-testable)

## Dependencies

- **QA-001** — infrastructure (simulator, temp repo, MSW, env fixtures) must be complete
- **QA-002a** — all 6 board MSW handlers with full scenario coverage must exist

## Notes

- The pipeline label test (section 2) is the most valuable test in this ticket. It's the only place where cross-role label state is tested as a connected flow.
- Hook tests import nothing from the hook files (they're CommonJS with no exports). Tests pipe JSON to the hook process's stdin and assert on stdout JSON. Use `child_process.execSync` or similar to invoke the hook script.
- For board API write operations, import the Board type wrapper functions (e.g. from `src/scripts/board/jira/jira-board.ts`), not the raw API modules. The wrapper functions are what the prompt-driven commands would call.
- The credential guard has 14 pattern categories — test each one individually. This is tedious but high-value: a regex regression in any pattern silently disables a safety check.
