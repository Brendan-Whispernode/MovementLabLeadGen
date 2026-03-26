# Architecture: MovementLab Lead Generation System

## Overview

A 5-stage Instagram lead generation pipeline for a somatic movement / body freedom coaching business. The system finds Instagram posts about body pain and movement restriction, scrapes comments, uses Claude AI to score commenters as potential clients, and presents a pipeline UI for managing outreach.

Built on the **WAT framework** (Workflows → Agents → Tools): markdown SOPs define each stage, Claude acts as the orchestrator, and deterministic Python scripts do the actual work against external APIs.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI 0.115.6 + Uvicorn |
| Database | SQLite 3 (WAL mode) |
| Frontend | Vanilla JS/HTML/CSS (no framework) |
| AI Scoring | Anthropic Claude Sonnet 4.6 |
| Post Discovery | Virlo API (virlo.ai) |
| Comment Scraping | Apify (`apify~instagram-comment-scraper`) |
| Config | python-dotenv |

---

## Directory Structure

```
MovementLabLeadGen/
├── server.py                   # FastAPI app — all endpoints + background tasks
├── leads.db                    # SQLite database (WAL mode)
├── requirements.txt            # Python dependencies
├── CLAUDE.md                   # WAT framework operating instructions for the agent
├── DECISIONS.md                # Log of architectural decisions with rationale
├── ARCHITECTURE.md             # This file
├── .env                        # API credentials (gitignored — never commit)
├── .env.example                # Template showing required env var names
│
├── tools/                      # Layer 3: Deterministic execution scripts
│   ├── __init__.py
│   ├── virlo.py                # Async HTTP client for Virlo discovery API
│   ├── apify.py                # Async HTTP client for Apify comment scraper
│   ├── database.py             # SQLite ORM — all DB reads/writes
│   └── scorer.py               # Claude batch scoring loop
│
├── workflows/                  # Layer 1: Markdown SOPs for each pipeline stage
│   ├── 00_run_server.md        # Boot the FastAPI dev server in tmux
│   ├── 01_discover.md          # Find Instagram posts via Virlo Orbit
│   ├── 02_queue.md             # Select posts for scraping
│   ├── 03_scrape.md            # Extract comments via Apify
│   ├── 04_score.md             # Score leads with Claude AI
│   └── 05_leads.md             # Manage outreach pipeline
│
├── static/                     # Frontend SPA
│   ├── index.html              # 5-tab SPA structure
│   ├── app.js                  # 800+ lines — UI logic, API calls, polling
│   └── style.css               # Responsive grid + component styles
│
├── .tmp/                       # Disposable intermediates (regenerate as needed)
├── .claude/
│   └── settings.local.json     # Claude Code permissions config
└── venv/                       # Python 3.11 virtual environment
```

---

## Pipeline Stages

Each stage maps to a workflow SOP, one or more API endpoints, and a tool script.

### Stage 0 — Server Boot (`workflows/00_run_server.md`)

Start the FastAPI dev server in a deterministic tmux session.

```bash
tmux new-session -d -s leadgen-server
source venv/bin/activate && python server.py
# Server: http://localhost:8000
```

The server's lifespan hook initializes all SQLite tables on startup.

---

### Stage 1 — Discover (`workflows/01_discover.md`)

Find relevant Instagram posts using Virlo's Orbit search.

| Step | What happens |
|------|-------------|
| User submits keywords + date range | `POST /api/virlo/orbit` → `virlo.start_orbit()` → Virlo starts async search |
| Duplicate detection | Server checks `orbit_jobs` for same normalized keyword set |
| Frontend polls every 5s | `GET /api/virlo/orbit/{orbit_id}` → `virlo.get_orbit_status()` |
| On completion | `virlo.get_orbit_videos()` → upsert into `posts` table |
| Display | Posts sorted by `view_count DESC` in Discover tab |

**DB tables touched:** `orbit_jobs`, `posts`

**Virlo Satellite** (bonus): lookup a specific creator's posts via `POST /api/virlo/satellite`.

---

