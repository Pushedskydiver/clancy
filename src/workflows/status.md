# Clancy Status Workflow

## Overview

Read-only board check. Fetches the next 3 tickets Clancy would pick up and displays them. No side effects whatsoever — no git operations, no file writes, no ticket claiming.

---

## Step 1 — Preflight checks

1. Check `.clancy/` exists and `.clancy/.env` is present.
2. Source `.clancy/.env` and check board credentials are present.
3. On any missing config, show a specific error and stop:
   ```
   Missing config. Run /clancy:init to set up Clancy.
   ```

---

## Step 2 — Detect board and fetch tickets

Detect board from `.clancy/.env`:

**Jira:**

Build the JQL string first. If `CLANCY_JQL_SPRINT` is set in `.clancy/.env`, include the sprint clause:
- Sprint clause present: `project=$JIRA_PROJECT_KEY AND sprint in openSprints() AND assignee=currentUser() AND status="$CLANCY_JQL_STATUS" ORDER BY priority ASC`
- Sprint clause absent: `project=$JIRA_PROJECT_KEY AND assignee=currentUser() AND status="$CLANCY_JQL_STATUS" ORDER BY priority ASC`

Where `CLANCY_JQL_STATUS` defaults to `To Do` if not set.

```bash
RESPONSE=$(curl -s \
  -u "$JIRA_USER:$JIRA_API_TOKEN" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/3/search/jql" \
  -d '{"jql": "<jql as above>", "maxResults": 3, "fields": ["summary", "parent", "customfield_10014", "status"]}')
```

**GitHub Issues:**
```bash
RESPONSE=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/issues?state=open&assignee=@me&labels=clancy&per_page=3")
# Filter out PRs (entries with pull_request key)
```

**Linear:**
```graphql
query {
  viewer {
    assignedIssues(
      filter: { state: { type: { eq: "unstarted" } }, team: { id: { eq: "$LINEAR_TEAM_ID" } } }
      first: 3
      orderBy: priority
    ) {
      nodes { id identifier title parent { identifier title } }
    }
  }
}
```

---

## Step 3 — Display

If tickets found, display:
```
Next up for Clancy:

1. [{TICKET-KEY}] {Summary}
   Epic: {epic key} — {epic title}
   Status: {status}

2. [{TICKET-KEY}] {Summary}
   Epic: {epic key} — {epic title}
   Status: {status}

3. [{TICKET-KEY}] {Summary}
   Epic: {epic key} — {epic title}
   Status: {status}

Run /clancy:once to pick up the first ticket.
Run /clancy:run to process all tickets in the queue.
```

If no tickets found:
```
No tickets found in the current queue. Check your board or run /clancy:init
to verify your configuration.
```

If API call fails, show the error clearly:
```
Board API error: {error message}

Tips:
- Check your credentials in .clancy/.env
- For Jira: ensure you have VPN access if required
- Run /clancy:init to reconfigure
```

---

## Notes

- Show up to 3 tickets. If only 1 or 2 are available, show those.
- Omit "Epic:" line if no epic/parent data is present for that ticket.
- This command is strictly read-only. No git ops, no file writes, no Claude invocation for analysis.
- The query used here must be identical to the one used by `clancy-once.sh` — what status shows is exactly what run would pick up.
