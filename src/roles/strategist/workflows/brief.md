# Clancy Brief Workflow

## Overview

Research an idea, interrogate it thoroughly, and generate a structured strategic brief with vertical-slice ticket decomposition. Briefs are saved locally and optionally posted as comments on the source ticket. Does not create tickets — that is `/clancy:approve-brief`.

---

## Step 1 — Preflight checks

1. Check `.clancy/` exists and `.clancy/.env` is present. If not:
   ```
   .clancy/ not found. Run /clancy:init to set up Clancy first.
   ```
   Stop.

2. Source `.clancy/.env` and check board credentials are present.

3. Check `CLANCY_ROLES` includes `strategist` (or env var is unset, which indicates a global install where all roles are available). If `CLANCY_ROLES` is set but does not include `strategist`:
   ```
   The Strategist role is not enabled. Add "strategist" to CLANCY_ROLES in .clancy/.env or run /clancy:settings.
   ```
   Stop.

4. Branch freshness check — run `git fetch origin` and compare the current HEAD with `origin/$CLANCY_BASE_BRANCH` (defaults to `main`). If the local branch is behind:

   **AFK mode** (`--afk` flag or `CLANCY_MODE=afk`): auto-pull without prompting. Run `git pull origin $CLANCY_BASE_BRANCH` and continue.

   **Interactive mode:**
   ```
   ⚠️  Your local branch is behind origin/{CLANCY_BASE_BRANCH} by {N} commit(s).

   [1] Pull latest
   [2] Continue anyway
   [3] Abort
   ```
   - [1] runs `git pull origin $CLANCY_BASE_BRANCH` and continues
   - [2] continues without pulling
   - [3] stops

---

## Step 2 — Parse arguments

Parse the arguments passed to the command. Arguments can appear in any order.

### Flags

- **`--list`** — show brief inventory and stop (no brief generated)
- **`--fresh`** — discard any existing brief and start over from scratch
- **`--research`** — force web research agent (adds 1 web agent to the research phase)
- **`--afk`** — use AI-grill instead of human grill (no interactive questions)
- **`--epic {KEY}`** — hint for `/clancy:approve-brief` later. Stored in the brief's metadata. Ignored if the input is a board ticket (the source ticket is the parent).

### Input modes

- **No input (no flags that consume arguments):** Interactive mode — but first check for `--afk`:
  - If running in AFK mode (`--afk` flag OR `CLANCY_MODE=afk`): there is no human to answer. Display: `✗ Cannot run /clancy:brief in AFK mode without a ticket or idea. Use: /clancy:brief --afk #42 (GitHub) or PROJ-123 (Jira) or ENG-42 (Linear), or /clancy:brief --afk "Add dark mode", or /clancy:brief 3 (batch mode — implies --afk).` Stop.
  - Otherwise: prompt `What's the idea?` and parse the response. If the response looks like a ticket reference (`#42`, `PROJ-123`, `ENG-42`), switch to board ticket mode. Otherwise treat as inline text.
- **Ticket key** (`PROJ-123`, `#42`, `ENG-42`): Board ticket mode — fetch the ticket from the board API. Validate format per platform:
  - `#N` — valid for GitHub only. If board is Jira or Linear: `The #N format is for GitHub Issues. Use a ticket key like PROJ-123.` Stop.
  - `PROJ-123` / `ENG-42` (letters-dash-number) — valid for Jira and Linear. If board is GitHub: `Use #N format for GitHub Issues (e.g. #42).` Stop.
- **Quoted string or unquoted non-matching text** (e.g. `"Add dark mode"`): Inline text mode — use the text directly as the idea.
- **`--from {path}`** — From file mode. Cannot be combined with a ticket reference (error if both present: `Cannot use both a ticket reference and --from. Use one or the other.`). Validate:
  - File does not exist: `File not found: {path}` Stop.
  - File is empty: `File is empty: {path}` Stop.
  - File > 50KB: Warn `Large file ({size}KB). Clancy will use the first ~50KB for context.` Truncate internally, continue.
- **Bare positive integer** (e.g. `/clancy:brief 3`): Batch mode or ambiguous.
  - Board is GitHub and value could be an issue: Ambiguous — ask: `Did you mean issue #3 or batch 3 tickets? [1] Brief issue #3 [2] Brief 3 tickets from queue`
  - Board is Jira or Linear: Batch mode (N tickets from queue). Implies `--afk` (AI-grill for all).