### Stage 2 — Queue (`workflows/02_queue.md`)

Manually select high-engagement posts to scrape.

| Step | What happens |
|------|-------------|
| Browse posts | Queue tab shows all posts from a given Orbit job |
| Add to queue | `POST /api/posts/{post_id}/queue` → `posts.in_queue = 1` |
| Remove | `DELETE /api/posts/{post_id}/queue` → `posts.in_queue = 0` |

**DB tables touched:** `posts`

No hard cap, but 5–15 posts per batch is practical for cost and time reasons.

---

### Stage 3 — Scrape (`workflows/03_scrape.md`)

Extract comments from queued posts using Apify.

| Step | What happens |
|------|-------------|
| Start scrape | `POST /api/scrape/run` → pulls queued post URLs → `apify.start_run()` |
| Background polling | `_poll_scrape()` every 10s checks `apify.get_run_status()` |
| On SUCCEEDED | `apify.get_dataset_items()` → `_ingest_comments()` → upsert into `leads` |
| Deduplication | Unique on `(commenter_username, source_post_url, comment_text)` |
| Progress | Frontend polls `GET /api/scrape/status` every 3s |

**DB tables touched:** `posts` (scrape_status), `leads` (new rows, score = NULL)

Cap: 500 comments per post (intentional — controls Apify cost).

---

### Stage 4 — Score (`workflows/04_score.md`)

Rate each unscored lead using Claude Sonnet 4.6.

| Step | What happens |
|------|-------------|
| Start scoring | `POST /api/score/run` → `scorer.run_scoring()` as async task |
| Batch loop | `get_unscored_leads(limit=20)` → `scorer.score_batch()` → Claude API |
| Claude output | `[{id, score, score_reasoning, dm_draft}]` JSON per batch |
| DB update | `update_lead_score(id, score, reasoning, dm_draft)` |
| Progress | Frontend polls `GET /api/score/status` every 2s |

**Scoring rubric:**

| Score | Meaning |
|-------|---------|
| 1 | Not a lead — generic, spam, emoji-only, other creators |
| 2 | Warm — mild resonance, vague curiosity, no clear pain |
| 3 | Hot — direct personal struggle: body tension, somatic pain, movement avoidance |

Claude also generates a **DM draft** for each lead (max 3 sentences, references their specific comment, non-salesy).

**DB tables touched:** `leads` (score, score_reasoning, dm_draft)

---

### Stage 5 — Manage Leads (`workflows/05_leads.md`)

Browse scored leads, edit DMs, and track outreach status.

| Step | What happens |
|------|-------------|
| Browse | `GET /api/leads` with optional filters: score, status, source_post_url |
| Edit DM | Inline edit in UI → `PATCH /api/leads/{id}` with `{dm_draft}` |
| Update status | Dropdown in UI → `PATCH /api/leads/{id}` with `{status}` |

**Status flow:** `new` → `contacted` → `responded` → `not_relevant`

**DB tables touched:** `leads` (dm_draft, status)

---

## Data Model

### `orbit_jobs`

```sql
id           INTEGER PK
orbit_id     TEXT UNIQUE       -- Virlo's job ID
name         TEXT              -- Human label for the search
keywords     TEXT              -- JSON array: ["chronic pain", "tight hips"]
status       TEXT              -- running | completed | failed
created_at   DATETIME
completed_at DATETIME
```

### `posts`

```sql
id              INTEGER PK
post_url        TEXT UNIQUE      -- Instagram post URL
platform        TEXT DEFAULT 'instagram'
creator_handle  TEXT
view_count      INTEGER
like_count      INTEGER
comment_count   INTEGER
virlo_run_ref   TEXT             -- orbit_id from orbit_jobs
scrape_status   TEXT             -- pending | scraping | done | error
in_queue        INTEGER          -- 0 or 1
queued_at       DATETIME
created_at      DATETIME
```

### `leads`

