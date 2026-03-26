# Workflow: Stage 5 — Review Leads & Manage Outreach

## Objective
Browse scored leads, edit DM drafts before sending, and track outreach status through the lead lifecycle.

## Required Inputs
- Scored leads in the `leads` table (from Stage 4)

## Tools Used
- `tools/database.py` — `get_leads()`, `update_lead()`

## Lead Status Flow
```
new → contacted → responded → not_relevant
```

## Steps

1. **Browse leads** in the Leads tab.
   - Filter by score (1/2/3), status, or source post URL
   - Hot leads (score 3) bubble to top

2. **Edit DM draft**: Click edit on any lead card to refine Claude's draft before sending.
   - PATCH `/api/leads/{id}` with `{"dm_draft": "..."}` saves the updated draft.

3. **Update status**: After sending a DM or receiving a reply, update the lead's status.
   - PATCH `/api/leads/{id}` with `{"status": "contacted"}` (or `responded`, `not_relevant`)

## Expected Outputs
- Outreach tracked in the DB; status reflects real-world contact state

## Edge Cases
- **Duplicate leads**: If you scrape the same post twice (re-queued), duplicate comments are blocked by the upsert dedup check (username + post_url + comment_text). But if comment_text is slightly different between scrapes (rare), you could get near-duplicates. Filter by source_post_url to spot them.
- **Score 1 leads**: These are still visible but should generally be ignored. No DM draft is generated for them.
- **Lead privacy**: Instagram handles and profile URLs are stored in SQLite. Treat this as sensitive data — don't export or share the DB.