If N > 10: `Maximum batch size is 10. Briefing 10 tickets.`

### --list flag handling

If `--list` is present (with or without other arguments), jump to Step 11 (Brief Inventory) and stop.

---

## Step 3 — Gather idea (mode-specific)

### Board ticket mode

Fetch the source ticket from the board API.

#### GitHub — Fetch specific issue

```bash
RESPONSE=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER")
```

Validate the response:
- If `pull_request` field is present and non-null: `#N is a pull request, not an issue.` Stop.
- If `state` is `closed`: warn `#N is closed. Brief it anyway? [y/N]`
- If `body` is null/empty: warn `No issue description — briefing from title only.`
- Extract: `title`, `body`, `labels`, `milestone`.

Fetch comments for existing brief detection:
```bash
COMMENTS=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/comments?per_page=100")
```

#### Jira — Fetch specific ticket

```bash
RESPONSE=$(curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY?fields=summary,description,status,issuetype,parent,customfield_10014,components,priority,comment,project")
```

Validate the response:
- If `fields.status.statusCategory.key` is `done`: warn `{KEY} is Done. Brief it anyway? [y/N]`
- If `fields.status.statusCategory.key` is `indeterminate`: warn `{KEY} is In Progress — briefing anyway.`
- If `fields.issuetype.name` is `Epic`: note `{KEY} is an Epic — child tickets will be created under it.`
- Extract: `summary`, `description` (ADF → plain text via `extractAdfText()`), status, existing comments from `comment.comments[]`.

#### Linear — Fetch specific issue

```graphql
query {
  issues(filter: { identifier: { eq: "$IDENTIFIER" } }) {
    nodes {
      id identifier title description
      state { id name type }
      parent { id identifier title }
      children { nodes { id identifier title state { type } } }
      team { id key name }
      labels { nodes { id name } }
      priority estimate
    }
  }
}
```

Validate the response:
- If `nodes` is empty: `Issue {KEY} not found on Linear.` Stop.
- If `state.type` is `completed` or `canceled`: warn `{KEY} is {state.name}. Brief it anyway? [y/N]`
- If `state.type` is `started`: warn `{KEY} is In Progress — briefing anyway.`
- If `parent` is present: warn `{KEY} is a sub-issue of {parent.identifier}. Creating children will produce a 3-level hierarchy. Continue? [Y/n]`
- If `team.id` differs from `LINEAR_TEAM_ID`: warn `{KEY} belongs to team "{team.name}", but LINEAR_TEAM_ID is different. Continue? [Y/n]`

#### All platforms — error handling

If the API call fails:
- 404: `{KEY} not found — check the ticket key.` Stop.
- 401: `Auth failed — check credentials in .clancy/.env` Stop.
- 403: `Permission denied — check token scopes.` Stop.
- 5xx / timeout: `Server error. Try again in a few minutes.` Stop.
- Network error: `Could not reach {platform} — check network connection.` Stop.

### Inline text mode

Use the provided text directly. No API call.

### From file mode

Read the file content. Slug derived from filename (strip extension, strip date prefix if present).

### Batch mode

Fetch N issues from the planning queue (same labels/statuses as `/clancy:plan`):

#### GitHub batch fetch
```bash
GITHUB_USERNAME=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user | jq -r '.login')

RESPONSE=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/issues?state=open&assignee=$GITHUB_USERNAME&labels=$CLANCY_PLAN_LABEL&per_page=$N")
```

Filter out PRs (entries with `pull_request` key).

#### Jira batch fetch
```bash
RESPONSE=$(curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/search/jql" \
  -d '{"jql": "project=$JIRA_PROJECT_KEY AND assignee=currentUser() AND status=\"$CLANCY_PLAN_STATUS\" ORDER BY priority ASC", "maxResults": <N>, "fields": ["summary", "description", "status", "issuetype", "parent", "comment"]}')
```

`CLANCY_PLAN_STATUS` defaults to `Backlog`.

#### Linear batch fetch
```graphql
query {
  viewer {
    assignedIssues(
      filter: {
        state: { type: { eq: "unstarted" } }
        team: { id: { eq: "$LINEAR_TEAM_ID" } }
      }
      first: $N
      orderBy: priority
    ) {
      nodes {
        id identifier title description
        state { id name type }
        parent { id identifier title }
        children { nodes { id identifier title state { type } } }
        team { id key }
      }
    }
  }
}
```

