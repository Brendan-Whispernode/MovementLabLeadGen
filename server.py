import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

import tools.analyst as analyst
import tools.apify as apify
import tools.database as db
import tools.scorer as scorer
import tools.virlo as virlo

# ── in-memory scrape state ────────────────────────────────────────────────────
_scrape_state: dict = {
    "running": False,
    "run_id": None,
    "dataset_id": None,
    "status": "idle",
    "post_statuses": {},
    "error": None,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(lifespan=lifespan)


# ── helpers ───────────────────────────────────────────────────────────────────

def _ok(data=None, **kwargs):
    payload = kwargs if data is None else data
    return JSONResponse(content=payload)


# ════════════════════════════════════════════════════════════════════════════
# Stage 1 — Discover (Virlo)
# ════════════════════════════════════════════════════════════════════════════

class OrbitRequest(BaseModel):
    keywords: list[str]
    name: str = ""
    time_period: str = "30d"
    force: bool = False


@app.post("/api/virlo/orbit")
async def start_orbit(req: OrbitRequest):
    keywords = [k for k in req.keywords if k.strip()][:10]  # Virlo max 10

    # Map legacy period values just in case
    period_map = {"7d": "this_week", "30d": "this_month", "90d": "this_year"}
    time_period = period_map.get(req.time_period, req.time_period)

    if not req.force:
        existing = db.find_duplicate_orbit_job(keywords)
        if existing:
            return _ok(
                duplicate=True,
                existing_orbit_id=existing["orbit_id"],
                existing_name=existing["name"] or existing["orbit_id"],
                existing_status=existing["status"],
            )

    name = req.name or ", ".join(keywords[:3])
    try:
        result = await virlo.start_orbit(keywords, name, time_period)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)

    payload = result.get("data") or result
    orbit_id = payload.get("orbit_id") or payload.get("id") or payload.get("orbitId")
    if not orbit_id:
        raise HTTPException(status_code=502, detail=f"Unexpected Virlo response: {result}")

    db.upsert_orbit_job(orbit_id, name, json.dumps(keywords), "running")
    return _ok(orbit_id=orbit_id, status="running")


@app.get("/api/virlo/orbit/{orbit_id}")
async def poll_orbit(orbit_id: str):
    try:
        status_data = await virlo.get_orbit_status(orbit_id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)

    inner = status_data.get("data") or status_data
    raw_status = inner.get("status", "processing")
    # Map Virlo statuses to our internal ones
    if raw_status == "completed":
        status = "completed"
    elif raw_status == "failed":
        status = "failed"
    else:
        # Timeout: if still processing after 90 minutes, mark failed
        existing = db.get_orbit_job(orbit_id)
        if existing and existing.get("created_at"):
            try:
                created = datetime.fromisoformat(existing["created_at"]).replace(tzinfo=timezone.utc)
                age = datetime.now(timezone.utc) - created
                status = "failed" if age > timedelta(minutes=90) else "running"
            except Exception:
                status = "running"
        else:
            status = "running"
    db.upsert_orbit_job(
        orbit_id,
        inner.get("name", ""),
        json.dumps(inner.get("keywords", [])),
        status,
    )

    posts = []
    if status == "completed":
        try:
            # Videos are already in the status response at data.results.videos
            results = inner.get("results") or {}
            videos = results.get("videos") or []
            for v in videos:
                post_url = v.get("post_url") or v.get("url") or v.get("postUrl", "")
                handle = (v.get("creator_handle") or v.get("handle") or v.get("username")
                          or (v.get("author") or {}).get("username", ""))
                view_count = v.get("view_count") or v.get("views") or v.get("viewCount", 0)
                like_count = v.get("like_count") or v.get("likes") or v.get("likeCount", 0)
                comment_count = v.get("comment_count") or v.get("comments") or v.get("commentCount", 0)
                if post_url:
                    db.upsert_post(post_url, "instagram", handle,
                                   view_count, like_count, comment_count, orbit_id)
            posts = db.get_posts_by_orbit(orbit_id)
        except Exception as e:
            return _ok(status=status, posts=[], error=str(e))

    return _ok(status=status, posts=posts)


