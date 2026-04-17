"""
db.py — SQLite setup, schema, and all query helpers.
Single database file at /app/data/braincache.db.
All timestamps stored as ISO-8601 strings in UTC.
"""

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Optional


def now_iso() -> str:
    """Current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def get_connection(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _row_to_dict(row) -> dict:
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Schema + seed
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS entities (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL,
    first_seen   TEXT,
    UNIQUE(name, type)
);

CREATE TABLE IF NOT EXISTS article_entities (
    entity_id    INTEGER REFERENCES entities(id) ON DELETE CASCADE,
    article_url  TEXT NOT NULL,
    seen_at      TEXT,
    PRIMARY KEY (entity_id, article_url)
);

CREATE TABLE IF NOT EXISTS sources (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    url              TEXT NOT NULL,
    feed_type        TEXT NOT NULL,
    scrape_selector  TEXT,
    is_active        INTEGER DEFAULT 1,
    added_at         TEXT,
    last_polled_at   TEXT,
    last_error       TEXT
);

CREATE TABLE IF NOT EXISTS articles (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id        INTEGER REFERENCES sources(id),
    url              TEXT UNIQUE NOT NULL,
    title            TEXT,
    published_date   TEXT,
    summary          TEXT,
    full_text        TEXT,
    scraped_at       TEXT,
    session_status   TEXT DEFAULT 'not_started'
);

CREATE TABLE IF NOT EXISTS notebook_entries (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    term                TEXT NOT NULL,
    hypothesis_prompt   TEXT,
    plain_explanation   TEXT,
    mitre_reference     TEXT,
    socratic_questions  TEXT,
    resolution_target   TEXT,
    is_resolved         INTEGER DEFAULT 0,
    created_at          TEXT,
    resolved_at         TEXT,
    source_article_url  TEXT
);

CREATE TABLE IF NOT EXISTS session_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    article_url   TEXT,
    phase         TEXT,
    prompt_text   TEXT,
    user_response TEXT,
    timestamp     TEXT
);
"""

_SEED_SOURCES = [
    ("The DFIR Report",    "https://thedfirreport.com/reports/",               "scrape", "article h2 a"),
    ("Bleeping Computer",  "https://www.bleepingcomputer.com/feed/",            "rss",    None),
    ("Krebs on Security",  "https://krebsonsecurity.com/feed/",                 "rss",    None),
    ("Recorded Future",    "https://www.recordedfuture.com/feed",               "rss",    None),
    ("Secureworks",        "https://www.secureworks.com/rss/blog",              "rss",    None),
    ("Unit 42 Palo Alto",  "https://unit42.paloaltonetworks.com/feed/",         "rss",    None),
]


def init_db(db_path: str) -> None:
    """Creates all tables. Inserts seed sources if table empty."""
    conn = get_connection(db_path)
    with conn:
        conn.executescript(_SCHEMA)
        row = conn.execute("SELECT COUNT(*) FROM sources").fetchone()
        if row[0] == 0:
            ts = now_iso()
            conn.executemany(
                "INSERT INTO sources (name, url, feed_type, scrape_selector, added_at) "
                "VALUES (?, ?, ?, ?, ?)",
                [(n, u, ft, sel, ts) for n, u, ft, sel in _SEED_SOURCES],
            )
        # Add dismissed column if it doesn't exist (migration for existing DBs)
        try:
            conn.execute(
                "ALTER TABLE articles ADD COLUMN dismissed INTEGER DEFAULT 0"
            )
        except sqlite3.OperationalError:
            pass  # Column already exists
        # Indexes on frequently-filtered columns (safe to re-run)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_articles_session_status ON articles(session_status)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_articles_dismissed ON articles(dismissed)"
        )
        # Add spaced-repetition columns to notebook_entries (migration)
        for col, defn in [
            ("sr_interval",      "INTEGER DEFAULT 1"),
            ("sr_repetitions",   "INTEGER DEFAULT 0"),
            ("sr_ease_factor",   "REAL DEFAULT 2.5"),
            ("sr_due_date",      "TEXT"),
            ("sr_last_reviewed", "TEXT"),
        ]:
            try:
                conn.execute(
                    f"ALTER TABLE notebook_entries ADD COLUMN {col} {defn}"
                )
            except sqlite3.OperationalError:
                pass
    conn.close()


