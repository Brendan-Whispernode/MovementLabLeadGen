import sqlite3
from contextlib import contextmanager

DB_PATH = "leads.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS orbit_jobs (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                orbit_id     TEXT UNIQUE NOT NULL,
                name         TEXT,
                keywords     TEXT,
                status       TEXT,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME
            );

            CREATE TABLE IF NOT EXISTS posts (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                post_url        TEXT UNIQUE NOT NULL,
                platform        TEXT DEFAULT 'instagram',
                creator_handle  TEXT,
                view_count      INTEGER,
                like_count      INTEGER,
                comment_count   INTEGER,
                virlo_run_ref   TEXT,
                scrape_status   TEXT DEFAULT 'pending',
                in_queue        INTEGER DEFAULT 0,
                queued_at       DATETIME,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS leads (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                commenter_username  TEXT,
                profile_url         TEXT,
                comment_text        TEXT,
                comment_timestamp   DATETIME,
                source_post_url     TEXT REFERENCES posts(post_url),
                score               INTEGER,
                score_reasoning     TEXT,
                dm_draft            TEXT,
                status              TEXT DEFAULT 'new',
                apify_run_ref       TEXT,
                created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS analyses (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                scope         TEXT DEFAULT 'all',
                scope_label   TEXT,
                comment_count INTEGER,
                result        TEXT,
                created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        """)
        # Idempotent migrations for new columns
        for col, definition in [
            ("lead_type", "TEXT DEFAULT 'organic'"),
            ("creator_replied", "INTEGER DEFAULT 0"),
            ("dm_draft_follow", "TEXT"),
        ]:
            try:
                conn.execute(f"ALTER TABLE leads ADD COLUMN {col} {definition}")
            except Exception:
                pass  # Column already exists


# ── orbit_jobs ──────────────────────────────────────────────────────────────

def upsert_orbit_job(orbit_id: str, name: str, keywords: str, status: str):
    with db() as conn:
        conn.execute("""
            INSERT INTO orbit_jobs (orbit_id, name, keywords, status)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(orbit_id) DO UPDATE SET
                status = excluded.status,
                completed_at = CASE WHEN excluded.status IN ('completed','failed')
                               THEN CURRENT_TIMESTAMP ELSE completed_at END
        """, (orbit_id, name, keywords, status))


def get_orbit_job(orbit_id: str):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM orbit_jobs WHERE orbit_id = ?", (orbit_id,)
        ).fetchone()
        return dict(row) if row else None


def list_orbit_jobs():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM orbit_jobs ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def find_duplicate_orbit_job(keywords: list[str]) -> dict | None:
    import json
    target = json.dumps(sorted(k.strip().lower() for k in keywords))
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM orbit_jobs ORDER BY created_at DESC"
        ).fetchall()
        for row in rows:
            try:
                stored = json.dumps(sorted(k.strip().lower() for k in json.loads(row["keywords"] or "[]")))
            except Exception:
                continue
            if stored == target:
                return dict(row)
    return None


# ── posts ────────────────────────────────────────────────────────────────────

def upsert_post(post_url: str, platform: str, creator_handle: str,
                view_count: int, like_count: int, comment_count: int,
                virlo_run_ref: str):
    with db() as conn:
        conn.execute("""
            INSERT INTO posts
                (post_url, platform, creator_handle, view_count, like_count,
                 comment_count, virlo_run_ref)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(post_url) DO UPDATE SET
                view_count    = excluded.view_count,
                like_count    = excluded.like_count,
                comment_count = excluded.comment_count
        """, (post_url, platform, creator_handle, view_count, like_count,
              comment_count, virlo_run_ref))


def get_posts_by_orbit(orbit_id: str):
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM posts WHERE virlo_run_ref = ? ORDER BY view_count DESC",
            (orbit_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_post(post_id: int):
    with db() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
        return dict(row) if row else None


def set_post_queued(post_id: int, queued: bool):
    with db() as conn:
        if queued:
            conn.execute("""
                UPDATE posts SET in_queue = 1, queued_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (post_id,))
        else:
            conn.execute(
                "UPDATE posts SET in_queue = 0, queued_at = NULL WHERE id = ?",
                (post_id,)
            )


def get_queued_posts():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM posts WHERE in_queue = 1 ORDER BY queued_at"
        ).fetchall()
        return [dict(r) for r in rows]


def set_posts_scraping(post_ids: list[int], run_ref: str):
    with db() as conn:
        for pid in post_ids:
            conn.execute("""
                UPDATE posts SET scrape_status = 'scraping'
                WHERE id = ?
            """, (pid,))


def set_post_scrape_status(post_url: str, status: str):
    with db() as conn:
        conn.execute(
            "UPDATE posts SET scrape_status = ? WHERE post_url = ?",
            (status, post_url)
        )


# ── leads ────────────────────────────────────────────────────────────────────

def upsert_lead(commenter_username: str, profile_url: str, comment_text: str,
                comment_timestamp: str, source_post_url: str, apify_run_ref: str,
                creator_replied: int = 0):
    with db() as conn:
        existing = conn.execute("""
            SELECT id FROM leads
            WHERE commenter_username = ? AND source_post_url = ? AND comment_text = ?
        """, (commenter_username, source_post_url, comment_text)).fetchone()
        if not existing:
            conn.execute("""
                INSERT INTO leads
                    (commenter_username, profile_url, comment_text,
                     comment_timestamp, source_post_url, apify_run_ref, creator_replied)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (commenter_username, profile_url, comment_text,
                  comment_timestamp, source_post_url, apify_run_ref, creator_replied))


def get_unscored_leads(limit: int = 20):
    with db() as conn:
        rows = conn.execute("""
            SELECT l.*, p.creator_handle
            FROM leads l
            LEFT JOIN posts p ON l.source_post_url = p.post_url
            WHERE l.score IS NULL
            ORDER BY l.created_at LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]


def count_unscored_leads():
    with db() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM leads WHERE score IS NULL"
        ).fetchone()[0]