@app.get("/api/virlo/orbit/{orbit_id}/outliers")
async def get_outliers(orbit_id: str):
    try:
        data = await virlo.get_orbit_outliers(orbit_id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    inner = data.get("data") or data
    return _ok(outliers=inner.get("outliers") or inner.get("items") or [])


class SatelliteRequest(BaseModel):
    handle: str
    platform: str = "instagram"


@app.post("/api/virlo/satellite")
async def start_satellite(req: SatelliteRequest):
    try:
        result = await virlo.start_satellite(req.handle, req.platform)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    return result


@app.get("/api/virlo/satellite/{job_id}")
async def poll_satellite(job_id: str):
    try:
        result = await virlo.get_satellite_status(job_id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    return result


@app.get("/api/orbit-jobs")
async def list_orbit_jobs():
    return _ok(jobs=db.list_orbit_jobs())


# ════════════════════════════════════════════════════════════════════════════
# Stage 2 — Queue
# ════════════════════════════════════════════════════════════════════════════

@app.get("/api/posts")
async def get_posts(orbit_id: str):
    posts = db.get_posts_by_orbit(orbit_id)
    return _ok(posts=posts)


@app.post("/api/posts/{post_id}/queue")
async def queue_post(post_id: int):
    post = db.get_post(post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    db.set_post_queued(post_id, True)
    return _ok(queued=True)


@app.delete("/api/posts/{post_id}/queue")
async def dequeue_post(post_id: int):
    post = db.get_post(post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    db.set_post_queued(post_id, False)
    return _ok(queued=False)


@app.get("/api/queue")
async def get_queue():
    return _ok(posts=db.get_queued_posts())


# ════════════════════════════════════════════════════════════════════════════
# Stage 3 — Scrape
# ════════════════════════════════════════════════════════════════════════════

class ScrapeRequest(BaseModel):
    include_replies: bool = False


@app.post("/api/scrape/run")
async def run_scrape(req: ScrapeRequest = ScrapeRequest()):
    global _scrape_state
    if _scrape_state["running"]:
        raise HTTPException(status_code=409, detail="Scrape already running")

    queued = db.get_queued_posts()
    if not queued:
        raise HTTPException(status_code=400, detail="No posts in queue")

    post_urls = [p["post_url"] for p in queued]
    post_ids = [p["id"] for p in queued]

    try:
        result = await apify.start_run(post_urls, include_replies=req.include_replies)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)

    run_data = result.get("data") or result
    run_id = run_data.get("id") or run_data.get("runId")
    dataset_id = run_data.get("defaultDatasetId")

    db.set_posts_scraping(post_ids, run_id)

    _scrape_state = {
        "running": True,
        "run_id": run_id,
        "dataset_id": dataset_id,
        "status": "RUNNING",
        "post_statuses": {p["post_url"]: "scraping" for p in queued},
        "error": None,
    }

    # build url → creator_handle map for OP reply detection
    post_creator_map = {p["post_url"]: (p.get("creator_handle") or "").lstrip("@").lower()
                        for p in queued}

    # kick off background polling
    asyncio.create_task(_poll_scrape(run_id, queued, post_creator_map))

    return _ok(run_id=run_id, status="RUNNING")


async def _poll_scrape(run_id: str, queued_posts: list[dict], post_creator_map: dict = {}):
    global _scrape_state
    try:
        while True:
            run_data = await apify.get_run_status(run_id)
            data = run_data.get("data") or run_data
            status = data.get("status", "RUNNING")
            dataset_id = data.get("defaultDatasetId") or _scrape_state["dataset_id"]
            _scrape_state["status"] = status
            _scrape_state["dataset_id"] = dataset_id

            if status == "SUCCEEDED":
                await _ingest_comments(dataset_id, run_id, queued_posts, post_creator_map)
                break
            elif status in ("FAILED", "ABORTED", "TIMED-OUT"):
                _scrape_state["error"] = f"Apify run {status}"
                for p in queued_posts:
                    db.set_post_scrape_status(p["post_url"], "error")
                break

            await asyncio.sleep(10)
    except Exception as e:
        _scrape_state["error"] = str(e)
    finally:
        _scrape_state["running"] = False


async def _ingest_comments(dataset_id: str, run_id: str, queued_posts: list[dict],
                           post_creator_map: dict = {}):
    items = await apify.get_dataset_items(dataset_id)
    post_url_map = {p["post_url"]: p["post_url"] for p in queued_posts}

    for item in items:
        username = item.get("ownerUsername") or item.get("username") or ""
        text = item.get("text") or item.get("commentText") or ""
        timestamp = item.get("timestamp") or item.get("createdAt") or ""
        post_url = item.get("postUrl") or item.get("post_url") or ""
        profile_url = f"https://www.instagram.com/{username}/" if username else ""

        if not (username and text):
            continue

        src = post_url if post_url in post_url_map else (
            list(post_url_map.keys())[0] if post_url_map else ""
        )

        # Detect if creator replied to this comment (only when includeReplies was used)
        creator_handle = post_creator_map.get(src, "")
        replies = item.get("replies") or item.get("commentReplies") or []
        creator_replied = 0
        if creator_handle and replies:
            creator_replied = int(any(
                (r.get("ownerUsername") or r.get("username") or "").lstrip("@").lower()
                == creator_handle
                for r in replies
            ))

        db.upsert_lead(username, profile_url, text, timestamp, src, run_id,
                       creator_replied=creator_replied)

    for p in queued_posts:
        db.set_post_scrape_status(p["post_url"], "done")

    _scrape_state["post_statuses"] = {p["post_url"]: "done" for p in queued_posts}


@app.get("/api/scrape/status")
async def scrape_status():
    return _ok(**_scrape_state)


# ════════════════════════════════════════════════════════════════════════════
# Stage 4 — Score
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/score/run")
async def run_score():
    if scorer.get_score_status()["running"]:
        raise HTTPException(status_code=409, detail="Scoring already running")
    asyncio.create_task(scorer.run_scoring())
    return _ok(status="started")


@app.get("/api/score/status")
async def score_status():
    return _ok(**scorer.get_score_status())


@app.post("/api/score/follow-drafts/run")
async def run_follow_drafts():
    if scorer.get_follow_draft_status()["running"]:
        raise HTTPException(status_code=409, detail="Follow draft generation already running")
    asyncio.create_task(scorer.run_follow_draft_generation())
    return _ok(status="started")


@app.get("/api/score/follow-drafts/status")
async def follow_drafts_status():
    return _ok(**scorer.get_follow_draft_status())


@app.get("/api/leads/missing-follow-drafts/count")
async def count_missing_follow_drafts():
    return _ok(count=db.count_leads_missing_follow_draft())


# ════════════════════════════════════════════════════════════════════════════
# Stage 5 — Leads
# ════════════════════════════════════════════════════════════════════════════

@app.get("/api/leads")
async def get_leads(score: int | None = None, status: str | None = None,
                    source_post_url: str | None = None, lead_type: str | None = None):
    leads = db.get_leads(score=score, status=status, source_post_url=source_post_url,
                         lead_type=lead_type)
    return _ok(leads=leads)


class LeadPatch(BaseModel):
    dm_draft: str | None = None
    dm_draft_follow: str | None = None
    status: str | None = None


@app.patch("/api/leads/{lead_id}")
async def patch_lead(lead_id: int, body: LeadPatch):
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    db.update_lead(lead_id, **updates)
    return _ok(updated=True)


# ════════════════════════════════════════════════════════════════════════════
# Stage 6 — Analyze (Market Intelligence)
# ════════════════════════════════════════════════════════════════════════════

class AnalyzeRequest(BaseModel):
    scope: str = "all"  # "all" or an orbit_id


@app.post("/api/analyze/run")
async def run_analyze(req: AnalyzeRequest = AnalyzeRequest()):
    if analyst.get_analyze_status()["running"]:
        raise HTTPException(status_code=409, detail="Analysis already running")

    # Resolve a human-readable label for the scope
    if req.scope == "all":
        scope_label = "All leads"
    else:
        job = db.get_orbit_job(req.scope)
        scope_label = (job.get("name") or req.scope) if job else req.scope

    asyncio.create_task(analyst.run_analysis(scope=req.scope, scope_label=scope_label))
    return _ok(status="started", scope=req.scope, scope_label=scope_label)


@app.get("/api/analyze/status")
async def analyze_status():
    return _ok(**analyst.get_analyze_status())


@app.get("/api/analyze/latest")
async def get_latest_analysis(scope: str = "all"):
    # Return the most recent analysis for the given scope
    analyses = db.list_analyses()
    for a in analyses:
        if a["scope"] == scope:
            full = db.get_analysis(a["id"])
            if full and full.get("result"):
                full["result"] = json.loads(full["result"])
            return _ok(analysis=full)
    return _ok(analysis=None)


@app.get("/api/analyze/{analysis_id}")
async def get_analysis(analysis_id: int):
    a = db.get_analysis(analysis_id)
    if not a:
        raise HTTPException(status_code=404, detail="Analysis not found")
    if a.get("result"):
        a["result"] = json.loads(a["result"])
    return _ok(analysis=a)


@app.get("/api/analyze-history")
async def list_analyses():
    return _ok(analyses=db.list_analyses())


# ── static files ──────────────────────────────────────────────────────────────
app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