# ---------------------------------------------------------------------------
# Sources helpers
# ---------------------------------------------------------------------------

def get_all_sources(db_path: str) -> list[dict]:
    conn = get_connection(db_path)
    rows = conn.execute("SELECT * FROM sources ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_active_sources(db_path: str) -> list[dict]:
    conn = get_connection(db_path)
    rows = conn.execute(
        "SELECT * FROM sources WHERE is_active = 1 ORDER BY id"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_source_by_id(db_path: str, source_id: int) -> Optional[dict]:
    conn = get_connection(db_path)
    row = conn.execute(
        "SELECT * FROM sources WHERE id = ?", (source_id,)
    ).fetchone()
    conn.close()
    return _row_to_dict(row)


def insert_source(
    db_path: str,
    name: str,
    url: str,
    feed_type: str,
    scrape_selector: Optional[str] = None,
) -> dict:
    conn = get_connection(db_path)
    ts = now_iso()
    with conn:
        cur = conn.execute(
            "INSERT INTO sources (name, url, feed_type, scrape_selector, added_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (name, url, feed_type, scrape_selector, ts),
        )
        row = conn.execute(
            "SELECT * FROM sources WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    conn.close()
    return dict(row)


_ALLOWED_SOURCE_FIELDS = {
    "name", "url", "feed_type", "scrape_selector",
    "is_active", "last_polled_at", "last_error",
}


def update_source(
    db_path: str, source_id: int, **fields
) -> Optional[dict]:
    valid = {k: v for k, v in fields.items() if k in _ALLOWED_SOURCE_FIELDS}
    if not valid:
        return get_source_by_id(db_path, source_id)
    assignments = ", ".join(f"{k} = ?" for k in valid)
    values = list(valid.values()) + [source_id]
    conn = get_connection(db_path)
    with conn:
        conn.execute(
            f"UPDATE sources SET {assignments} WHERE id = ?", values
        )
        row = conn.execute(
            "SELECT * FROM sources WHERE id = ?", (source_id,)
        ).fetchone()
    conn.close()
    return _row_to_dict(row)


def delete_source(db_path: str, source_id: int) -> bool:
    conn = get_connection(db_path)
    with conn:
        cur = conn.execute(
            "DELETE FROM sources WHERE id = ?", (source_id,)
        )
    conn.close()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Articles helpers
# ---------------------------------------------------------------------------

def get_all_articles(
    db_path: str,
    source_id: Optional[int] = None,
    include_dismissed: bool = False,
) -> list[dict]:
    conn = get_connection(db_path)
    base = (
        "SELECT a.*, s.name AS source_name FROM articles a "
        "LEFT JOIN sources s ON a.source_id = s.id "
    )
    if source_id is not None:
        if include_dismissed:
            rows = conn.execute(
                base + "WHERE a.source_id = ? ORDER BY a.id DESC",
                (source_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                base + "WHERE a.source_id = ? AND (a.dismissed = 0 OR a.dismissed IS NULL) "
                "ORDER BY a.id DESC",
                (source_id,),
            ).fetchall()
    else:
        if include_dismissed:
            rows = conn.execute(base + "ORDER BY a.id DESC").fetchall()
        else:
            rows = conn.execute(
                base + "WHERE (a.dismissed = 0 OR a.dismissed IS NULL) ORDER BY a.id DESC"
            ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_article_by_url(db_path: str, url: str) -> Optional[dict]:
    conn = get_connection(db_path)
    row = conn.execute(
        "SELECT a.*, s.name AS source_name "
        "FROM articles a "
        "LEFT JOIN sources s ON a.source_id = s.id "
        "WHERE a.url = ?",
        (url,),
    ).fetchone()
    conn.close()
    return _row_to_dict(row)


def insert_article(
    db_path: str,
    source_id: int,
    url: str,
    title: Optional[str] = None,
    published_date: Optional[str] = None,
    summary: Optional[str] = None,
) -> Optional[dict]:
    conn = get_connection(db_path)
    ts = now_iso()
    try:
        with conn:
            cur = conn.execute(
                "INSERT INTO articles "
                "(source_id, url, title, published_date, summary, scraped_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (source_id, url, title, published_date, summary, ts),
            )
            row = conn.execute(
                "SELECT a.*, s.name AS source_name "
                "FROM articles a "
                "LEFT JOIN sources s ON a.source_id = s.id "
                "WHERE a.id = ?",
                (cur.lastrowid,),
            ).fetchone()
        conn.close()
        return dict(row)
    except sqlite3.IntegrityError:
        conn.close()
        return None


def insert_paste_article(
    db_path: str,
    url: str,
    title: str,
    full_text: str,
) -> Optional[dict]:
    """Insert an article whose text was pasted directly (no scraper)."""
    conn = get_connection(db_path)
    ts = now_iso()
    try:
        with conn:
            cur = conn.execute(
                "INSERT INTO articles "
                "(source_id, url, title, full_text, scraped_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (None, url, title, full_text, ts),
            )
            row = conn.execute(
                "SELECT a.*, s.name AS source_name "
                "FROM articles a "
                "LEFT JOIN sources s ON a.source_id = s.id "
                "WHERE a.id = ?",
                (cur.lastrowid,),
            ).fetchone()
        conn.close()
        return dict(row)
    except sqlite3.IntegrityError:
        conn.close()
        return None


def update_article_full_text(db_path: str, url: str, full_text: str) -> None:
    conn = get_connection(db_path)
    with conn:
        conn.execute(
            "UPDATE articles SET full_text = ? WHERE url = ?",
            (full_text, url),
        )
    conn.close()


_VALID_SESSION_STATUSES = {"not_started", "in_progress", "complete"}


def update_article_session_status(db_path: str, url: str, status: str) -> None:
    if status not in _VALID_SESSION_STATUSES:
        raise ValueError(
            f"Invalid session status '{status}'. "
            f"Must be one of: {_VALID_SESSION_STATUSES}"
        )
    conn = get_connection(db_path)
    with conn:
        conn.execute(
            "UPDATE articles SET session_status = ? WHERE url = ?",
            (status, url),
        )
    conn.close()


# ---------------------------------------------------------------------------
# Notebook helpers
# ---------------------------------------------------------------------------

def _deserialize_notebook_row(row) -> Optional[dict]:
    if row is None:
        return None
    d = dict(row)
    raw = d.get("socratic_questions")
    if raw:
        try:
            d["socratic_questions"] = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            d["socratic_questions"] = []
    else:
        d["socratic_questions"] = []
    return d


def get_all_notebook_entries(db_path: str) -> list[dict]:
    conn = get_connection(db_path)
    rows = conn.execute(
        "SELECT * FROM notebook_entries "
        "ORDER BY is_resolved ASC, created_at DESC"
    ).fetchall()
    conn.close()
    return [_deserialize_notebook_row(r) for r in rows]


def get_notebook_entry_by_term(
    db_path: str, term: str
) -> Optional[dict]:
    conn = get_connection(db_path)
    row = conn.execute(
        "SELECT * FROM notebook_entries WHERE LOWER(term) = LOWER(?)",
        (term,),
    ).fetchone()
    conn.close()
    return _deserialize_notebook_row(row)


def insert_notebook_entry(
    db_path: str,
    term: str,
    hypothesis_prompt: Optional[str] = None,
    plain_explanation: Optional[str] = None,
    mitre_reference: Optional[str] = None,
    socratic_questions: Optional[list] = None,
    resolution_target: Optional[str] = None,
    source_article_url: Optional[str] = None,
) -> dict:
    conn = get_connection(db_path)
    ts = now_iso()
    sq_json = json.dumps(socratic_questions) if socratic_questions else json.dumps([])
    with conn:
        cur = conn.execute(
            "INSERT INTO notebook_entries "
            "(term, hypothesis_prompt, plain_explanation, mitre_reference, "
            "socratic_questions, resolution_target, source_article_url, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (term, hypothesis_prompt, plain_explanation, mitre_reference,
             sq_json, resolution_target, source_article_url, ts),
        )
        row = conn.execute(
            "SELECT * FROM notebook_entries WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    conn.close()
    return _deserialize_notebook_row(row)


def update_notebook_entry_resolved(
    db_path: str, entry_id: int, is_resolved: bool
) -> Optional[dict]:
    resolved_at = now_iso() if is_resolved else None
    conn = get_connection(db_path)
    with conn:
        conn.execute(
            "UPDATE notebook_entries "
            "SET is_resolved = ?, resolved_at = ? "
            "WHERE id = ?",
            (1 if is_resolved else 0, resolved_at, entry_id),
        )
        row = conn.execute(
            "SELECT * FROM notebook_entries WHERE id = ?", (entry_id,)
        ).fetchone()
    conn.close()
    return _deserialize_notebook_row(row)


def delete_notebook_entry(db_path: str, entry_id: int) -> bool:
    conn = get_connection(db_path)
    with conn:
        cur = conn.execute(
            "DELETE FROM notebook_entries WHERE id = ?", (entry_id,)
        )
    conn.close()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Session log helpers
# ---------------------------------------------------------------------------

def insert_session_log(
    db_path: str,
    article_url: str,
    phase: str,
    prompt_text: str,
    user_response: str,
) -> dict:
    conn = get_connection(db_path)
    ts = now_iso()
    with conn:
        cur = conn.execute(
            "INSERT INTO session_logs "
            "(article_url, phase, prompt_text, user_response, timestamp) "
            "VALUES (?, ?, ?, ?, ?)",
            (article_url, phase, prompt_text, user_response, ts),
        )
        row = conn.execute(
            "SELECT * FROM session_logs WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    conn.close()
    return dict(row)


def get_session_logs_by_article(
    db_path: str, article_url: str
) -> list[dict]:
    conn = get_connection(db_path)
    rows = conn.execute(
        "SELECT * FROM session_logs WHERE article_url = ? ORDER BY id",
        (article_url,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Spaced repetition helpers
# ---------------------------------------------------------------------------

def get_due_notebook_entries(db_path: str) -> list[dict]:
    """Returns unresolved entries whose SR due date is today or earlier (or never reviewed)."""
    today = datetime.now(timezone.utc).date().isoformat()
    conn = get_connection(db_path)
    rows = conn.execute(
        "SELECT * FROM notebook_entries "
        "WHERE is_resolved = 0 "
        "  AND (sr_due_date IS NULL OR sr_due_date <= ?) "
        "ORDER BY CASE WHEN sr_due_date IS NULL THEN 0 ELSE 1 END, sr_due_date ASC",
        (today,),
    ).fetchall()
    conn.close()
    return [_deserialize_notebook_row(r) for r in rows]


def apply_sm2_review(
    db_path: str, entry_id: int, quality: int
) -> Optional[dict]:
    """Apply one SM-2 review cycle. quality is 0–5."""
    quality = max(0, min(5, quality))
    conn = get_connection(db_path)
    row = conn.execute(
        "SELECT sr_interval, sr_repetitions, sr_ease_factor "
        "FROM notebook_entries WHERE id = ?",
        (entry_id,),
    ).fetchone()
    if not row:
        conn.close()
        return None

    interval    = row["sr_interval"]    or 1
    repetitions = row["sr_repetitions"] or 0
    ease_factor = row["sr_ease_factor"] or 2.5

    if quality < 3:
        # Recall failure — reset card
        new_interval    = 1
        new_repetitions = 0
        new_ef          = max(1.3, ease_factor - 0.2)
    else:
        if repetitions == 0:
            new_interval = 1
        elif repetitions == 1:
            new_interval = 6
        else:
            new_interval = max(1, round(interval * ease_factor))
        new_repetitions = repetitions + 1
        new_ef = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
        new_ef = max(1.3, new_ef)

    due_date = (
        datetime.now(timezone.utc).date() + timedelta(days=new_interval)
    ).isoformat()
    ts = now_iso()

    with conn:
        conn.execute(
            "UPDATE notebook_entries "
            "SET sr_interval = ?, sr_repetitions = ?, sr_ease_factor = ?, "
            "    sr_due_date = ?, sr_last_reviewed = ? "
            "WHERE id = ?",
            (new_interval, new_repetitions, round(new_ef, 4), due_date, ts, entry_id),
        )
        updated = conn.execute(
            "SELECT * FROM notebook_entries WHERE id = ?", (entry_id,)
        ).fetchone()
    conn.close()
    return _deserialize_notebook_row(updated)


# ---------------------------------------------------------------------------
# Entity tracking helpers
# ---------------------------------------------------------------------------

_VALID_ENTITY_TYPES = {"threat_actor", "malware", "technique", "cve"}


def upsert_entity(db_path: str, name: str, entity_type: str, article_url: str) -> None:
    """Insert entity if not exists, then link it to the article."""
    if entity_type not in _VALID_ENTITY_TYPES:
        return
    name = name.strip()
    if not name:
        return
    ts = now_iso()
    conn = get_connection(db_path)
    with conn:
        # Insert or ignore the entity
        conn.execute(
            "INSERT OR IGNORE INTO entities (name, type, first_seen) VALUES (?, ?, ?)",
            (name, entity_type, ts),
        )
        row = conn.execute(
            "SELECT id FROM entities WHERE name = ? AND type = ?", (name, entity_type)
        ).fetchone()
        entity_id = row["id"]
        # Link to article (ignore if already linked)
        conn.execute(
            "INSERT OR IGNORE INTO article_entities (entity_id, article_url, seen_at) "
            "VALUES (?, ?, ?)",
            (entity_id, article_url, ts),
        )
    conn.close()


def get_entities_with_article_counts(db_path: str) -> list[dict]:
    """All entities with how many articles they appear in, ordered by count desc."""
    conn = get_connection(db_path)
    rows = conn.execute(
        """
        SELECT e.id, e.name, e.type, e.first_seen,
               COUNT(ae.article_url) AS article_count
        FROM entities e
        LEFT JOIN article_entities ae ON ae.entity_id = e.id
        GROUP BY e.id
        ORDER BY article_count DESC, e.name ASC
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_entity_articles(db_path: str, entity_id: int) -> list[dict]:
    """Articles linked to a given entity."""
    conn = get_connection(db_path)
    rows = conn.execute(
        """
        SELECT a.url, a.title, a.session_status, ae.seen_at,
               s.name AS source_name
        FROM article_entities ae
        JOIN articles a ON a.url = ae.article_url
        LEFT JOIN sources s ON s.id = a.source_id
        WHERE ae.entity_id = ?
        ORDER BY ae.seen_at DESC
        """,
        (entity_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_sr_stats(db_path: str) -> dict:
    today = datetime.now(timezone.utc).date().isoformat()
    conn = get_connection(db_path)
    due_count = conn.execute(
        "SELECT COUNT(*) FROM notebook_entries "
        "WHERE is_resolved = 0 "
        "  AND (sr_due_date IS NULL OR sr_due_date <= ?)",
        (today,),
    ).fetchone()[0]
    reviewed_today = conn.execute(
        "SELECT COUNT(*) FROM notebook_entries "
        "WHERE sr_last_reviewed LIKE ?",
        (today + "%",),
    ).fetchone()[0]
    conn.close()
    return {"due_count": due_count, "reviewed_today": reviewed_today}
