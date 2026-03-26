# Workflow: Stage 2 — Queue Posts for Scraping

## Objective
Manually select which discovered posts to scrape comments from. High-engagement posts from creators whose audience shares personal struggles are the best targets.

## Required Inputs
- Completed Orbit job from Stage 1 (posts visible in Discover tab)

## Tools Used
- `tools/database.py` — `set_post_queued()`, `get_queued_posts()`

## Steps

1. In the **Queue tab**, review posts from a completed Orbit search.
2. Click "Add to Queue" on posts worth scraping. Prioritize:
   - High comment counts (more comments = more potential leads)
   - Creators whose content aligns with somatic / body pain themes
   - Posts with authentic, personal engagement (not just hype)
3. Posts added to queue appear in the scrape queue, ready for Stage 3.
4. Click "Remove" to dequeue a post before scraping starts.

## Expected Outputs
- `posts.in_queue = 1` for selected posts
- Queue visible via GET `/api/queue`

## Edge Cases
- **Already scraped posts**: A post that's already been scraped (`scrape_status = 'done'`) can still be re-queued if you want fresher comments, but this will create duplicate leads — check before queuing.
- **Queue size**: No hard limit, but large queues mean longer scrape times and higher Apify costs. 5–15 posts is a reasonable batch.