If no tickets found:
```
No tickets in the planning queue. Check your queue label/status configuration.
```
Stop.

For batch mode, process each ticket sequentially through Steps 4-10. Skip tickets that already have a brief (check `.clancy/briefs/`). Batch mode always uses AI-grill (no human interaction per ticket).

---

## Step 4 — Grill phase

The grill phase is the most critical part of the brief workflow. Its purpose is to walk every branch of the design tree, resolving ambiguity upfront rather than encoding it into vague tickets.

### Mode detection

```
--afk flag passed?         -> AI-GRILL
CLANCY_MODE=afk in env?    -> AI-GRILL
Batch mode (N tickets)?    -> AI-GRILL
Otherwise                  -> HUMAN GRILL
```

The `--afk` flag takes precedence over `CLANCY_MODE`.

### Human grill

Interview the user RELENTLESSLY about every aspect of the idea until you reach a shared understanding.

**Core principle** (from Matt Pocock's "grill me" skill):

> "Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one by one. If a question can be answered by exploring the codebase, explore the codebase instead."

**Rules:**

1. Be RELENTLESS. Do not accept vague answers. If the user says "it should be fast", ask "what's the latency budget? 100ms? 500ms? Per-request or p99?" If they say "just pick something", explain the trade-offs and make them choose.

2. For each question, **provide your recommended answer** based on codebase context, board context, or best practices. The user can agree, disagree, or ask for more detail. This speeds up the grill — the user confirms or overrides rather than researching from scratch.

3. Walk each branch of the design tree to its CONCLUSION before moving to the next. Don't jump between topics — follow each thread until it's fully resolved.

4. Explore the codebase instead of asking when the answer is in the code. Don't ask "do you have an auth module?" — check. Then ask informed follow-ups: "I see `src/auth/sso-provider.ts` uses SAML. Should the new feature use the same provider?"

5. This is a TWO-WAY conversation. The user can ask questions back at any time:
   - "What does the codebase currently use?" → explore and answer
   - "What do other projects typically do?" → web research
   - "Are there related tickets?" → board query
   - "What would you recommend?" → give an informed opinion with trade-offs, then let the user decide

6. Answers spawn follow-up questions (multi-round): "We want SSO" → "SAML or OIDC?" → "OIDC" → "Which provider? No OIDC client in codebase yet."

7. Do NOT generate the brief until the grill is complete. The goal is ZERO AMBIGUITY before a single ticket is written. Push back if the user tries to rush: "We still have open questions about X and Y. Let's resolve those first."

8. Stop when you reach a SHARED UNDERSTANDING — both sides agree they understand the full scope, constraints, and decisions. Not just "no more questions" but genuine mutual comprehension.

9. The resolved answers feed into the `## Discovery` section of the brief.

**Question categories:**
- **Scope:** What's in and what's out?
- **Users:** Who uses this? What are the personas?
- **Constraints:** Performance budget? Browser support? Auth?
- **Edge cases:** What happens when X is empty / fails / times out?
- **Dependencies:** Does this depend on other in-flight work?
- **Existing code:** How does this interact with `{module}`?
- **Data:** What's the data model? Volume? Retention?
- **Security:** Who can access this? What's the auth boundary?
- **Observability:** How will you know if this breaks?

Typical: 5-20 clarifying questions over 2-5 rounds.

### AI-grill

Same relentless energy as the human grill, but directed at the strategist itself via a devil's advocate agent.

1. Generate 10-15 clarifying questions using the same categories as the human grill (scope, users, constraints, edge cases, dependencies, existing code, data, security, observability).

2. Spawn the devil's advocate agent via the Agent tool, passing:
   - The idea text (ticket title + description, or inline text, or file content)
   - The 10-15 generated questions
   - The path to the agent prompt: `src/agents/devils-advocate.md`

3. The devil's advocate agent answers each question by INTERROGATING ITS SOURCES:
   - **Codebase:** explore affected areas, read `.clancy/docs/`, check existing patterns. Don't assume — look.
   - **Board:** parent ticket, related tickets, existing children. Check for conflicting requirements.
   - **Web:** when the question involves external technology, patterns, or third-party integrations. Same trigger as Step 6: `--research` flag forces it, otherwise judgement-based.

4. The agent CHALLENGES ITS OWN ANSWERS. If the codebase says one thing but the ticket description says another, flag the conflict. If a question can be partially answered, answer the part it can and flag the rest. Do NOT accept vague self-answers — if the codebase doesn't clearly support a decision, don't guess.

5. Answers may spawn SELF-FOLLOW-UPS within the same pass: "Should this support SSO?" → checks codebase → finds `src/auth/sso-provider.ts` → "SSO exists, but it's SAML. Should the new feature use SAML or add OIDC?" → checks ticket description → no mention → checks web → "OIDC is the modern standard" → resolves as OIDC with caveat. All resolved in one pass.

6. Single pass — no multi-round loop with the human. But the agent must be thorough enough in one pass that a second would add nothing.

7. The agent NEVER asks the human questions (that defeats `--afk` mode). Unresolvable questions go to `## Open Questions` for the PO to address during brief review.

8. Classify each question:
   - **Answerable** (>80% confidence, or technical decision with clear codebase precedent) → `## Discovery` with source tag
   - **Conflicting evidence** (codebase says X, ticket says Y) → `## Open Questions` with conflict noted
   - **Not answerable** (business decision, ambiguous requirements, no codebase precedent, involves money/legal/compliance/security policy) → `## Open Questions` for PO

Typical: 10-15 questions, 8-12 resolved, 2-4 open.

### Output from both modes

Both grill modes produce a `## Discovery` section and an `## Open Questions` section. Each Q&A in Discovery includes a source tag:

```
## Discovery

Q: Should we support system preference detection?
A: Yes — the codebase already uses `prefers-color-scheme` in
   `src/styles/media.ts`. (Source: codebase)

Q: Should dark mode persist across sessions?
A: Yes, store in localStorage. User confirmed. (Source: human)

Q: What's the industry standard for dark mode colour contrast?
A: WCAG AA requires 4.5:1 ratio for normal text. (Source: web)

## Open Questions
- [ ] Should dark mode apply to emails/PDFs or just the web UI?
- [ ] Should portal users see all org data or only their team's?
      (No RBAC policy found in codebase or ticket — needs PO input)
```

Source tags: `(Source: human)`, `(Source: codebase)`, `(Source: board)`, `(Source: web)`

---

## Step 5 — Auto-detect existing brief

Scan `.clancy/briefs/` for an existing brief matching this idea:
- **Board ticket:** match by ticket key in the `**Source:**` line
- **Inline text / file:** match by slug in the filename

| Condition | Behaviour |
|---|---|
| No existing brief | Continue to Step 6 (fresh brief) |
| Existing brief + `--fresh` flag | Delete old file, continue to Step 6 |
| Existing brief + feedback found | Revise: read existing brief + all feedback, generate revised brief with `### Changes From Previous Brief` section |
| Existing brief + no feedback + no `--fresh` | Stop: `Already briefed. Add feedback to revise, or use --fresh to start over.` |

### Feedback detection (3 sources, checked in order)

1. **Local brief file** — check for `## Feedback` section appended to `.clancy/briefs/{date}-{slug}.md`
2. **Companion file** — check for `.clancy/briefs/{date}-{slug}.feedback.md`
3. **Board comments** (board-sourced only) — fetch ALL comments on the source ticket. Scan each comment body for the text `Clancy Strategic Brief` (case-insensitive, match anywhere in the body — it may appear as `# Clancy Strategic Brief`, `## Clancy Strategic Brief`, or just the text). The most recent matching comment is the brief. Collect all comments posted AFTER it as feedback.

Board comment feedback filtering per platform:
- **GitHub:** comments where `created_at` > brief comment's `created_at` AND `user.login` != resolved username (via `GET /user`)
- **Jira:** comments where created timestamp > brief comment timestamp AND `author.accountId` != brief comment's `author.accountId`
- **Linear:** all comments posted after the brief comment are treated as feedback (Linear personal keys don't easily expose viewer ID)

Merge order: local `## Feedback` section first, then `.feedback.md` file, then board comments (chronological). All passed to generation step as additional context.

### Edge cases

- **Board comment exists but local file is missing:** Re-download the brief from the board comment into `.clancy/briefs/`. Then check for feedback normally.
- **Local file exists but board comment was deleted:** Use local feedback only. No board feedback to read.
- **Multiple brief comments on same ticket:** Use the MOST RECENT (latest timestamp) as the reference point for feedback detection.

---

## Step 6 — Relevance check

Read `.clancy/docs/STACK.md` and `ARCHITECTURE.md` (if they exist). Compare the idea's domain against the codebase technology stack.

If the idea is clearly irrelevant (targets a platform or technology completely outside the codebase):
```
Skipping — this idea targets {platform}, but this codebase is {stack}.
```
Log: `YYYY-MM-DD HH:MM | BRIEF | {slug} | SKIPPED — not relevant ({reason})`
Stop.

If the idea mentions a technology not listed in STACK.md, flag it as a concern but do NOT skip — include a note in the brief's Technical Considerations section.

---

## Step 7 — Research (adaptive agents)

Assess complexity from the idea title + description:

| Complexity | Agents | Trigger |
|---|---|---|
| Narrow (single feature, few files) | 1 codebase agent | Simple scope |
| Moderate (multi-component, clear boundary) | 2 codebase agents | Medium scope |
| Broad (cross-cutting, multiple subsystems) | 3 codebase agents | Large scope |

Web research agent (adds 1 to the count above, max 4 total):
- `--research` flag → always add web agent
- Idea involves new/external technology → add web agent (judgement-based)
- Internal refactor → no web agent

### What agents explore

- `.clancy/docs/` — STACK.md, ARCHITECTURE.md, CONVENTIONS.md, TESTING.md, DESIGN-SYSTEM.md
- Affected code areas via Glob + Read
- Board for duplicates/related tickets (text-match against title):
  - **GitHub:** `GET /repos/$GITHUB_REPO/issues?state=open&per_page=30` and text-match
  - **Jira:** `POST /rest/api/3/search/jql` with `summary ~ "keywords"`
  - **Linear:** `issues(filter: ...)` by text search
- Existing children of the source ticket (board-sourced only):
  - **GitHub:** scan open issues for `Epic: #{parent}` in body
  - **Jira:** `POST /rest/api/3/search/jql` with `parent = {KEY}`
  - **Linear:** already included in the fetch response (`children.nodes`)
- Web research (if triggered)

Display per-agent progress:
```
Researching...
  Agent 1: Codebase structure ✅
  Agent 2: Testing patterns ✅
  Agent 3: Web research ✅ (3 sources)
```

---

## Step 8 — Generate brief

Using all gathered context (idea, grill output, research findings), generate the brief in this exact template:

```markdown
# Clancy Strategic Brief

**Source:** {source — see below}
**Date:** {YYYY-MM-DD}
**Status:** Draft

---

## Problem Statement
{2-4 sentences: what problem does this solve and why does it matter?}

## Goals
- {Specific, measurable goal}
- {Specific, measurable goal}

## Non-Goals
- {What is explicitly out of scope}
- {What is explicitly out of scope}

## Discovery
{Q&A pairs from the grill phase, each with source tag — see Step 4 output format}

## Background Research
{Findings from codebase exploration and web research. Include file paths, patterns found, and external references.}

## Related Existing Work
{Existing tickets, PRs, or code that overlaps with this idea. If the source ticket has children, list them here. "None found" if clean.}

## User Stories
- As a {persona}, I want to {action} so that {outcome}.
- As a {persona}, I want to {action} so that {outcome}.
- As a {persona}, I want to {action} so that {outcome}.

## Technical Considerations
- {Architectural decisions, patterns to follow, constraints}
- {Integration points, migration needs, backwards compatibility}
- {Performance, security, accessibility considerations}

## Ticket Decomposition

| # | Title | Description | Size | Deps | Mode |
|---|-------|-------------|------|------|------|
| 1 | {Vertical slice title} | {1-2 sentences} | S | — | AFK |
| 2 | {Vertical slice title} | {1-2 sentences} | M | #1 | AFK |
| 3 | {Vertical slice title} | {1-2 sentences} | M | #1 | HITL |

## Open Questions
- [ ] {Unresolved question from grill phase — with reason}
- [ ] {Unresolved question — needs PO input}

## Success Criteria
- [ ] {Specific, testable criterion for the entire initiative}
- [ ] {Specific, testable criterion}

## Risks
- {Specific risk and mitigation strategy}
- {Specific risk and mitigation strategy}

---
*Generated by [Clancy](https://github.com/Pushedskydiver/clancy). To answer open questions or request changes: comment on the source ticket or add a ## Feedback section to the brief file, then re-run `/clancy:brief` to revise. To approve: `/clancy:approve-brief`. To start over: `/clancy:brief --fresh`.*
```

### Source field format

- **Board ticket:** `[{KEY}] {Title}` (e.g. `[#50] Redesign settings page`, `[PROJ-200] Add customer portal`, `[ENG-42] Add real-time notifications`)
- **Inline text:** `"{text}"` (e.g. `"Add dark mode support"`)
- **From file:** `{path}` (e.g. `docs/rfcs/auth-rework.md`)

### Ticket Decomposition rules

1. **Max 10 tickets.** If the idea needs more, note "Consider splitting this initiative into multiple briefs."
2. **Vertical slices only.** Each ticket must cut through all layers needed to deliver one thin, working piece of functionality end-to-end. If a ticket title mentions only one layer (e.g. "Set up database schema", "Create React components"), restructure it into a slice that delivers observable behaviour.
3. **Dependencies** reference other tickets in the table by `#N` (e.g. `#1`, `#1, #3`). Use `—` for no dependencies.
4. **Size:** S (< 1 hour, few files), M (1-4 hours, moderate), L (4+ hours, significant).
5. **Mode:**
   - `AFK` — ticket can be implemented autonomously by `/clancy:once` or `/clancy:run`
   - `HITL` — ticket requires human judgement, approval, or input (design decisions, credentials, external service setup, UX review, ambiguous requirements)
6. Every ticket must trace to at least one user story.

### User Story rules

- Write 3-8 user stories per brief (more = scope too large)
- Each story must be testable (implies acceptance criteria)
- Use the format: `As a {persona}, I want to {action} so that {outcome}.`

### Re-brief revision

If revising from feedback (Step 5):

1. **Cross-reference feedback against Open Questions.** For each Open Question in the existing brief, check if the feedback contains an answer (exact or paraphrased — match by intent, not syntax). Resolved questions move to `## Discovery` with `(Source: human)` tag. Unresolved questions stay in `## Open Questions`.

2. **Apply all other feedback** — changes to scope, goals, decomposition, user stories, etc.

3. **Prepend a section** before Problem Statement:

```markdown
### Changes From Previous Brief
{What feedback was addressed and how the brief changed.
 List resolved open questions explicitly.}
```

---

## Step 9 — Save locally

Write to `.clancy/briefs/{YYYY-MM-DD}-{slug}.md`.

**Slug generation:**
- **Board ticket:** derive from title — lowercase, replace non-alphanumeric with hyphens, trim, truncate to 50 chars. E.g. `add-customer-portal`.
- **Inline text:** derive from the text — same rules.
- **From file:** derive from filename — strip extension, strip date prefix if present.

**Slug collision:** If file already exists, append `-2`, `-3`, etc.

**Create `.clancy/briefs/` directory** if it does not exist.

---

## Step 10 — Post to board

Only for board-sourced briefs (ticket key was provided). Inline text and file briefs are local only.

### GitHub — POST comment

```bash
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -X POST \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/comments" \
  -d '{"body": "<full brief markdown>"}'
```

GitHub accepts Markdown directly.

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

Construct ADF (Atlassian Document Format) JSON for the comment body:
- `## Heading` → `heading` node (level 2)
- `### Heading` → `heading` node (level 3)
- `- bullet` → `bulletList > listItem > paragraph`
- `| table |` → `table > tableRow > tableCell`
- `**bold**` → marks: `[{ "type": "strong" }]`
- `` `code` `` → marks: `[{ "type": "code" }]`

If ADF construction is too complex for a particular element, fall back to wrapping that section in a `codeBlock` node.

Comment marker heading: `## Clancy Strategic Brief` (H2 ADF heading node).

### Linear — commentCreate mutation

```bash
curl -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  "https://api.linear.app/graphql" \
  -d '{"query": "mutation { commentCreate(input: { issueId: \"$ISSUE_ID\", body: \"<full brief markdown>\" }) { success } }"}'
```

Linear accepts Markdown directly. Comment marker heading: `# Clancy Strategic Brief`.

Note: Linear personal API keys do NOT use `Bearer` prefix.

### On failure (any platform)

```
⚠️  Failed to post brief comment on {KEY}. Brief saved locally at .clancy/briefs/{file}. Paste it manually.
```

Continue — do not stop. The local file is the source of truth.

---

## Step 10a — Apply pipeline label (board-sourced only)

Only for board-sourced briefs (ticket key was provided). Inline text and file briefs skip this step.

**This step is mandatory for board-sourced briefs — always apply the label.** Use `CLANCY_LABEL_BRIEF` from `.clancy/.env` if set. If not set, use `clancy:brief` as the default. Ensure the label exists on the board (create it if missing), then add it to the ticket. Also read `CLANCY_LABEL_PLAN` (default: `clancy:plan`) and `CLANCY_LABEL_BUILD` (default: `clancy:build`) for cleanup during re-briefs.

### Re-brief cleanup (`--fresh` flag)

If this is a re-brief (`--fresh`), the ticket may already have `clancy:plan` or `clancy:build` from a prior approval. Remove them first (best-effort — ignore failures):

#### GitHub

```bash
# Remove plan label (ignore 404)
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -X DELETE \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/labels/$(echo $CLANCY_LABEL_PLAN | jq -Rr @uri)"

# Remove build label (ignore 404)
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -X DELETE \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/labels/$(echo $CLANCY_LABEL_BUILD | jq -Rr @uri)"
```

#### Jira

```bash
# Fetch current labels, remove plan + build labels, PUT updated list
CURRENT_LABELS=$(curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY?fields=labels" | jq -r '.fields.labels')

UPDATED_LABELS=$(echo "$CURRENT_LABELS" | jq --arg plan "$CLANCY_LABEL_PLAN" --arg build "$CLANCY_LABEL_BUILD" '[.[] | select(. != $plan and . != $build)]')

curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -X PUT \
  -H "Content-Type: application/json" \
  "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY" \
  -d "{\"fields\": {\"labels\": $UPDATED_LABELS}}"
```

#### Linear

```bash
# Fetch current label IDs, remove plan + build label IDs, update issue
# Query current labels on the issue
ISSUE_DATA=$(curl -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  "https://api.linear.app/graphql" \
  -d '{"query": "query { issues(filter: { identifier: { eq: \"$IDENTIFIER\" } }) { nodes { id labels { nodes { id name } } } } }"}')

# Filter out plan + build label IDs, then issueUpdate with remaining labelIds
```

### Add brief label

Ensure the label exists and add it to the ticket. Best-effort — warn on failure, never stop.

#### GitHub

```bash
# Ensure label exists (ignore 422 = already exists)
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  -X POST \
  "https://api.github.com/repos/$GITHUB_REPO/labels" \
  -d '{"name": "$CLANCY_LABEL_BRIEF", "color": "0075ca"}'

# Add label to issue
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  -X POST \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/labels" \
  -d '{"labels": ["$CLANCY_LABEL_BRIEF"]}'
```

#### Jira

```bash
# Jira auto-creates labels — just add to the issue's label array
CURRENT_LABELS=$(curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY?fields=labels" | jq -r '.fields.labels')

UPDATED_LABELS=$(echo "$CURRENT_LABELS" | jq --arg brief "$CLANCY_LABEL_BRIEF" '. + [$brief] | unique')

curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -X PUT \
  -H "Content-Type: application/json" \
  "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_KEY" \
  -d "{\"fields\": {\"labels\": $UPDATED_LABELS}}"
```

#### Linear

```bash
# Ensure label exists (check team labels, workspace labels, create if missing)
# Then add to issue via issueUpdate with updated labelIds array
curl -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  "https://api.linear.app/graphql" \
  -d '{"query": "mutation { issueLabelCreate(input: { teamId: \"$LINEAR_TEAM_ID\", name: \"$CLANCY_LABEL_BRIEF\", color: \"#0075ca\" }) { success issueLabel { id } } }"}'

# Add label to issue (fetch current labelIds, append new, issueUpdate)
```

#### On failure (any platform)

```
⚠️  Could not add pipeline label to {KEY}. The brief was saved and posted successfully — label it manually if needed.
```

Continue — do not stop.

---

## Step 11 — Brief inventory (`--list`)

If `--list` flag is present, display an inventory of all briefs and stop.

Scan `.clancy/briefs/` for all `.md` files. For each file:
- Parse date from filename prefix (`YYYY-MM-DD-slug.md`)
- Parse `**Source:**` line
- Parse Status (check for `.approved` marker file)
- Parse ticket count from decomposition table (`?` if unparseable)
- Calculate age (today - date)
- Check stale: unapproved + age > 7 days

Sort by date (newest first). Display:

```
Clancy — Briefs
================================================================

  [1] dark-mode-support        2026-03-14  Draft     3 tickets  Source: #50
  [2] customer-portal          2026-03-13  Approved  8 tickets  Source: PROJ-200  ✅
  [3] real-time-notifications  2026-03-12  Draft     4 tickets  Source: ENG-42
  [4] auth-rework              2026-03-05  Draft     6 tickets  Source: file      STALE (9 days)

3 unapproved drafts. 1 stale (>7 days).

To approve: /clancy:approve-brief <slug or index>
To review stale briefs: open the file and add ## Feedback, or delete it.
```

If `.clancy/briefs/` does not exist or is empty:
```
No briefs found. Run /clancy:brief to create one.
```

Stop.

---

## Step 12 — Display

Print the full brief to stdout, followed by the sign-off:

```
"I'm going to need to ask you some questions, and I want them answered immediately."
```

### Next steps (board-sourced)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next Steps
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Answer open questions or request changes:
    • Comment on {KEY} on your board
    • Or add a ## Feedback section to the brief file
    Then re-run: /clancy:brief {KEY}

  Approve:       /clancy:approve-brief {KEY}
  Start over:    /clancy:brief --fresh {KEY}
```

### Next steps (inline text / from file)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next Steps
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Answer open questions or request changes:
    • Add a ## Feedback section to:
        .clancy/briefs/{date}-{slug}.md
    • Or create a companion file:
        .clancy/briefs/{date}-{slug}.feedback.md
    Then re-run: /clancy:brief

  Approve:       /clancy:approve-brief {slug}
  With parent:   /clancy:approve-brief {slug} --epic {KEY}
  Start over:    /clancy:brief --fresh
```

---

## Step 13 — Log

Append to `.clancy/progress.txt`:

| Outcome | Log entry |
|---|---|
| Brief generated | `YYYY-MM-DD HH:MM \| BRIEF \| {slug} \| {N} proposed tickets` |
| Brief revised (from feedback) | `YYYY-MM-DD HH:MM \| BRIEF \| {slug} \| REVISED - {N} proposed tickets` |
| Brief skipped (not relevant) | `YYYY-MM-DD HH:MM \| BRIEF \| {slug} \| SKIPPED - not relevant ({reason})` |
| Brief skipped (ticket Done) | `YYYY-MM-DD HH:MM \| BRIEF \| {slug} \| SKIPPED - ticket is Done` |
| Brief skipped (not found) | `YYYY-MM-DD HH:MM \| BRIEF \| {slug} \| SKIPPED - ticket not found` |
| Already briefed (no feedback) | (nothing logged) |
| `--list` display | (nothing logged) |
| Auth/network failure | (nothing logged) |

---

## Step 14 — Batch summary

After all tickets in a batch are processed, display:

```
Briefed {M} of {N} tickets. {K} skipped.

  ✅ [{KEY1}] {Title} — 4 tickets proposed
  ✅ [{KEY2}] {Title} — 6 tickets proposed
  ⏭️  [{KEY3}] {Title} — already briefed
  ⏭️  [{KEY4}] {Title} — not relevant

Briefs saved to .clancy/briefs/. Run /clancy:approve-brief to create tickets.
```

---

## Notes

- This command does NOT create tickets — it generates briefs only. Ticket creation is `/clancy:approve-brief`.
- Briefs are saved locally in `.clancy/briefs/` and optionally posted as comments on the source ticket.
- The grill phase is the most important part — do not skip or rush it. Zero ambiguity is the goal.
- Re-running without `--fresh` auto-detects feedback: if feedback exists, revises; if no feedback, stops with guidance.
- The `--fresh` flag discards the existing brief entirely and generates a new one from scratch.
- The `--list` flag is an inventory display only — no brief generated, no API calls beyond the local filesystem.
- Batch mode (`/clancy:brief 3`) implies AI-grill — each ticket is briefed autonomously.
- All board API calls are best-effort — if a comment fails to post, print the brief and warn. The local file is the source of truth.
- The `Clancy Strategic Brief` text in comments is the marker used by both `/clancy:brief` (to detect existing briefs and feedback) and `/clancy:approve-brief` (to find the brief). Search case-insensitively and match regardless of heading level (`#`, `##`, or plain text).
- Jira uses ADF for comments (with `codeBlock` fallback). GitHub and Linear accept Markdown directly.
- Linear personal API keys do NOT use `Bearer` prefix.
- Jira uses the new `POST /rest/api/3/search/jql` endpoint (old GET `/search` removed Aug 2025).
