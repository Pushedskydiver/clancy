# Clancy Review Workflow

## Overview

Fetch the next ticket from the board and score how well-specified it is. Returns a confidence score (0–100%) and actionable recommendations. Does not implement anything.

---

## Step 1 — Preflight checks

1. Check `.clancy/` exists and `.clancy/.env` is present. If not:
   ```
   .clancy/ not found. Run /clancy:init to set up Clancy first.
   ```
   Stop.

2. Source `.clancy/.env` and check board credentials are present (same vars checked by `/clancy:status`).

---

## Step 2 — Fetch next ticket

Detect board from `.clancy/.env` and fetch with `maxResults=1`. The query must match the once-runner exactly — what review shows is what run would pick up.

**Jira:** Build JQL using the same clauses as the once-runner:
- Sprint clause: include `AND sprint in openSprints()` if `CLANCY_JQL_SPRINT` is set
- Label clause: include `AND labels = "$CLANCY_LABEL"` if `CLANCY_LABEL` is set
- `CLANCY_JQL_STATUS` defaults to `To Do` if not set

Full JQL: `project=$JIRA_PROJECT_KEY [AND sprint in openSprints()] [AND labels = "$CLANCY_LABEL"] AND assignee=currentUser() AND status="$CLANCY_JQL_STATUS" ORDER BY priority ASC`

Use the POST `/rest/api/3/search/jql` endpoint (the old GET `/rest/api/3/search` was removed Aug 2025):

```bash
RESPONSE=$(curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/search/jql" \
  -d '{"jql": "<jql as above>", "maxResults": 1, "fields": ["summary", "description", "issuelinks", "parent", "customfield_10014"]}')
```

**GitHub Issues:** `GET /repos/$GITHUB_REPO/issues?state=open&assignee=@me&labels=clancy&per_page=1` — filter out PRs (entries with `pull_request` key)

**Linear:** GraphQL `viewer.assignedIssues` with `filter: { state: { type: { eq: "unstarted" } }, team: { id: { eq: "$LINEAR_TEAM_ID" } }[, labels: { name: { eq: "$CLANCY_LABEL" } }] }` (label clause only if `CLANCY_LABEL` is set), `first: 1`, `orderBy: priority`

Fetch full ticket content: summary, description (full text), acceptance criteria (if present), epic/parent info, blockers/issue links.

If no tickets found:
```
🚨 Clancy — Review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No tickets in the queue. Nothing to review.

"Quiet. Too quiet." — Check your board or run /clancy:status.
```
Stop.

---

## Step 3 — Score against 7 criteria

Score each criterion as pass / warn / fail using the rubric below. Compute weighted confidence score.

### Scoring rubric

| # | Criterion | Weight | Pass | Warn | Fail |
|---|---|---|---|---|---|
| 1 | Summary clarity | 10% | Specific, scopeable | Vague but workable | Too broad or meaningless |
| 2 | Description quality | 15% | Explains what + why | What only, no why | Missing or one-liner |
| 3 | Acceptance criteria | 25% | Concrete + testable | Present but vague | Missing entirely |
| 4 | Figma URL (UI tickets only) | 15% | URL present in description | — | UI ticket, no Figma URL |
| 5 | Scope realism | 15% | Single focused deliverable | Multiple deliverables or borderline | Too large, "and also" tasks, or spans unrelated systems |
| 6 | Dependencies stated | 5% | Blockers explicit | — | No mention of dependencies |
| 7 | Clancy executability | 15% | Purely codebase work | Mostly codebase, minor external touch | Requires work outside the codebase |

**Criterion 7 — Clancy executability:** Score as Fail if the ticket primarily requires any of the following — Clancy cannot do these from within the codebase:
- **External system admin:** "in Google Analytics", "in Salesforce", "in HubSpot", "in the AWS console", "in Jira admin", "in the app store dashboard"
- **Human process steps:** "get sign-off from", "send an email to customers", "coordinate with", "schedule a meeting", "announce to users"
- **Production ops (non-repo):** "deploy to production", "rotate the API keys in prod", "scale the fleet", "restart the service" — unless the ticket is purely about CI/CD config files that live in the repo
- **Non-code deliverables:** "write a runbook", "update the wiki", "create a presentation", "document in Confluence"

