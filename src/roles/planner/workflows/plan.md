# Clancy Plan Workflow

## Overview

Fetch backlog tickets from the board, explore the codebase, and generate structured implementation plans. Plans are posted as comments on the ticket for human review. Does not implement anything — planning only.

---

## Step 1 — Preflight checks

1. Check `.clancy/` exists and `.clancy/.env` is present. If not:
   ```
   .clancy/ not found. Run /clancy:init to set up Clancy first.
   ```
   Stop.

2. Source `.clancy/.env` and check board credentials are present.

3. Check `.clancy/docs/` — if the directory is empty or missing:
   ```
   ⚠️  No codebase documentation found in .clancy/docs/
   Plans will be less accurate without codebase context.
   Run /clancy:map-codebase first for better results.

   Continue anyway? [y/N]
   ```
   If the user declines, stop. If they confirm, continue without docs context.

---

## Step 2 — Parse arguments

Parse the arguments passed to the command:

- **No argument:** plan 1 ticket
- **Numeric argument** (e.g. `/clancy:plan 3`): plan up to N tickets, cap at 10
- **`--force`:** re-plan tickets that already have a plan (reads feedback comments)
- Arguments can appear in any order (e.g. `/clancy:plan 3 --force` or `/clancy:plan --force 3`)

If N > 10: `Maximum batch size is 10. Planning 10 tickets.`

If N >= 5: display a confirmation:
```
Planning {N} tickets — each requires codebase exploration. Continue? [Y/n]
```

---

## Step 3 — Fetch backlog tickets

Detect board from `.clancy/.env` and fetch tickets from the **planning queue** (different from the implementation queue used by `/clancy:once`).

### Jira

Build the JQL using planning-specific env vars:
- `CLANCY_PLAN_STATUS` defaults to `Backlog` if not set
- Sprint clause: include `AND sprint in openSprints()` if `CLANCY_JQL_SPRINT` is set
- Label clause: include `AND labels = "$CLANCY_LABEL"` if `CLANCY_LABEL` is set

Full JQL: `project=$JIRA_PROJECT_KEY [AND sprint in openSprints()] [AND labels = "$CLANCY_LABEL"] AND assignee=currentUser() AND status="$CLANCY_PLAN_STATUS" ORDER BY priority ASC`

```bash
RESPONSE=$(curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/search/jql" \
  -d '{"jql": "<jql as above>", "maxResults": <N>, "fields": ["summary", "description", "issuelinks", "parent", "customfield_10014", "comment"]}')
```

Note: include the `comment` field so we can check for existing plans and read feedback.

### GitHub Issues

```bash
RESPONSE=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/issues?state=open&assignee=@me&labels=$CLANCY_PLAN_LABEL&per_page=<N>")
```

- `CLANCY_PLAN_LABEL` defaults to `needs-refinement` if not set
- Filter out PRs (entries with `pull_request` key)
- For each issue, fetch comments: `GET /repos/$GITHUB_REPO/issues/{number}/comments`

### Linear

Build the filter using `CLANCY_PLAN_STATE_TYPE` (defaults to `backlog` if not set):

```graphql
query {
  viewer {
    assignedIssues(
      filter: {
        state: { type: { eq: "$CLANCY_PLAN_STATE_TYPE" } }
        team: { id: { eq: "$LINEAR_TEAM_ID" } }
      }
      first: $N
      orderBy: priority
    ) {
      nodes {
        id identifier title description
        parent { identifier title }
        comments { nodes { body createdAt } }
      }
    }
  }
}
```

If the API call fails (non-200 response or network error):
```
❌ Board API error: {HTTP status or error message}

Check your credentials in .clancy/.env or run /clancy:doctor to diagnose.
```
Stop.

If no tickets found:
```
🚨 Clancy — Plan
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Nothing to see here." — No backlog tickets to plan.

Check your board configuration or run /clancy:settings to verify the plan queue.
{If GitHub: "For GitHub: planning uses the \"$CLANCY_PLAN_LABEL\" label (default: needs-refinement), not \"clancy\". Apply that label to issues you want planned."}
```
Stop.

---

## Step 3b — Check for existing plans (unless --force)

For each ticket, scan its comments for the marker `## Clancy Implementation Plan`:

- **No plan found:** proceed to step 4
- **Has plan, no `--force`:** skip — display `⏭️ [{KEY}] already planned. Use --force to re-plan.`
- **Has plan, with `--force`:** proceed to step 3c

---

## Step 3c — Read feedback comments (--force only)

