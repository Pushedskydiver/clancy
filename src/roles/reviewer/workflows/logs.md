# Clancy Logs Workflow

## Overview

Read `.clancy/progress.txt` and present a formatted summary.

---

## Step 1 — Check file exists

If `.clancy/progress.txt` does not exist:
```
🚨 Clancy — Logs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No progress logged yet.

"The law is powerless to help you... but not for long." — Run /clancy:once or /clancy:run to get started.
```
Stop.

---

## Step 2 — Parse progress.txt

Each line has one of these formats:
- `YYYY-MM-DD HH:MM | TICKET-KEY | Summary | DONE` — completed implementation
- `YYYY-MM-DD HH:MM | TICKET-KEY | REVIEW | {score}%` — ticket review
- `YYYY-MM-DD HH:MM | TICKET-KEY | PLAN | {S/M/L}` — plan generated
- `YYYY-MM-DD HH:MM | TICKET-KEY | REVISED | {S/M/L}` — plan revised after feedback
- `YYYY-MM-DD HH:MM | TICKET-KEY | APPROVE_PLAN | —` — plan promoted to description
- `YYYY-MM-DD HH:MM | TICKET-KEY | SKIPPED | {reason}` — ticket skipped
- `YYYY-MM-DD HH:MM | TICKET-KEY | POST_FAILED | {reason}` — failed to post comment to board
- `YYYY-MM-DD HH:MM | BRIEF | {slug} | {N} proposed tickets` — brief generated (slug-based format)
- `YYYY-MM-DD HH:MM | APPROVE_BRIEF | {slug} | {N} tickets created` — brief approved (slug-based format)

Parse each line:
- Date (YYYY-MM-DD)
- Time (HH:MM)
- Key or status (BRIEF/APPROVE_BRIEF entries put the status here, standard entries put the ticket key)
- Detail (status, score, size, reason, or slug for brief entries)

Extract:
- Total DONE tickets
- First and latest run dates
- All DONE tickets from the current calendar week (Mon–Sun)
- Counts for each action type: PLAN, REVISED, APPROVE_PLAN, REVIEW, SKIPPED, POST_FAILED, BRIEF, APPROVE_BRIEF
- Epic key from ticket key — e.g. PROJ-42 → epic likely PROJ-10 (use parent field if logged, otherwise group by project prefix)

---

## Step 3 — Display

If only 1–3 DONE entries: show a flat list, skip grouping.

If 4+ entries, show the full grouped display:

```
🚨 Clancy — Logs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total tickets completed: {count}
First run: {YYYY-MM-DD}
Latest run: {YYYY-MM-DD}

This week ({Mon date}–{Sun date or today}):
  ✅ {TICKET-KEY}  {Summary}
  ✅ {TICKET-KEY}  {Summary}
  ...

By epic:
  {EPIC-KEY} {Epic name or prefix}  {bar}  {count} tickets
  {EPIC-KEY} {Epic name or prefix}  {bar}  {count} tickets
  (other)                           {bar}  {count} tickets

Plans generated: {N}      (only show if > 0)
Plans revised: {N}        (only show if > 0)
Plans approved: {N}       (only show if > 0)
Briefs generated: {N}     (only show if > 0)
Briefs approved: {N}      (only show if > 0)
Reviews run: {N}          (only show if > 0)
Tickets skipped: {N}      (only show if > 0)
Post failures: {N}        (only show if > 0)
Full log: .clancy/progress.txt

"The law is powerless to help you, but here's what Clancy's done."
```

### Display rules

- Show "this week" at the top — most recent activity is most relevant
- Cap "this week" at 10 entries. If more: "...and {n} more this week"
- Progress bars: ASCII, proportional to highest count, width 10 chars, `█` filled, `░` empty
- Epic grouping: group by epic key in the ticket's parent field (from progress.txt if logged), or by project prefix if not available
- Tickets without an epic: group under `(other)`
- REVIEW, PLAN, REVISED, APPROVE_PLAN, BRIEF, APPROVE_BRIEF, SKIPPED, and POST_FAILED lines: shown separately at the end as counts — not included in ticket count

---

## Notes

- No external dependencies — all ASCII, all bash-parseable
- The full log is always available at `.clancy/progress.txt` for raw access
- `--all` flag to remove the "this week" cap is a v2 addition — do not implement in v1