```sql
id                  INTEGER PK
commenter_username  TEXT
profile_url         TEXT
comment_text        TEXT
comment_timestamp   DATETIME
source_post_url     TEXT REFERENCES posts(post_url)
score               INTEGER      -- NULL (unscored) | 1 | 2 | 3
score_reasoning     TEXT         -- Claude's reasoning
dm_draft            TEXT         -- Claude-generated outreach message
status              TEXT         -- new | contacted | responded | not_relevant
apify_run_ref       TEXT         -- Apify run ID (for recovery)
created_at          DATETIME
updated_at          DATETIME
```

**Constraints:**
- `PRAGMA foreign_keys = ON` — enforces `leads.source_post_url → posts.post_url`
- `PRAGMA journal_mode = WAL` — concurrent reads + async writes without lock contention
- Dedup on upsert: `(commenter_username, source_post_url, comment_text)` is effectively unique

---

## API Reference

### Stage 1: Discover

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/virlo/orbit` | Start a new Virlo Orbit search |
| GET | `/api/virlo/orbit/{orbit_id}` | Poll status; upserts posts on completion |
| GET | `/api/virlo/orbit/{orbit_id}/outliers` | Fetch creator outliers for an orbit |
| POST | `/api/virlo/satellite` | Start creator-level post lookup |
| GET | `/api/virlo/satellite/{job_id}` | Poll satellite job status |
| GET | `/api/orbit-jobs` | List all past orbit jobs |

### Stage 2: Queue

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/posts` | List posts for an orbit (`?orbit_id=`) |
| POST | `/api/posts/{post_id}/queue` | Add post to scrape queue |
| DELETE | `/api/posts/{post_id}/queue` | Remove post from queue |
| GET | `/api/queue` | List all queued posts |

### Stage 3: Scrape

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/scrape/run` | Start Apify scrape on queued posts |
| GET | `/api/scrape/status` | Poll scrape progress |

### Stage 4: Score

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/score/run` | Start Claude scoring of unscored leads |
| GET | `/api/score/status` | Poll scoring progress |

