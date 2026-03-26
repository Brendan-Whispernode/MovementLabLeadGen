# Workflow: Stage 3 — Scrape Comments (Apify)

## Objective
Run Apify's Instagram comment scraper on all queued posts to collect commenter usernames, comment text, and timestamps. These become the raw leads in Stage 4.

## Required Inputs
- At least one post in the queue (from Stage 2)

## Tools Used
- `tools/apify.py` — `start_run()`, `get_run_status()`, `get_dataset_items()`
- `tools/database.py` — `upsert_lead()`, `set_post_scrape_status()`

## Steps

1. **Start scrape**: POST `/api/scrape/run`
   - Pulls all queued posts, submits their URLs to Apify actor `apify~instagram-comment-scraper`
   - Max 500 comments per post
   - Returns `run_id` immediately; background task `_poll_scrape()` begins polling

2. **Background polling**: Every 10 seconds, checks Apify run status.
   - `SUCCEEDED` → fetch dataset items → ingest comments to `leads` table
   - `FAILED / ABORTED / TIMED-OUT` → mark posts as `error`

3. **Comment ingestion**: Each comment becomes a lead row:
   - `commenter_username`, `comment_text`, `comment_timestamp`, `source_post_url`
   - Deduplication: same username + post_url + comment_text is skipped

4. **Poll from frontend**: GET `/api/scrape/status` — frontend polls to show live status.

## Expected Outputs
- Rows in `leads` table with `score IS NULL` (unscored)
- Posts updated to `scrape_status = 'done'`

## Edge Cases
- **Apify rate limits**: Each actor run costs credits. Check Apify dashboard before re-running the same posts. The `apify_run_ref` on each lead tracks which run produced it.
- **Large post comment counts**: Apify caps at 500 comments/post. For viral posts, this is intentional — scraping all 10k+ comments isn't worth the cost or scoring time.
- **Post URL mismatch**: Apify's response items may not always return the exact `postUrl` used as input. The ingestion logic falls back to the first queued URL if no match found.
- **Only one scrape at a time**: `_scrape_state["running"]` is an in-memory lock. If server restarts mid-scrape, the lock clears but the Apify run continues in the cloud — check Apify dashboard to recover results manually.

## Known Apify Field Mapping
| Apify field | Our field |
|---|---|
| `ownerUsername` or `username` | `commenter_username` |
| `text` or `commentText` | `comment_text` |
| `timestamp` or `createdAt` | `comment_timestamp` |
| `postUrl` or `post_url` | `source_post_url` |
