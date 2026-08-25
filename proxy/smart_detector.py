"""AI-driven attack analysis service for the proxy.

This module replaces the legacy signature-heavy detector with an async AI-backed
analysis flow. It keeps the old public interface names so integration remains
simple, while moving primary attack classification to the AI service.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib.parse import parse_qsl

import httpx


ALLOWED_ATTACK_TYPES = {
    "SQL_INJECTION",
    "XSS",
    "PATH_TRAVERSAL",
    "COMMAND_INJECTION",
    "BRUTE_FORCE",
    "WP_SCAN",
    "SCANNER_DETECTED",
}


@dataclass
class AttackResult:
    is_attack: bool
    attack_type: Optional[str]
    severity: Optional[str]
    matched_payload: Optional[str]
    confidence: float = 0.0
    score: int = 0
    details: list[str] = field(default_factory=list)
    detector: str = "ai-analysis"
    tool_hint: Optional[str] = None
    behavior_pattern: Optional[str] = None
    frequency_1m: Optional[int] = None


@dataclass
class BehaviorSignal:
    score: int
    details: list[str]
    frequency_1m: int


@dataclass
class _IPProfile:
    ewma_rpm: float = 0.0
    baseline_rpm: float = 0.0
    baseline_samples: int = 0
    distinct_paths: set[str] = field(default_factory=set)
    last_ts: float = field(default_factory=time.monotonic)
    last_minute_start: float = field(default_factory=time.monotonic)
    requests_this_minute: int = 0


@dataclass
class _Bucket:
    tokens: float = 10.0
    last_refill: float = field(default_factory=time.monotonic)


@dataclass
class _CacheEntry:
    result: AttackResult
    expires_at: float


_ALPHA = 0.3
_SPIKE_FACTOR = 5.0
_DIVERSITY_THRESHOLD = 15
_ip_profiles: dict[str, _IPProfile] = defaultdict(_IPProfile)

_BUCKET_CAPACITY = 10.0
_BUCKET_REFILL_RATE = 1.0 / 12.0
_login_buckets: dict[str, _Bucket] = defaultdict(_Bucket)

_STATIC_EXTENSIONS = (
    ".js",
    ".css",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".woff",
    ".woff2",
    ".ttf",
    ".ico",
    ".map",
    ".webp",
)

_BENIGN_PATH_RE = re.compile(
    r"^/wp-content/(themes|uploads)/"
    r"|^/wp-includes/(js|css|images|fonts)/"
    r"|^/(favicon\.ico|robots\.txt|sitemap\.xml)$",
    re.IGNORECASE,
)

_SENSITIVE_KEY_RE = re.compile(
    r"(pass(word)?|token|secret|auth|key|cookie|session|csrf|jwt|email|phone|address|ssn|credit|card|cc|dob)",
    re.IGNORECASE,
)
_BEARER_RE = re.compile(r"(?i)bearer\s+[a-z0-9._\-]+")
_LONG_HEX_RE = re.compile(r"\b[a-f0-9]{24,}\b", re.IGNORECASE)


def _severity_to_score(severity: Optional[str]) -> int:
    mapping = {
        "low": 30,
        "medium": 55,
        "high": 78,
        "critical": 95,
    }
    return mapping.get((severity or "").lower(), 0)


def _normalize_severity(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    low = value.lower().strip()
    if low in {"low", "medium", "high", "critical"}:
        return low
    return None


def _clamp_confidence(value: Any) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0.0
    if v > 1.0:
        v = v / 100.0
    return round(max(0.0, min(1.0, v)), 3)


def _sanitize_text(value: str, max_len: int = 240) -> str:
    text = (value or "").replace("\x00", "")
    text = _BEARER_RE.sub("Bearer [REDACTED]", text)
    text = _LONG_HEX_RE.sub("[HEX_REDACTED]", text)
    text = text.strip()
    if len(text) > max_len:
        return text[:max_len] + "..."
    return text


def _safe_header_snapshot(headers: dict[str, str]) -> dict[str, str]:
    allowed = {
        "user-agent",
        "accept",
        "accept-language",
        "content-type",
        "referer",
        "origin",
    }
    out: dict[str, str] = {}
    for key in allowed:
        if key in headers:
            out[key] = _sanitize_text(headers[key], 200)
    return out


def _structured_activity(
    method: str,
    path: str,
    query_string: str,
    headers: dict,
    body: str,
    client_ip: Optional[str],
    activity_context: Optional[dict[str, Any]],
) -> dict[str, Any]:
    query_items = parse_qsl(query_string, keep_blank_values=True)
    safe_query: list[dict[str, str]] = []
    for k, v in query_items[:15]:
        if _SENSITIVE_KEY_RE.search(k):
            safe_query.append({"key": _sanitize_text(k, 64), "value": "[REDACTED]"})
        else:
            safe_query.append({"key": _sanitize_text(k, 64), "value": _sanitize_text(v, 120)})

    body_preview = _sanitize_text(body, 320)
    if _SENSITIVE_KEY_RE.search(body_preview):
        body_preview = "[REDACTED_CONTENT]"

    return {
        "timestamp": int(time.time()),
        "method": method.upper(),
        "path": _sanitize_text(path, 220),
        "query": {
            "item_count": len(query_items),
            "items": safe_query,
            "length": len(query_string or ""),
        },
        "body": {
            "length": len(body or ""),
            "preview": body_preview,
        },
        "client": {
            "ip_prefix": (client_ip or "unknown").split(".")[0],
            "user_agent": _sanitize_text(headers.get("user-agent", ""), 200),
        },
        "headers": _safe_header_snapshot(headers),
        "activity": activity_context or {},
    }


def _is_benign_static(method: str, path: str) -> bool:
    if method.upper() not in {"GET", "HEAD"}:
        return False
    path_lower = path.lower().split("?", 1)[0]
    if any(path_lower.endswith(ext) for ext in _STATIC_EXTENSIONS):
        return True
    if _BENIGN_PATH_RE.match(path):
        return True
    return False


def _fallback_heuristic(activity: dict[str, Any]) -> AttackResult:
    method = str(activity.get("method", "GET"))
    path = str(activity.get("path", ""))
    query_blob = " ".join(
        f"{i.get('key','')}={i.get('value','')}" for i in activity.get("query", {}).get("items", [])
    )
    body_preview = str(activity.get("body", {}).get("preview", ""))
    ua = str(activity.get("client", {}).get("user_agent", "")).lower()
    surface = f"{path} {query_blob} {body_preview}".lower()

    if "sqlmap" in ua or "nmap" in ua or "nikto" in ua:
        return AttackResult(
            True,
            "SCANNER_DETECTED",
            "high",
            "scanner-ua",
            confidence=0.82,
            score=82,
            details=["Fallback: known scanner user-agent signature"],
            detector="fallback-heuristic",
            tool_hint="scanner",
        )

    checks = [
        ("SQL_INJECTION", "critical", ("union select", " or 1=1", "sleep(", "benchmark(")),
        ("XSS", "high", ("<script", "javascript:", "onerror=", "document.cookie")),
        ("PATH_TRAVERSAL", "high", ("../", "..\\", "%2e%2e", "/etc/passwd")),
        ("COMMAND_INJECTION", "critical", ("; whoami", "&&", "$(", "`")),
        ("WP_SCAN", "medium", ("xmlrpc.php", "wp-admin", "wp-login.php", "wp-config.php")),
    ]

    for attack_type, severity, markers in checks:
        if any(marker in surface for marker in markers):
            sev_score = _severity_to_score(severity)
            return AttackResult(
                True,
                attack_type,
                severity,
                markers[0],
                confidence=round(sev_score / 100.0, 3),
                score=sev_score,
                details=["Fallback: lexical threat marker matched"],
                detector="fallback-heuristic",
            )

    return AttackResult(False, None, None, None)


class _AIAnalyzer:
    def __init__(self) -> None:
        self.token = os.environ.get("GITHUB_TOKEN", "").strip()
        self.endpoint = os.environ.get(
            "GITHUB_MODELS_URL", "https://models.inference.ai.azure.com/chat/completions"
        )
        self.model = os.environ.get("GITHUB_MODEL", "gpt-4o")
        self.timeout = float(os.environ.get("AI_ANALYSIS_TIMEOUT", "3.0"))
        self.max_concurrency = max(2, int(os.environ.get("AI_ANALYSIS_MAX_CONCURRENCY", "20")))
        self.cache_ttl = max(3.0, float(os.environ.get("AI_ANALYSIS_CACHE_TTL", "10")))
        self._semaphore = asyncio.Semaphore(self.max_concurrency)
        self._cache: dict[str, _CacheEntry] = {}
        self._client: Optional[httpx.AsyncClient] = None

    def is_enabled(self) -> bool:
        return bool(self.token)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            limits = httpx.Limits(max_keepalive_connections=40, max_connections=80)
            self._client = httpx.AsyncClient(timeout=self.timeout, limits=limits)
        return self._client

    def _cache_key(self, activity: dict[str, Any]) -> str:
        raw = json.dumps(activity, sort_keys=True, ensure_ascii=True)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _cleanup_cache(self) -> None:
        now = time.time()
        expired = [k for k, v in self._cache.items() if v.expires_at <= now]
        for key in expired:
            self._cache.pop(key, None)

    def _build_messages(self, activity: dict[str, Any]) -> list[dict[str, str]]:
        system_prompt = (
            "You are a cybersecurity traffic classifier for a honeypot proxy. "
            "Decide if a request is malicious using only the provided structured activity. "
            "Never invent missing fields. Return JSON only."
        )
        user_prompt = (
            "Classify this activity and provide threat insight.\n"
            "Allowed attack_type values: SQL_INJECTION, XSS, PATH_TRAVERSAL, COMMAND_INJECTION, "
            "BRUTE_FORCE, WP_SCAN, SCANNER_DETECTED, NONE.\n"
            "Return strict JSON with keys: is_attack(boolean), attack_type(string), severity(string), "
            "confidence(number 0..1), score(number 0..100), matched_payload(string), details(array of strings), "
            "tool_hint(string|null), behavior_pattern(string|null).\n"
            f"activity={json.dumps(activity, ensure_ascii=True)}"
        )
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

    @staticmethod
    def _parse_message_content(data: dict[str, Any]) -> dict[str, Any]:
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "{}")
        if isinstance(content, dict):
            return content
        if isinstance(content, list):
            content = "".join(
                str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in content
            )
        cleaned = str(content).replace("```json", "").replace("```", "").strip()
        return json.loads(cleaned)

    @staticmethod
    def _to_result(ai_data: dict[str, Any]) -> AttackResult:
        attack_type = str(ai_data.get("attack_type") or "NONE").strip().upper()
        is_attack = bool(ai_data.get("is_attack", False)) and attack_type in ALLOWED_ATTACK_TYPES
        severity = _normalize_severity(ai_data.get("severity"))
        if not severity and is_attack:
            severity = "medium"

        confidence = _clamp_confidence(ai_data.get("confidence", 0.0))
        score = int(max(0, min(100, ai_data.get("score", 0) or 0)))
        if score == 0 and severity:
            score = _severity_to_score(severity)

        details = ai_data.get("details", [])
        if not isinstance(details, list):
            details = [str(details)]
        details = [_sanitize_text(str(d), 180) for d in details[:6] if str(d).strip()]

        if not is_attack:
            return AttackResult(False, None, None, None, detector="ai-analysis")

        return AttackResult(
            is_attack=True,
            attack_type=attack_type,
            severity=severity,
            matched_payload=_sanitize_text(str(ai_data.get("matched_payload", "")), 180) or None,
            confidence=confidence,
            score=score,
            details=details,
            detector="ai-analysis",
            tool_hint=(str(ai_data.get("tool_hint")) if ai_data.get("tool_hint") else None),
            behavior_pattern=(
                str(ai_data.get("behavior_pattern")) if ai_data.get("behavior_pattern") else None
            ),
        )

    async def analyze(
        self, activity: dict[str, Any], client: Optional[httpx.AsyncClient] = None
    ) -> AttackResult:
        if not self.is_enabled():
            return _fallback_heuristic(activity)

        self._cleanup_cache()
        cache_key = self._cache_key(activity)
        now = time.time()
        cached = self._cache.get(cache_key)
        if cached and cached.expires_at > now:
            return cached.result

        async with self._semaphore:
            http_client = client or await self._get_client()
            try:
                response = await http_client.post(
                    self.endpoint,
                    headers={
                        "Authorization": f"Bearer {self.token}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "temperature": 0.1,
                        "max_tokens": 300,
                        "response_format": {"type": "json_object"},
                        "messages": self._build_messages(activity),
                    },
                )
                response.raise_for_status()
                ai_raw = response.json()
                ai_data = self._parse_message_content(ai_raw)
                result = self._to_result(ai_data)
            except Exception:
                result = _fallback_heuristic(activity)

            self._cache[cache_key] = _CacheEntry(result=result, expires_at=now + self.cache_ttl)
            return result


_AI = _AIAnalyzer()


def _update_ewma_profile(ip: str, path: str) -> _IPProfile:
    now = time.monotonic()
    profile = _ip_profiles[ip]
    elapsed = max(now - profile.last_ts, 0.001)
    instant_rpm = 60.0 / elapsed

    if profile.ewma_rpm == 0:
        profile.ewma_rpm = instant_rpm
    else:
        profile.ewma_rpm = _ALPHA * instant_rpm + (1 - _ALPHA) * profile.ewma_rpm

    profile.distinct_paths.add(path)
    profile.last_ts = now

    if (now - profile.last_minute_start) >= 60:
        profile.last_minute_start = now
        profile.requests_this_minute = 0
    profile.requests_this_minute += 1

    if profile.baseline_samples < 10:
        profile.baseline_rpm = (
            (profile.baseline_rpm * profile.baseline_samples + instant_rpm)
            / (profile.baseline_samples + 1)
        )
        profile.baseline_samples += 1

    return profile


def check_behavioral_anomaly(ip: str, path: str) -> Optional[BehaviorSignal]:
    profile = _update_ewma_profile(ip, path)

    evidence: list[str] = []
    score = 0

    if profile.baseline_samples >= 5 and profile.baseline_rpm > 0:
        ratio = profile.ewma_rpm / profile.baseline_rpm
        if ratio >= _SPIKE_FACTOR:
            bump = int(min(80, ratio * 10))
            score += bump
            evidence.append(f"Rate spike x{ratio:.1f} above baseline (+{bump})")

    unique_paths = len(profile.distinct_paths)
    if unique_paths >= _DIVERSITY_THRESHOLD:
        bump = min(60, (unique_paths - _DIVERSITY_THRESHOLD) * 4 + 30)
        score += bump
        evidence.append(f"Path diversity: {unique_paths} unique paths (+{bump})")

    if score <= 0:
        return None

    return BehaviorSignal(
        score=score,
        details=evidence,
        frequency_1m=max(1, profile.requests_this_minute),
    )


def check_brute_force(ip: str, path: str, method: str) -> Optional[AttackResult]:
    is_login = any(kw in path.lower() for kw in ("login", "wp-login", "signin", "admin", "auth"))
    if not (is_login and method.upper() == "POST"):
        return None

    now = time.monotonic()
    bucket = _login_buckets[ip]

    elapsed = now - bucket.last_refill
    bucket.tokens = min(_BUCKET_CAPACITY, bucket.tokens + elapsed * _BUCKET_REFILL_RATE)
    bucket.last_refill = now
    bucket.tokens -= 1.0

    if bucket.tokens >= 0:
        return None

    deficit = abs(bucket.tokens)
    severity = "critical" if deficit > 5 else "high"
    score = int(min(100, 65 + deficit * 8))
    return AttackResult(
        is_attack=True,
        attack_type="BRUTE_FORCE",
        severity=severity,
        matched_payload=f"Token bucket deficit: {deficit:.1f}",
        confidence=round(score / 100.0, 3),
        score=score,
        details=[f"Login attempts exceed sustained limit for IP {ip}"],
        detector="token-bucket",
        behavior_pattern="login-rate-spike",
    )


async def detect_attack(
    method: str,
    path: str,
    query_string: str,
    headers: dict,
    body: str,
    *,
    client_ip: Optional[str] = None,
    ai_client: Optional[httpx.AsyncClient] = None,
    activity_context: Optional[dict[str, Any]] = None,
) -> AttackResult:
    if _is_benign_static(method, path):
        return AttackResult(False, None, None, None)

    activity = _structured_activity(
        method,
        path,
        query_string,
        headers,
        body,
        client_ip,
        activity_context,
    )
    return await _AI.analyze(activity, client=ai_client)


async def close_ai_client() -> None:
    await _AI.close()
