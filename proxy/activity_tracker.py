"""In-memory, non-sensitive activity aggregation for AI analysis."""

from __future__ import annotations

import time
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SessionActivity:
    started_at: float = field(default_factory=time.time)
    page_visits: Counter[str] = field(default_factory=Counter)
    methods: Counter[str] = field(default_factory=Counter)
    requests_1m: deque[float] = field(default_factory=deque)
    interactions_1m: deque[float] = field(default_factory=deque)
    interactions_by_type: Counter[str] = field(default_factory=Counter)
    login_attempts: int = 0
    failed_logins: int = 0


_store: dict[str, SessionActivity] = defaultdict(SessionActivity)


def _trim_window(q: deque[float], now: float, window_seconds: float = 60.0) -> None:
    while q and (now - q[0]) > window_seconds:
        q.popleft()


def record_request(session_id: str, path: str, method: str) -> None:
    now = time.time()
    s = _store[session_id]
    s.page_visits[path or "/"] += 1
    s.methods[(method or "GET").upper()] += 1
    s.requests_1m.append(now)
    _trim_window(s.requests_1m, now)


def record_events(session_id: str, events: list[dict[str, Any]]) -> None:
    now = time.time()
    s = _store[session_id]
    for ev in events:
        et = str(ev.get("t") or ev.get("type") or "unknown")
        s.interactions_by_type[et] += 1
        s.interactions_1m.append(now)
    _trim_window(s.interactions_1m, now)


def record_login_attempt(session_id: str, status: str) -> None:
    s = _store[session_id]
    s.login_attempts += 1
    if status == "failure":
        s.failed_logins += 1


def snapshot(session_id: str) -> dict[str, Any]:
    now = time.time()
    s = _store[session_id]
    _trim_window(s.requests_1m, now)
    _trim_window(s.interactions_1m, now)

    top_pages = [
        {"path": p, "count": c}
        for p, c in s.page_visits.most_common(8)
    ]
    method_counts = [{"method": m, "count": c} for m, c in s.methods.most_common()]

    return {
        "duration_seconds": int(max(0, now - s.started_at)),
        "pages_visited_total": int(sum(s.page_visits.values())),
        "unique_pages": int(len(s.page_visits)),
        "top_pages": top_pages,
        "method_distribution": method_counts,
        "request_pattern": {
            "requests_last_minute": len(s.requests_1m),
        },
        "interaction_frequency": {
            "interactions_last_minute": len(s.interactions_1m),
            "types": [{"type": t, "count": c} for t, c in s.interactions_by_type.most_common()],
        },
        "login_activity": {
            "attempts": s.login_attempts,
            "failed_attempts": s.failed_logins,
        },
    }