### Stage 5: Leads

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/leads` | List leads (`?score=`, `?status=`, `?source_post_url=`) |
| PATCH | `/api/leads/{lead_id}` | Update `dm_draft` or `status` |

### Static

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | Serve `static/index.html` |
| GET | `/*` | Serve files from `static/` |

---

## External APIs

### Virlo (`virlo.ai`)

- **Purpose:** Social discovery — finds Instagram posts matching topic/keyword searches
- **Base URL:** `https://api.virlo.ai/v1`
- **Auth:** `Authorization: Bearer {VIRLO_API_KEY}`
- **Key endpoints:** `POST /v1/orbit`, `GET /v1/orbit/{id}`, `GET /v1/orbit/{id}/videos`, `GET /v1/orbit/{id}/creators/outliers`, `GET /v1/satellite/creator/instagram/{handle}`
- **Async model:** Start a job, poll until `status = completed`
- **Quirk:** Response field names vary slightly across versions; normalization happens in `server.py` (not in `tools/virlo.py`)

### Apify (`apify.com`)

- **Purpose:** Scrapes Instagram comments from post URLs
- **Actor:** `apify~instagram-comment-scraper`
- **Base URL:** `https://api.apify.com/v2`
- **Auth:** `Authorization: Bearer {APIFY_API_TOKEN}`
- **Key endpoints:** `POST /acts/{actor}/runs`, `GET /actor-runs/{run_id}`, `GET /datasets/{dataset_id}/items`
- **Cost control:** Capped at 500 comments per post
- **Quirk:** Field names vary (`ownerUsername` vs `username`, `text` vs `commentText`); normalized in `server.py._ingest_comments()`
- **Async model:** Start run → poll status → fetch dataset items when `SUCCEEDED`

### Anthropic (`anthropic.com`)

- **Purpose:** Score leads and generate DM drafts
- **Model:** `claude-sonnet-4-6`
- **Auth:** `ANTHROPIC_API_KEY`
- **Batch size:** 20 comments per API call
- **Token cost:** ~1,500 tokens in + ~500 tokens out per batch (minimal at Sonnet pricing)
- **Output format:** JSON array `[{id, score, score_reasoning, dm_draft}]`
- **Quirk:** JSON parse failures are rare but possible; caught in `_score_state["error"]`; re-running scoring retries only unscored leads

---

## Environment Variables

Stored in `.env` only. Never committed. Loaded via `python-dotenv`.

```
ANTHROPIC_API_KEY    # Claude API (starts with sk-ant-api03-...)
APIFY_API_TOKEN      # Apify actor token (starts with apify_api_...)
VIRLO_API_KEY        # Virlo discovery API (starts with virlo_tkn_...)
```

---

## Feature Checklist

### Built ✅

**Discovery**
- [x] Virlo Orbit search (multi-keyword, configurable date range)
- [x] Duplicate Orbit detection (normalized keyword matching)
- [x] Post discovery with view/like/comment count capture
- [x] Past orbit jobs list (re-loadable)
- [x] Virlo Satellite creator-level post lookup

**Queueing**
- [x] Manual post queuing UI (add/remove)
- [x] Queue sorted by `queued_at`

**Scraping**
- [x] Apify comment scraping (capped at 500/post)
- [x] Lead deduplication (username + post + comment)
- [x] Async background polling with live progress UI
- [x] Per-post scrape status tracking

**Scoring**
- [x] Claude batch scoring (1/2/3) with reasoning
- [x] DM draft generation per scored lead
- [x] Async background scoring with live progress UI
- [x] Safe re-run (already-scored leads skipped automatically)

**Lead Management**
- [x] Lead status pipeline (new → contacted → responded → not_relevant)
- [x] DM draft inline editing
- [x] Lead filtering by score, status, and source post
- [x] Lead cards sorted by score DESC

**Infrastructure**
- [x] SQLite WAL mode (concurrent reads + async writes)
- [x] In-memory progress state for scrape and score
- [x] Toast notifications + progress bars in UI
- [x] DECISIONS.md architectural decision log

---

### Future Enhancements 🔮

**Outreach**
- [ ] Export leads to Google Sheets (Sheets API or CSV download)
- [ ] Bulk status update (mark batch of leads as contacted)
- [ ] Notes field on leads (personal context before reaching out)
- [ ] Follow-up reminders (schedule a contact date)
- [ ] Score 3 daily digest (email or Slack summary of hot leads)

**Scoring & Discovery**
- [ ] Re-score individual lead without running full batch
- [ ] Auto-queue posts above a configurable comment count threshold
- [ ] Multi-platform support (TikTok, YouTube — Virlo supports both)
- [ ] Saved keyword presets (don't retype common searches)

**Leads UI**
- [ ] Full-text search within leads (search comment_text)
- [ ] Lead tags / custom labels
- [ ] Pagination on leads tab (currently loads all leads)
- [ ] Dashboard stats: total leads, score breakdown, contact rate
- [ ] Filter leads by date range

**Infrastructure**
- [ ] Webhook from Apify on job completion (replace 10s polling)
- [ ] Persist scrape/score state to DB (survive server restarts)
- [ ] Auth / login (currently localhost-only with no authentication)
- [ ] Docker + deployment config (currently dev-only setup)
- [ ] Postgres migration path (SQLite ceiling: ~100k leads)

---

## Known Constraints & Edge Cases

| Issue | Mitigation |
|-------|-----------|
| **Apify cost** — each run burns credits | Cap at 500 comments/post; avoid re-scraping same posts |
| **Scrape state lost on restart** | `apify_run_ref` stored on each lead; query Apify API manually to recover |
| **Virlo field variance** | Normalized in `server.py` — tools stay thin and clean |
| **Claude JSON parse failure** | Rare; caught in `_score_state["error"]`; re-run scoring retries unscored leads only |
| **Concurrent scrape + score** | Both use in-memory locks; WAL mode handles DB concurrency |
| **SQLite ceiling** | Fine for <100k leads; migration to Postgres if scale demands it |
| **Dedup edge case** | Comments with trivial text variance (e.g. extra space) could create near-duplicates |