Score as Warn if the ticket is mostly codebase work but has an incidental external touch (e.g. "add a new event to the existing analytics tracking" — the code change is in the repo, even if the event appears in a dashboard).

**Tech stack coherence (part of criterion 7):** If `.clancy/docs/STACK.md` exists, read it and check the ticket against the documented stack. If the ticket mentions a technology or platform not in the documented stack that appears to be an external service (not a new dependency to install), score criterion 7 as Warn and note the mismatch explicitly.

**Figma criterion:** Only applies if the ticket description mentions UI, components, screens, design, or visual elements. Backend/API/config tickets skip criterion 4 and redistribute its 15% weight proportionally across the remaining criteria.

**Figma URL quality checks:**
- URL present but points to file root (no `node-id`) → warn: recommend scoping to specific frame
- `FIGMA_API_KEY` not configured but UI ticket has Figma URL → warn: link will be ignored at runtime

**Scope realism — additional Fail signals:**
- Ticket contains multiple distinct deliverables ("and also", "additionally", "while you're at it", "as well as")
- Ticket implies setting up new infrastructure from scratch where none exists in the repo (new database, new service, new deployment pipeline)
- Ticket references 4+ unrelated subsystems that would each require deep separate context

**Score calculation:**
- Pass = full weight
- Warn = half weight
- Fail = zero weight
- Sum all weighted scores → overall percentage

**Hard gate — executability override:** If criterion 7 scores Fail, cap the verdict at "Needs work" regardless of the calculated score. A ticket that requires work outside the codebase cannot be run reliably no matter how well it is specified.

---

## Step 4 — Generate recommendations

For each warn or fail criterion, generate a specific, actionable recommendation — specific to this ticket, not generic advice.

Good: "Add a Figma URL to the ticket description — this ticket mentions updating the profile header component"
Bad: "Ensure design specs are provided"

---

## Step 5 — Display output

```
🚨 Clancy — Review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[{TICKET-KEY}] {Summary}

Confidence: {score}% — {badge} {band label}

{for each criterion:}
✅ {criterion name} — {pass reason}
⚠️ {criterion name} — {warn reason}
   → {specific recommendation}
❌ {criterion name} — {fail reason}
   → {specific recommendation}

{verdict line}

{sign-off quote}
```

### Confidence bands

| Score | Badge | Label | Verdict action |
|---|---|---|---|
| 85–100% | 🟢 | Ready | "Run with confidence." |
| 65–84% | 🟡 | Good to go with caveats | "Review the warnings above, then run /clancy:once." |
| 40–64% | 🟠 | Needs work | "Address the ❌ items in the ticket, then re-run /clancy:review." |
| 0–39% | 🔴 | Not ready | "This ticket needs significant rework before Clancy can implement it reliably." |

**Executability override:** If criterion 7 (Clancy executability) scores Fail, ignore the calculated band and show:
```
🔴 Verdict: Not ready for Clancy
   This ticket requires work outside the codebase — Clancy can only implement code changes.
   Update the ticket to focus on the codebase side, or remove it from the queue.

   "This is Papa Bear. Put out an APB for a better ticket spec."
```

### Sign-off quotes per band

Append a Wiggum-themed quote after the verdict to add personality. Never suggest bypassing the review on low-confidence tickets:

- **🟢 Ready:** `"Bake 'em away, toys." — Run /clancy:once to pick it up.`
- **🟡 Good to go:** `"I'd rather let Herman go. I don't think we've got enough to nail him." — Fix the warnings, then run /clancy:once.`
- **🟠 Needs work:** `"Uh, no. You got the wrong number. This is 9-1... 2." — Update the ticket, then re-run /clancy:review.`
- **🔴 Not ready:** `"This is Papa Bear. Put out an APB for a better ticket spec." — Rework the ticket first.`

---

## Step 6 — Log the review

Append to `.clancy/progress.txt`:
```
YYYY-MM-DD HH:MM | {TICKET-KEY} | REVIEW | {score}%
```

---

## Notes

- Recommendations are specific to this ticket — never generic
- The verdict always suggests a next step — never leaves the user without a clear action
- Re-running `/clancy:review` multiple times is safe — the score may improve as the ticket is updated
- Do not implement anything — Claude is invoked for analysis only