When re-planning, read all comments posted AFTER the most recent `## Clancy Implementation Plan` comment. These are presumed to be PO/team feedback. No special syntax needed — they just comment normally on the ticket.

Pass this feedback to the plan generation step as additional context.

---

## Step 4 — For each ticket: Generate plan

Display the header:
```
🚨 Clancy — Plan
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Let me consult my crime files..." — Planning {N} ticket(s).
```

For each ticket, display a progress line when starting:
```
[{KEY}] {Title}
  Exploring codebase...
```

And when the plan is posted:
```
  ✅ Plan posted as comment.
```

For multi-ticket runs, this provides visibility into progress. `Ctrl+C` to stop early — completed plans are already posted.

### 4a. Quick feasibility scan

Before spending time exploring files, scan the ticket title and description for obvious non-codebase signals. Skip immediately if the ticket clearly requires work outside the codebase.

**Fail signals (skip immediately):**
- External platform references: "in Google Tag Manager", "in Salesforce", "in the AWS console", "in HubSpot", "in Jira admin"
- Human process steps: "get sign-off", "coordinate with", "schedule a meeting", "send an email to customers"
- Non-code deliverables: "write a runbook", "create a presentation", "update the wiki"
- Infrastructure ops: "rotate API keys in prod", "scale the fleet", "restart the service"

If infeasible:
```
⏭️  [{KEY}] {Title} — not a codebase change. Skipping.
   → {reason, e.g. "Ticket describes work in Google Tag Manager, not in the codebase."}
```

Continue to the next ticket. **Pass signals:** Anything mentioning code, components, features, bugs, UI, API, tests, refactoring, or lacking enough context to determine (benefit of the doubt).

### 4b. Check for previous implementation (QA return detection)

Check `.clancy/progress.txt` for any previous entry matching this ticket key that ends with `| DONE` (search for `| {KEY} |` on a line ending with `| DONE`). If found, the ticket was previously implemented by Clancy and has returned (likely from QA).

If detected:
- Flag as "Previously implemented — returned from QA"
- Read QA/review comments from the board (same mechanism as feedback loop in Step 3c)
- Focus the plan on what likely went wrong and what needs fixing

If no progress entry exists: treat as fresh.

### 4c. Read codebase context

If `.clancy/docs/` exists, read the following docs:
- `STACK.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`, `TESTING.md`, `DESIGN-SYSTEM.md`, `ACCESSIBILITY.md`, `DEFINITION-OF-DONE.md`

These inform the plan's technical approach, affected files, and test plan.

### 4d. Figma design context (if applicable)

If the ticket description contains a Figma URL and `FIGMA_API_KEY` is configured in `.clancy/.env`, fetch design context using Clancy's existing Figma MCP integration (3 MCP calls: metadata, design context, screenshot). This informs the acceptance criteria and affected components in the plan.

If Figma URL is present but `FIGMA_API_KEY` is not configured: note in the plan — "Figma URL present but API key not configured. Run /clancy:settings to add it."

### 4e. Explore source files

Based on the ticket title AND description, explore the codebase to identify affected files.

**For S-sized tickets (simple/obvious scope):** Single-pass exploration — Glob and Read directly.

**For M/L-sized tickets (broad scope, multiple subsystems):** Spin up 2-3 parallel Explore subagents:
- **Agent 1:** Search for files matching ticket keywords, find existing implementations of similar features
- **Agent 2:** Identify related test files, check test patterns in affected areas
- **Agent 3:** (if UI ticket) Check component structure, design system usage, accessibility patterns

The size is estimated from the ticket title/description before exploration begins (rough heuristic). Subagents return their findings, which are merged into the plan.

### 4f. Generate plan

Write the plan in this exact template:

```markdown
## Clancy Implementation Plan

**Ticket:** [{KEY}] {Title}
**Planned:** {YYYY-MM-DD}

### Summary
{1-3 sentences: what this ticket asks for, why it matters, gaps filled}

### Acceptance Criteria
- [ ] {Specific, testable criterion}
- [ ] {Specific, testable criterion}
- [ ] {Specific, testable criterion}

### Technical Approach
{2-4 sentences: implementation strategy, patterns, key decisions}

### Affected Files
| File | Change |
|------|--------|
| `src/path/file.ts` | {What changes and why} |
| `src/path/file.test.ts` | {What changes and why} |

### Edge Cases
- {Specific edge case and handling}
- {Specific edge case and handling}

### Test Plan
- [ ] {Specific test to write or verify}
- [ ] {Specific test to write or verify}

### Dependencies
{Blockers, prerequisites, external deps. "None" if clean.}

### Size Estimate
**{S / M / L}** — {Brief justification}

---
*Generated by [Clancy](https://github.com/Pushedskydiver/clancy).
To request changes: comment on this ticket, then run `/clancy:plan --force` to re-plan with your feedback.
To approve: run `/clancy:approve {KEY}` to promote this plan to the ticket description.*
```

