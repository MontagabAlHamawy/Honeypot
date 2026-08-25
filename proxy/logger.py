# honeypot/proxy/logger.py
"""
Database Logger
Async PostgreSQL writer for sessions, requests, events, and attacks.
Uses raw asyncpg for maximum throughput.
"""
import json
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Any
import asyncpg
import os

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://honeypot:honeypot_secret@localhost:5444/honeypot",
)

# Convert postgresql:// → asyncpg-compatible (remove +asyncpg if present)
_ASYNCPG_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


async def get_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(_ASYNCPG_URL, min_size=2, max_size=10)


# Module-level pool (initialised in main.py lifespan)
_pool: Optional[asyncpg.Pool] = None


def set_pool(pool: asyncpg.Pool):
    global _pool
    _pool = pool


# ─────────────────────────────────────────────────────────────
# Schema bootstrap
# ─────────────────────────────────────────────────────────────
CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
    id          UUID PRIMARY KEY,
    ip_address  TEXT NOT NULL,
    country     TEXT,
    city        TEXT,
    region      TEXT,
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    isp         TEXT,
    user_agent  TEXT,
    source_tab_id TEXT,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS source_tab_id TEXT;

CREATE TABLE IF NOT EXISTS requests (
    id              BIGSERIAL PRIMARY KEY,
    session_id      UUID REFERENCES sessions(id),
    method          TEXT NOT NULL,
    path            TEXT NOT NULL,
    query_string    TEXT,
    headers         JSONB,
    payload         TEXT,
    cookies         JSONB,
    response_status INTEGER,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
    id          BIGSERIAL PRIMARY KEY,
    session_id  UUID REFERENCES sessions(id),
    event_type  TEXT NOT NULL,
    data_json   JSONB,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attacks (
    id          BIGSERIAL PRIMARY KEY,
    session_id  UUID REFERENCES sessions(id),
    attack_type TEXT NOT NULL,
    severity    TEXT NOT NULL,
    payload     TEXT,
    path        TEXT,
    confidence  DOUBLE PRECISION DEFAULT 0,
    score       INTEGER DEFAULT 0,
    detector    TEXT,
    request_method TEXT,
    request_query  TEXT,
    request_headers JSONB,
    request_body    TEXT,
    ip_address      TEXT,
    user_agent      TEXT,
    country         TEXT,
    city            TEXT,
    tool_hint       TEXT,
    behavior_pattern TEXT,
    frequency_1m    INTEGER,
    attack_details  JSONB,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE attacks ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION DEFAULT 0;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS detector TEXT;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS request_method TEXT;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS request_query TEXT;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS request_headers JSONB;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS request_body TEXT;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS tool_hint TEXT;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS behavior_pattern TEXT;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS frequency_1m INTEGER;
ALTER TABLE attacks ADD COLUMN IF NOT EXISTS attack_details JSONB;

CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attacks_timestamp ON attacks(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attacks_type ON attacks(attack_type);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_attacks_session ON attacks(session_id);
CREATE INDEX IF NOT EXISTS idx_attacks_detector ON attacks(detector);

CREATE TABLE IF NOT EXISTS page_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    session_id      UUID REFERENCES sessions(id),
    path            TEXT NOT NULL,
    html            TEXT NOT NULL,
    viewport_width  INTEGER NOT NULL DEFAULT 1280,
    viewport_height INTEGER NOT NULL DEFAULT 720,
    scroll_x        INTEGER NOT NULL DEFAULT 0,
    scroll_y        INTEGER NOT NULL DEFAULT 0,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_session ON page_snapshots(session_id);

CREATE TABLE IF NOT EXISTS captured_uploads (
    id            BIGSERIAL PRIMARY KEY,
    session_id    UUID REFERENCES sessions(id),
    original_name TEXT NOT NULL,
    mime_type     TEXT,
    size_bytes    INTEGER,
    saved_path    TEXT NOT NULL,
    upload_field  TEXT,
    timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_uploads_session ON captured_uploads(session_id);
CREATE INDEX IF NOT EXISTS idx_uploads_timestamp ON captured_uploads(timestamp DESC);

CREATE TABLE IF NOT EXISTS wp_login_attempts (
    id            BIGSERIAL PRIMARY KEY,
    session_id    UUID REFERENCES sessions(id),
    username      TEXT,
    ip_address    TEXT,
    status        TEXT NOT NULL,
    user_agent    TEXT,
    timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wp_login_attempts_session ON wp_login_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_wp_login_attempts_timestamp ON wp_login_attempts(timestamp DESC);

CREATE TABLE IF NOT EXISTS recording_consents (
    session_id    UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    consent_given BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_recordings (
    id            BIGSERIAL PRIMARY KEY,
    session_id    UUID REFERENCES sessions(id) ON DELETE CASCADE,
    saved_path    TEXT NOT NULL,
    mime_type     TEXT,
    size_bytes    BIGINT,
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_session_recordings_session ON session_recordings(session_id);

CREATE TABLE IF NOT EXISTS ip_blocking_settings (
    id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled           BOOLEAN NOT NULL DEFAULT FALSE,
    request_threshold INTEGER NOT NULL DEFAULT 12,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO ip_blocking_settings (id, enabled, request_threshold)
VALUES (1, FALSE, 12)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS blocked_ips (
    ip_address       TEXT PRIMARY KEY,
    reason           TEXT,
    hit_count        INTEGER NOT NULL DEFAULT 0,
    first_blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blocked_ips_last_seen ON blocked_ips(last_seen_at DESC);
-- No unique constraint: store every snapshot separately for accurate timeline replay
CREATE INDEX IF NOT EXISTS idx_snapshots_session_path ON page_snapshots(session_id, path);
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON page_snapshots(session_id, timestamp DESC);
"""


async def bootstrap_schema():
    async with _pool.acquire() as conn:
        await conn.execute(CREATE_TABLES_SQL)
    logger.info("Database schema ready.")


# ─────────────────────────────────────────────────────────────
# Writers
# ─────────────────────────────────────────────────────────────

async def upsert_session(
    session_id: str,
    ip_address: str,
    user_agent: str,
    geo: dict,
    source_tab_id: Optional[str] = None,
) -> None:
    sql = """
    INSERT INTO sessions (id, ip_address, country, city, region, latitude, longitude, isp, user_agent, source_tab_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (id) DO UPDATE SET
        user_agent = COALESCE(EXCLUDED.user_agent, sessions.user_agent),
        source_tab_id = COALESCE(EXCLUDED.source_tab_id, sessions.source_tab_id),
        ended_at = NULL
    """
    async with _pool.acquire() as conn:
        await conn.execute(
            sql,
            session_id,
            ip_address,
            geo.get("country"),
            geo.get("city"),
            geo.get("region"),
            geo.get("latitude"),
            geo.get("longitude"),
            geo.get("isp"),
            user_agent,
            source_tab_id,
        )


async def log_request(
    session_id: Optional[str],
    method: str,
    path: str,
    query_string: str,
    headers: dict,
    payload: str,
    cookies: dict,
    response_status: int,
) -> int:
    sql = """
    INSERT INTO requests (session_id, method, path, query_string, headers, payload, cookies, response_status)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)
    RETURNING id
    """
    async with _pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                sql,
                session_id,
                method,
                path,
                query_string,
                json.dumps(headers),
                payload[:12000] if payload else None,
                json.dumps(cookies),
                response_status,
            )
        except asyncpg.ForeignKeyViolationError:
            logger.warning(
                "log_request fallback: session_id %s not found in sessions, retrying with NULL",
                session_id,
            )
            row = await conn.fetchrow(
                sql,
                None,
                method,
                path,
                query_string,
                json.dumps(headers),
                payload[:12000] if payload else None,
                json.dumps(cookies),
                response_status,
            )
    return int(row["id"]) if row else -1


async def log_event(
    session_id: str,
    event_type: str,
    data: Any,
) -> None:
    sql = """
    INSERT INTO events (session_id, event_type, data_json)
    VALUES ($1, $2, $3::jsonb)
    """
    async with _pool.acquire() as conn:
        await conn.execute(sql, session_id, event_type, json.dumps(data))


async def log_events_batch(session_id: str, events: list[dict[str, Any]]) -> None:
    if not events:
        return

    sql = """
    INSERT INTO events (session_id, event_type, data_json, timestamp)
    VALUES ($1, $2, $3::jsonb, COALESCE($4, NOW()))
    """

    rows: list[tuple[Any, ...]] = []
    for event in events:
        event_type = str(event.get("t") or event.get("type") or "unknown")
        event_ts = event.get("ts")
        ts_value = None
        if isinstance(event_ts, (int, float)):
            ts_value = datetime.fromtimestamp(event_ts / 1000.0, tz=timezone.utc)
        rows.append((session_id, event_type, json.dumps(event), ts_value))

    async with _pool.acquire() as conn:
        await conn.executemany(sql, rows)


async def log_attack(
    session_id: str,
    attack_type: str,
    severity: str,
    payload: Optional[str],
    path: str,
    confidence: float = 0.0,
    score: int = 0,
    detector: Optional[str] = None,
    request_method: Optional[str] = None,
    request_query: Optional[str] = None,
    request_headers: Optional[dict[str, Any]] = None,
    request_body: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    country: Optional[str] = None,
    city: Optional[str] = None,
    tool_hint: Optional[str] = None,
    behavior_pattern: Optional[str] = None,
    frequency_1m: Optional[int] = None,
    attack_details: Optional[list[str]] = None,
) -> None:
    sql = """
    INSERT INTO attacks (
        session_id, attack_type, severity, payload, path,
        confidence, score, detector,
        request_method, request_query, request_headers, request_body,
        ip_address, user_agent, country, city,
        tool_hint, behavior_pattern, frequency_1m, attack_details
    ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11::jsonb, $12,
        $13, $14, $15, $16,
        $17, $18, $19, $20::jsonb
    )
    """
    async with _pool.acquire() as conn:
        await conn.execute(
            sql,
            session_id,
            attack_type,
            severity,
            payload,
            path,
            confidence,
            score,
            detector,
            request_method,
            request_query,
            json.dumps(request_headers or {}),
            request_body[:12000] if request_body else None,
            ip_address,
            user_agent,
            country,
            city,
            tool_hint,
            behavior_pattern,
            frequency_1m,
            json.dumps(attack_details or []),
        )


async def log_snapshot(
    session_id: str,
    path: str,
    html: str,
    viewport_width: int,
    viewport_height: int,
    scroll_x: int = 0,
    scroll_y: int = 0,
    captured_at: Optional[datetime] = None,
) -> None:
    """
    يخزن DOM snapshot للصفحة — UPSERT بحيث يُحدَّث إذا زار نفس الـ path مجدداً.
    """
    sql = """
    INSERT INTO page_snapshots
        (session_id, path, html, viewport_width, viewport_height, scroll_x, scroll_y, timestamp)
    VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
    """
    async with _pool.acquire() as conn:
        await conn.execute(
            sql,
            session_id,
            path,
            html[:2_000_000],  # حد أقصى 2MB
            viewport_width,
            viewport_height,
            scroll_x,
            scroll_y,
            captured_at,
        )


async def log_upload(
    session_id: str,
    original_name: str,
    mime_type: str,
    size_bytes: int,
    saved_path: str,
    upload_field: str,
) -> int:
    sql = """
    INSERT INTO captured_uploads
        (session_id, original_name, mime_type, size_bytes, saved_path, upload_field)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
    """
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            sql, session_id, original_name, mime_type,
            size_bytes, saved_path, upload_field
        )
    return row["id"]


async def update_snapshot_viewport(
    session_id: str,
    path: str,
    viewport_width: int,
    viewport_height: int,
    scroll_x: int,
    scroll_y: int,
) -> None:
    """
    يُحدّث أبعاد الشاشة الحقيقية على آخر snapshot للـ path في هذه الجلسة.
    يُستدعى عندما يُرسل الـ browser أبعاده الحقيقية بعد تحميل الصفحة.
    """
    sql = """
    UPDATE page_snapshots
    SET viewport_width  = $3,
        viewport_height = $4,
        scroll_x        = $5,
        scroll_y        = $6
    WHERE id = (
        SELECT id FROM page_snapshots
        WHERE session_id = $1 AND path = $2
        ORDER BY timestamp DESC
        LIMIT 1
    )
    """
    async with _pool.acquire() as conn:
        await conn.execute(
            sql, session_id, path,
            viewport_width, viewport_height,
            scroll_x, scroll_y,
        )


async def mark_session_ended(session_id: str) -> None:
    sql = """
    UPDATE sessions
    SET ended_at = COALESCE(ended_at, NOW())
    WHERE id = $1
    """
    async with _pool.acquire() as conn:
        await conn.execute(sql, session_id)


async def get_ip_blocking_settings() -> dict[str, Any]:
    sql = """
    SELECT enabled, request_threshold
    FROM ip_blocking_settings
    WHERE id = 1
    LIMIT 1
    """
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(sql)
        if not row:
            return {"enabled": False, "request_threshold": 12}
        return {
            "enabled": bool(row["enabled"]),
            "request_threshold": int(row["request_threshold"] or 12),
        }


async def is_ip_blocked(ip_address: str) -> bool:
    sql = """
    SELECT 1
    FROM blocked_ips
    WHERE ip_address = $1
    LIMIT 1
    """
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(sql, ip_address)
        return bool(row)


async def block_ip(ip_address: str, reason: Optional[str], hit_count: int) -> None:
    sql = """
    INSERT INTO blocked_ips (ip_address, reason, hit_count, first_blocked_at, last_seen_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    ON CONFLICT (ip_address)
    DO UPDATE SET
        reason = COALESCE(EXCLUDED.reason, blocked_ips.reason),
        hit_count = GREATEST(blocked_ips.hit_count, EXCLUDED.hit_count),
        last_seen_at = NOW()
    """
    async with _pool.acquire() as conn:
        await conn.execute(
            sql,
            (ip_address or "")[:120],
            ((reason or "")[:300] or None),
            max(0, int(hit_count or 0)),
        )


async def log_wp_login_attempt(
    session_id: str,
    username: Optional[str],
    ip_address: Optional[str],
    status: str,
    user_agent: Optional[str],
) -> None:
    sql = """
    INSERT INTO wp_login_attempts (session_id, username, ip_address, status, user_agent)
    VALUES ($1, $2, $3, $4, $5)
    """
    async with _pool.acquire() as conn:
        await conn.execute(
            sql,
            session_id,
            (username or "")[:120] or None,
            ip_address,
            status,
            (user_agent or "")[:500] or None,
        )


async def set_recording_consent(session_id: str, consent_given: bool) -> None:
    sql = """
    INSERT INTO recording_consents (session_id, consent_given)
    VALUES ($1, $2)
    ON CONFLICT (session_id)
    DO UPDATE SET consent_given = EXCLUDED.consent_given, updated_at = NOW()
    """
    async with _pool.acquire() as conn:
        await conn.execute(sql, session_id, consent_given)


async def has_recording_consent(session_id: str) -> bool:
    sql = """
    SELECT consent_given
    FROM recording_consents
    WHERE session_id = $1
    LIMIT 1
    """
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(sql, session_id)
        return bool(row and row["consent_given"])


async def log_session_recording(
    session_id: str,
    saved_path: str,
    mime_type: Optional[str],
    size_bytes: int,
) -> int:
    sql = """
    INSERT INTO session_recordings (session_id, saved_path, mime_type, size_bytes)
    VALUES ($1, $2, $3, $4)
    RETURNING id
    """
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(sql, session_id, saved_path, mime_type, size_bytes)
    return row["id"]


async def get_admin_emails() -> list[str]:
    sql = """
    SELECT email
    FROM users
    WHERE role = 'admin'
    ORDER BY created_at ASC
    LIMIT 100
    """
    try:
        async with _pool.acquire() as conn:
            rows = await conn.fetch(sql)
    except Exception:
        return []
    emails = []
    for row in rows:
        email = str(row["email"] or "").strip()
        if email:
            emails.append(email[:180])
    return emails


async def get_attack_summary(hours_back: int = 24) -> dict[str, Any]:
    interval_hours = max(1, min(168, int(hours_back)))
    sql_attacks_total = """
    SELECT COUNT(*)::bigint AS total
    FROM attacks
    WHERE timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
    """
    sql_sessions_total = """
    SELECT COUNT(DISTINCT session_id)::bigint AS total
    FROM attacks
    WHERE timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
    """
    sql_requests_total = """
    SELECT COUNT(*)::bigint AS total
    FROM requests
    WHERE timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
    """
    sql_by_type = """
    SELECT attack_type, COUNT(*)::bigint AS count
    FROM attacks
    WHERE timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
    GROUP BY attack_type
    ORDER BY count DESC
    LIMIT 8
    """
    sql_top_ips = """
    SELECT COALESCE(ip_address, 'unknown') AS ip, COUNT(*)::bigint AS count
    FROM attacks
    WHERE timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
    GROUP BY COALESCE(ip_address, 'unknown')
    ORDER BY count DESC
    LIMIT 8
    """

    async with _pool.acquire() as conn:
        attacks_total = await conn.fetchrow(sql_attacks_total, interval_hours)
        sessions_total = await conn.fetchrow(sql_sessions_total, interval_hours)
        requests_total = await conn.fetchrow(sql_requests_total, interval_hours)
        by_type_rows = await conn.fetch(sql_by_type, interval_hours)
        top_ip_rows = await conn.fetch(sql_top_ips, interval_hours)

    return {
        "hours_back": interval_hours,
        "attacks_total": int(attacks_total["total"]) if attacks_total else 0,
        "sessions_total": int(sessions_total["total"]) if sessions_total else 0,
        "requests_total": int(requests_total["total"]) if requests_total else 0,
        "by_type": [
            {"attack_type": str(r["attack_type"] or "unknown"), "count": int(r["count"] or 0)}
            for r in by_type_rows
        ],
        "top_ips": [
            {"ip": str(r["ip"] or "unknown"), "count": int(r["count"] or 0)}
            for r in top_ip_rows
        ],
    }
