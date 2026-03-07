# Clancy Review Workflow

## Overview

Fetch the next ticket from the board and score how well-specified it is. Returns a confidence score (0–100%) and actionable recommendations. Does not implement anything.

---

## Step 1 — Preflight checks

Same as status workflow. Check `.clancy/`, `.env`, and board credentials.

---

## Step 2 — Fetch next ticket

Use the same query as `clancy-once.sh` for the detected board, `maxResults=1`.

Fetch full ticket content: summary, description (full text), acceptance criteria (if present), epic/parent info, blockers/issue links.

If no tickets found:
```
No tickets in the queue. Nothing to review.
```
Stop.

---

## Step 3 — Score against 7 criteria

Score each criterion as pass / warn / fail using the rubric below. Compute weighted confidence score.

### Scoring rubric

| # | Criterion | Weight | Pass | Warn | Fail |
|---|---|---|---|---|---|
| 1 | Summary clarity | 10% | Specific, scopeable | Vague but workable | Too broad or meaningless |
| 2 | Description quality | 20% | Explains what + why | What only, no why | Missing or one-liner |
| 3 | Acceptance criteria | 25% | Concrete + testable | Present but vague | Missing entirely |
| 4 | Figma URL (UI tickets only) | 20% | URL present in description | — | UI ticket, no Figma URL |
| 5 | Scope realism | 15% | One Claude session | Borderline | Too large for one session |
| 6 | Dependencies stated | 5% | Blockers explicit | — | No mention of dependencies |
| 7 | Red flag check | 5% | None found | Minor vagueness | "Refactor", "improve", unbounded scope |

**Figma criterion:** Only applies if the ticket description mentions UI, components, screens, design, or visual elements. Backend/API/config tickets skip criterion 4 and redistribute its 20% weight proportionally across the remaining criteria.

**Figma URL quality checks:**
- URL present but points to file root (no `node-id`) → warn: recommend scoping to specific frame
- `FIGMA_API_KEY` not configured but UI ticket has Figma URL → warn: link will be ignored at runtime

**Score calculation:**
- Pass = full weight
- Warn = half weight
- Fail = zero weight
- Sum all weighted scores → overall percentage

---

## Step 4 — Generate recommendations

For each warn or fail criterion, generate a specific, actionable recommendation — specific to this ticket, not generic advice.

Good: "Add a Figma URL to the ticket description — this ticket mentions updating the profile header component"
Bad: "Ensure design specs are provided"

---

## Step 5 — Display output

```
Reviewing: [{TICKET-KEY}] {Summary}

Confidence: {score}% — {band label}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{for each criterion:}
✓ {criterion name} — {pass reason}
⚠ {criterion name} — {warn reason}
  → {specific recommendation}
✗ {criterion name} — {fail reason}
  → {specific recommendation}

Verdict: {action based on band}
         {next step options}
```

### Confidence bands

| Score | Label | Verdict action |
|---|---|---|
| 85–100% | Ready | "Run with confidence." |
| 65–84% | Good to go with caveats | "Review the warnings, run if comfortable." |
| 40–64% | Needs work | "Address the ✗ items before running." |
| 0–39% | Not ready | "Ticket needs significant improvement." |

Always end with next-step options:
```
Run /clancy:once when ready, or /clancy:run to proceed anyway.
```

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
