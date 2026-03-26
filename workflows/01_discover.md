# Workflow: Stage 1 — Discover (Virlo Orbit)

## Objective
Use Virlo Orbit to find Instagram posts related to body pain, movement restriction, and somatic struggle. These posts are the source of potential leads in Stage 3.

## Required Inputs
- `keywords`: list of search terms (e.g. "chronic pain", "tight hips", "body tension") — max 10
- `time_period`: one of `this_week`, `this_month`, `this_year` (default: `this_month`)
- `name` (optional): human-readable label for the search job

## Tools Used
- `tools/virlo.py` — `start_orbit()`, `get_orbit_status()`, `get_orbit_videos()`
- `tools/database.py` — `upsert_orbit_job()`, `upsert_post()`, `get_posts_by_orbit()`

## Steps

1. **Start the search**: POST `/api/virlo/orbit` with keywords and time_period.
   - Virlo returns an `orbit_id` immediately; the search runs async on their end.
   - DB records the job as `running`.

2. **Poll for completion**: GET `/api/virlo/orbit/{orbit_id}` — frontend polls this every ~5s.
   - Virlo status `completed` → fetch videos and upsert to `posts` table.
   - Virlo status `failed` → mark job failed in DB.
   - If still `processing` after 90 minutes → auto-mark failed (timeout guard).

3. **Review results**: Posts appear in the Discover tab, sorted by view count descending.

## Expected Outputs
- Rows in `posts` table with `virlo_run_ref = orbit_id`
- Fields: `post_url`, `creator_handle`, `view_count`, `like_count`, `comment_count`

## Edge Cases
- **Duplicate job**: Server checks for existing job with same keywords before starting. Frontend shows a "duplicate" warning with option to force-run.
- **Rate limits**: Virlo has no documented rate limit, but avoid hammering the same keywords repeatedly. Space searches by time period.
- **Virlo field variations**: Response shape varies slightly — `server.py` normalizes `post_url`, `creator_handle`, `view_count` etc. from multiple possible field names.
- **No videos returned**: Some keyword sets return 0 posts. Try broader synonyms or a wider time period.
