import os
import httpx

APIFY_BASE = "https://api.apify.com/v2"
ACTOR_ID = "apify~instagram-comment-scraper"


def _headers():
    token = os.getenv("APIFY_API_TOKEN", "")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


async def start_run(post_urls: list[str], max_comments: int = 500,
                    include_replies: bool = False) -> dict:
    payload = {"directUrls": post_urls, "maxComments": max_comments}
    if include_replies:
        payload["includeReplies"] = True
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{APIFY_BASE}/acts/{ACTOR_ID}/runs",
            headers=_headers(),
            json=payload,
        )
        r.raise_for_status()
        return r.json()


async def get_run_status(run_id: str) -> dict:
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(
            f"{APIFY_BASE}/actor-runs/{run_id}",
            headers=_headers(),
            params={"waitForFinish": 30},
        )
        r.raise_for_status()
        return r.json()


async def get_dataset_items(dataset_id: str, limit: int = 1000, offset: int = 0) -> list:
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(
            f"{APIFY_BASE}/datasets/{dataset_id}/items",
            headers=_headers(),
            params={"limit": limit, "offset": offset, "clean": True},
        )
        r.raise_for_status()
        return r.json()