def get_leads_missing_follow_draft(limit: int = 20):
    with db() as conn:
        rows = conn.execute("""
            SELECT l.*, p.creator_handle
            FROM leads l
            LEFT JOIN posts p ON l.source_post_url = p.post_url
            WHERE l.score IN (2, 3) AND l.dm_draft_follow IS NULL
            ORDER BY l.created_at
            LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]


def count_leads_missing_follow_draft():
    with db() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM leads WHERE score IN (2, 3) AND dm_draft_follow IS NULL"
        ).fetchone()[0]


def update_lead_score(lead_id: int, score: int, reasoning: str, dm_draft: str,
                      lead_type: str | None = None, dm_draft_follow: str | None = None):
    with db() as conn:
        conn.execute("""
            UPDATE leads SET score = ?, score_reasoning = ?, dm_draft = ?,
                             lead_type = COALESCE(?, lead_type),
                             dm_draft_follow = COALESCE(?, dm_draft_follow),
                             updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (score, reasoning, dm_draft, lead_type, dm_draft_follow, lead_id))


def update_lead(lead_id: int, **kwargs):
    allowed = {"dm_draft", "dm_draft_follow", "status"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [lead_id]
    with db() as conn:
        conn.execute(
            f"UPDATE leads SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            values
        )


def get_leads(score: int | None = None, status: str | None = None,
              source_post_url: str | None = None, lead_type: str | None = None):
    where = []
    params = []
    if score is not None:
        where.append("score = ?")
        params.append(score)
    if status:
        where.append("status = ?")
        params.append(status)
    if source_post_url:
        where.append("source_post_url = ?")
        params.append(source_post_url)
    if lead_type:
        where.append("lead_type = ?")
        params.append(lead_type)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    with db() as conn:
        rows = conn.execute(
            f"SELECT * FROM leads {clause} ORDER BY score DESC, created_at DESC",
            params
        ).fetchall()
        return [dict(r) for r in rows]


# ── analyses ─────────────────────────────────────────────────────────────────

def get_leads_for_analysis(scope: str = "all", min_score: int = 2) -> list[dict]:
    """Return comment_text, score, and creator_handle for all qualifying leads."""
    with db() as conn:
        if scope == "all":
            rows = conn.execute("""
                SELECT l.comment_text, l.score, p.creator_handle
                FROM leads l
                LEFT JOIN posts p ON l.source_post_url = p.post_url
                WHERE l.score >= ?
                ORDER BY l.score DESC, l.created_at
            """, (min_score,)).fetchall()
        else:
            rows = conn.execute("""
                SELECT l.comment_text, l.score, p.creator_handle
                FROM leads l
                JOIN posts p ON l.source_post_url = p.post_url
                WHERE l.score >= ? AND p.virlo_run_ref = ?
                ORDER BY l.score DESC, l.created_at
            """, (min_score, scope)).fetchall()
        return [dict(r) for r in rows]


def save_analysis(scope: str, scope_label: str, comment_count: int, result_json: str) -> int:
    with db() as conn:
        cur = conn.execute("""
            INSERT INTO analyses (scope, scope_label, comment_count, result)
            VALUES (?, ?, ?, ?)
        """, (scope, scope_label, comment_count, result_json))
        return cur.lastrowid


def get_analysis(analysis_id: int) -> dict | None:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM analyses WHERE id = ?", (analysis_id,)
        ).fetchone()
        return dict(row) if row else None


def list_analyses() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, scope, scope_label, comment_count, created_at FROM analyses ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
