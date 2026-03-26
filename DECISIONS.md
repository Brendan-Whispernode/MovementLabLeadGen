# Decisions

A running log of non-obvious architectural and implementation decisions made during development. Maintained by the agent per WAT framework guidelines.

---

## 2026-03-17 — WAT Framework Reorganization

**Decision**: Moved `virlo.py`, `apify.py`, `scorer.py`, `database.py` from root into `tools/` package. Created `workflows/` directory with per-stage markdown SOPs.

**Why**: CLAUDE.md was updated to operate under the WAT (Workflows, Agents, Tools) framework, which requires deterministic execution scripts to live in `tools/` and SOP documentation to live in `workflows/`.

**Impact**: `server.py` now imports as `tools.apify`, `tools.database`, etc. `tools/scorer.py` imports `tools.database`. The root-level `.py` tool files were deleted.

---

## 2026-03-15 — In-Memory Scrape State (no extra DB table)

**Decision**: `_scrape_state` dict in `server.py` tracks the active Apify run rather than a dedicated `scrape_jobs` DB table.

**Why**: The scrape job is a single concurrent operation (one at a time). The in-memory dict is simpler and avoids schema complexity. Downside: state is lost on server restart mid-scrape.

**Mitigation**: Apify run continues in the cloud after restart. The `apify_run_ref` on each lead allows manual recovery by querying the Apify API directly if needed.

---

## 2026-03-15 — Virlo Field Normalization in server.py

**Decision**: `poll_orbit()` in `server.py` normalizes Virlo video response fields inline (e.g. `post_url` or `url` or `postUrl`) rather than in `tools/virlo.py`.

**Why**: Virlo's API response shape was inconsistent between early test runs. Normalization in the server layer keeps the tool simple/thin while the server handles shape variance.

---

## 2026-03-15 — SQLite WAL Mode

**Decision**: All DB connections set `PRAGMA journal_mode=WAL`.

**Why**: FastAPI runs background tasks (scrape polling, scoring) concurrently with HTTP request handlers. WAL mode allows concurrent reads alongside writes, preventing SQLite lock contention.