**If re-planning with feedback**, prepend a section before Summary:
```markdown
### Changes From Previous Plan
{What feedback was addressed and how the plan changed}
```

**Quality rules:**
- Acceptance criteria must be testable ("user can X", "system does Y"), never vague
- Affected files must be real files found during exploration, not guesses
- Edge cases must be specific to this ticket, not generic
- Size: S (< 1 hour, few files), M (1-4 hours, moderate), L (4+ hours, significant)
- If affected files > 15: add a note "Consider splitting this ticket"
- If UI ticket without Figma URL: note in plan
- If ticket mentions tech not in STACK.md: note in plan

**Dependency detection:**

| Type | Detection | Action |
|------|-----------|--------|
| Blocked by another ticket | Jira: issuelinks (type "Blocks"). GitHub: referenced issues. Linear: relations. | List blocking tickets. Note "Complete {KEY} first." |
| Depends on external API | Mentioned in description or inferred from affected code | If API exists with docs: include integration approach. If API doesn't exist: mark as blocked. |
| Depends on unfinished design | UI ticket with no Figma URL or design reference | Note "Design dependency — no spec provided. Visual accuracy may vary." |
| Depends on library upgrade | Ticket mentions upgrading a dependency | Include upgrade as prerequisite step. Note potential breaking changes. |
| Depends on infra in the repo | DB migrations, docker-compose, CI config | Include in affected files and plan normally. |

---

## Step 5 — Post plan as comment

### Jira — POST comment

```bash
curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY/comment" \
  -d '<ADF JSON body>'
```

Construct ADF (Atlassian Document Format) JSON for the comment body. Key mappings:
- `## Heading` → `heading` node (level 2)
- `### Heading` → `heading` node (level 3)
- `- bullet` → `bulletList > listItem > paragraph`
- `- [ ] checkbox` → `taskList > taskItem` (state: "TODO")
- `| table |` → `table > tableRow > tableCell`
- `**bold**` → marks: `[{ "type": "strong" }]`
- `` `code` `` → marks: `[{ "type": "code" }]`

If ADF construction is too complex for a particular element, fall back to wrapping that section in a code block (`codeBlock` node).

### GitHub — POST comment

```bash
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -X POST \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/comments" \
  -d '{"body": "<markdown plan>"}'
```

GitHub accepts Markdown directly — post the plan as-is.

### Linear — commentCreate mutation

```bash
curl -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  "https://api.linear.app/graphql" \
  -d '{"query": "mutation { commentCreate(input: { issueId: \"$ISSUE_ID\", body: \"<markdown plan>\" }) { success } }"}'
```

Linear accepts Markdown directly.

**On failure:** Print the plan to stdout and warn — do not lose the plan. The user can manually paste it.

```
⚠️  Failed to post comment for [{KEY}]. Plan printed above — paste it manually.
```

---

## Step 6 — Log

For each planned ticket, append to `.clancy/progress.txt`:
```
YYYY-MM-DD HH:MM | {KEY} | PLAN | {S/M/L}
```

---

## Step 7 — Summary

After all tickets are processed, display:

```
Planned {N} ticket(s):

  ✅ [{KEY1}] {Title} — M | 6 files | Comment posted
  ✅ [{KEY2}] {Title} — S | 2 files | Comment posted
  ⏭️  [{KEY3}] {Title} — already planned
  ⏭️  [{KEY4}] {Title} — infeasible (external admin)

Plans written to your board. After review, run /clancy:approve {KEY} to promote.

"Let me dust this for prints..."
```

---

## Notes

- This command does NOT implement anything — it generates plans only
- Plans are posted as comments, never overwriting the ticket description (that's `/clancy:approve`)
- Re-running without `--force` safely skips already-planned tickets
- The planning queue is separate from the implementation queue — they never compete for the same tickets
- All board API calls are best-effort — if a comment fails to post, print the plan to stdout as fallback
- When exploring the codebase, use Glob and Read for small tickets, parallel Explore subagents for larger ones
- The `## Clancy Implementation Plan` marker in comments is used by both `/clancy:plan` (to detect existing plans) and `/clancy:approve` (to find the plan to promote)
