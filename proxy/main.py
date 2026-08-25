# honeypot/proxy/main.py
"""
Honeypot Proxy – Main Entry Point
FastAPI reverse proxy that sits in front of WordPress,
intercepts traffic, records behavior, classifies attacks,
and serves replay-ready snapshots.
"""

import asyncio
import json
import logging
import os
import re
import smtplib
import time
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo
from typing import Optional
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from logger import (
    block_ip,
    bootstrap_schema,
    get_admin_emails,
    get_attack_summary,
    get_ip_blocking_settings,
    get_pool,
    has_recording_consent,
    is_ip_blocked,
    log_attack,
    log_events_batch,
    log_session_recording,
    log_request,
    log_snapshot,
    log_upload,
    log_wp_login_attempt,
    mark_session_ended,
    set_recording_consent,
    set_pool,
    update_snapshot_viewport,
    upsert_session,
)
from activity_tracker import (
    record_events as activity_record_events,
    record_login_attempt,
    record_request as activity_record_request,
    snapshot as activity_snapshot,
)
from session_manager import (
    SESSION_COOKIE,
    SESSION_QUERY_PARAM,
    extract_cookie_session_id,
    is_valid_session_id,
    new_session_id,
)
from smart_detector import (
    check_behavioral_anomaly,
    check_brute_force,
    close_ai_client,
    detect_attack,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

WORDPRESS_URL = os.environ.get("WORDPRESS_URL", "http://wordpress:80")
PROXY_PUBLIC_URL = os.environ.get("PROXY_PUBLIC_URL", "http://localhost:8001")
UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

_wp_internal = WORDPRESS_URL.rstrip("/")
_wp_host_only = _wp_internal.replace("http://", "").replace("https://", "")
_proxy_public = PROXY_PUBLIC_URL.rstrip("/")
_proxy_host_only = _proxy_public.replace("http://", "").replace("https://", "")

_SESSION_MAP_TTL_SECONDS = 60 * 60 * 6
_tab_session_map: dict[str, tuple[str, float]] = {}
_attack_windows: dict[str, deque[float]] = defaultdict(deque)
_request_windows: dict[str, deque[float]] = defaultdict(deque)

_SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
_SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
_SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "").strip()
_SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "").strip()
_SMTP_FROM = os.environ.get("SMTP_FROM", _SMTP_USERNAME or "").strip()
_SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").strip().lower() in {"1", "true", "yes", "on"}
_ALERT_EMAIL_TO = os.environ.get("ALERT_EMAIL_TO", "").strip()

_EMAIL_REPEAT_THRESHOLD = max(1, int(os.environ.get("EMAIL_ALERT_REPEAT_THRESHOLD", "25")))
_EMAIL_REPEAT_WINDOW_SECONDS = max(10, int(os.environ.get("EMAIL_ALERT_REPEAT_WINDOW_SECONDS", "60")))
_EMAIL_ALERT_COOLDOWN_SECONDS = max(30, int(os.environ.get("EMAIL_ALERT_COOLDOWN_SECONDS", "900")))
_EMAIL_REPEAT_ALERT_ENABLED = os.environ.get("EMAIL_ALERT_REPEAT_ENABLED", "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
_EMAIL_IP_BLOCK_ALERT_ENABLED = os.environ.get("EMAIL_ALERT_IP_BLOCK_ENABLED", "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
_DAILY_AI_REPORT_ENABLED = os.environ.get("EMAIL_DAILY_AI_REPORT_ENABLED", "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
_DAILY_AI_REPORT_HOUR = max(0, min(23, int(os.environ.get("EMAIL_DAILY_REPORT_HOUR", "8"))))
_DAILY_AI_REPORT_MINUTE = max(0, min(59, int(os.environ.get("EMAIL_DAILY_REPORT_MINUTE", "0"))))
_ALERT_TIMEZONE = os.environ.get("ALERT_TIMEZONE", "UTC").strip() or "UTC"
_DAILY_REPORT_LOOKBACK_HOURS = max(1, min(168, int(os.environ.get("EMAIL_DAILY_REPORT_HOURS_BACK", "24"))))

_repeat_alert_last_sent: dict[str, float] = {}
_daily_report_last_sent_date: Optional[str] = None
_shutdown_event = asyncio.Event()

_IGNORE_REQUEST_PATHS = {
    "/favicon.ico",
    "/robots.txt",
}

_IGNORE_STATIC_EXTENSIONS = (
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

_SENSITIVE_FIELD_RE = re.compile(
    r"(pass(word)?|pwd|token|secret|auth|cookie|session|csrf|key|email|phone|address|ssn|credit|card|cc|dob)",
    re.IGNORECASE,
)


def _sanitize_text(value: str, max_len: int = 800) -> str:
    clean = (value or "").replace("\x00", "").strip()
    return clean[:max_len]


def _sanitize_headers_for_log(headers: dict[str, str]) -> dict[str, str]:
    redacted = {}
    for key, value in headers.items():
        kl = key.lower()
        if kl in {"authorization", "cookie", "set-cookie", "x-api-key"}:
            redacted[key] = "[REDACTED]"
        else:
            redacted[key] = _sanitize_text(str(value), 500)
    return redacted


def _sanitize_cookies_for_log(cookies: dict[str, str]) -> dict[str, str]:
    return {k: "[REDACTED]" for k in cookies.keys()}


def _sanitize_body_for_log(content_type: str, body: str) -> str:
    if not body:
        return ""

    ctype = (content_type or "").lower()
    raw = _sanitize_text(body, 4000)

    if "application/x-www-form-urlencoded" in ctype:
        items = parse_qsl(raw, keep_blank_values=True)
        safe = []
        for k, v in items:
            if _SENSITIVE_FIELD_RE.search(k):
                safe.append((k, "[REDACTED]"))
            else:
                safe.append((k, _sanitize_text(v, 150)))
        return urlencode(safe, doseq=True)

    if "application/json" in ctype:
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                out = {}
                for k, v in data.items():
                    if _SENSITIVE_FIELD_RE.search(k):
                        out[k] = "[REDACTED]"
                    else:
                        out[k] = _sanitize_text(str(v), 150)
                return json.dumps(out, ensure_ascii=True)
        except Exception:
            pass

    return raw


def _sanitize_events(events: list[dict]) -> list[dict]:
    safe_events: list[dict] = []
    for ev in events[:1000]:
        if not isinstance(ev, dict):
            continue
        t = str(ev.get("t") or ev.get("type") or "unknown")[:20]
        entry = {
            "t": t,
            "ts": ev.get("ts"),
            "x": ev.get("x"),
            "y": ev.get("y"),
            "sx": ev.get("sx"),
            "sy": ev.get("sy"),
            "vw": ev.get("vw"),
            "vh": ev.get("vh"),
            "name": _sanitize_text(str(ev.get("name") or ""), 120) or None,
            "id": _sanitize_text(str(ev.get("id") or ""), 120) or None,
            "tag": _sanitize_text(str(ev.get("tag") or ""), 40) or None,
            "type": _sanitize_text(str(ev.get("type") or ""), 40) or None,
            "sel": _sanitize_text(str(ev.get("sel") or ""), 200) or None,
        }
        if t == "key":
            field_name = _sanitize_text(str(ev.get("field") or "unknown"), 80)
            entry["field"] = field_name
            entry["val"] = _sanitize_text(str(ev.get("val") or ""), 120)
        safe_events.append(entry)
    return safe_events


def _smtp_ready() -> bool:
    return bool(_SMTP_HOST and _SMTP_PORT > 0 and _SMTP_FROM)


def _parse_recipients(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


async def _resolve_alert_recipients() -> list[str]:
    env_recipients = _parse_recipients(_ALERT_EMAIL_TO)
    if env_recipients:
        return env_recipients[:20]

    db_admins = await get_admin_emails()
    if db_admins:
        return db_admins[:20]
    return []


def _send_email_sync(subject: str, text_body: str, recipients: list[str]) -> None:
    if not recipients:
        return
    msg = EmailMessage()
    msg["Subject"] = subject[:220]
    msg["From"] = _SMTP_FROM
    msg["To"] = ", ".join(recipients[:50])
    msg.set_content(text_body[:200000])

    with smtplib.SMTP(_SMTP_HOST, _SMTP_PORT, timeout=15) as smtp:
        smtp.ehlo()
        if _SMTP_USE_TLS:
            smtp.starttls()
            smtp.ehlo()
        if _SMTP_USERNAME and _SMTP_PASSWORD:
            smtp.login(_SMTP_USERNAME, _SMTP_PASSWORD)
        smtp.send_message(msg)


async def _send_email(subject: str, text_body: str) -> bool:
    if not _smtp_ready():
        return False
    recipients = await _resolve_alert_recipients()
    if not recipients:
        return False
    try:
        await asyncio.to_thread(_send_email_sync, subject, text_body, recipients)
        return True
    except Exception as e:
        logger.warning(f"Email send failed: {e}")
        return False


def _register_request_frequency(ip: str) -> int:
    now = time.time()
    win = _request_windows[ip]
    while win and (now - win[0]) > _EMAIL_REPEAT_WINDOW_SECONDS:
        win.popleft()
    win.append(now)
    return len(win)


def _safe_zone() -> ZoneInfo:
    try:
        return ZoneInfo(_ALERT_TIMEZONE)
    except Exception:
        return ZoneInfo("UTC")


async def _generate_ai_daily_report(summary: dict) -> str:
    if not summary:
        return "No data available."

    attacks_total = int(summary.get("attacks_total") or 0)
    sessions_total = int(summary.get("sessions_total") or 0)
    requests_total = int(summary.get("requests_total") or 0)
    by_type = summary.get("by_type") or []
    top_ips = summary.get("top_ips") or []
    hours_back = int(summary.get("hours_back") or _DAILY_REPORT_LOOKBACK_HOURS)

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    endpoint = os.environ.get("GITHUB_MODELS_URL", "https://models.inference.ai.azure.com/chat/completions")
    model = os.environ.get("GITHUB_MODEL", "gpt-4o")
    timeout = float(os.environ.get("AI_ANALYSIS_TIMEOUT", "6.0"))

    fallback_lines = [
        f"Daily Security Report (last {hours_back}h)",
        f"- Requests: {requests_total}",
        f"- Sessions: {sessions_total}",
        f"- Attacks: {attacks_total}",
        "",
        "Top attack types:",
    ]
    for item in by_type[:6]:
        fallback_lines.append(f"- {item.get('attack_type', 'unknown')}: {item.get('count', 0)}")
    fallback_lines.append("")
    fallback_lines.append("Top attacker IPs:")
    for item in top_ips[:6]:
        fallback_lines.append(f"- {item.get('ip', 'unknown')}: {item.get('count', 0)}")
    fallback = "\n".join(fallback_lines)

    if not token:
        return fallback

    prompt = {
        "hours_back": hours_back,
        "requests_total": requests_total,
        "sessions_total": sessions_total,
        "attacks_total": attacks_total,
        "top_attack_types": by_type[:8],
        "top_attacker_ips": top_ips[:8],
    }

    system_msg = (
        "You are a SOC analyst. Write a concise daily security report in plain text. "
        "Include: Executive summary, top attack patterns, risky sources, and 5 actionable recommendations."
    )
    user_msg = f"Analyze this honeypot summary and produce the report:\n{json.dumps(prompt, ensure_ascii=True)}"

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "temperature": 0.2,
                    "max_tokens": 1600,
                    "messages": [
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": user_msg},
                    ],
                },
            )
            resp.raise_for_status()
            raw = resp.json()
            content = (
                raw.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            cleaned = str(content or "").strip()
            return cleaned or fallback
    except Exception as e:
        logger.warning(f"Daily AI report generation failed: {e}")
        return fallback


async def _maybe_send_repeat_alert(ip: str, method: str, path: str, count_window: int) -> None:
    if not _EMAIL_REPEAT_ALERT_ENABLED:
        return
    if count_window < _EMAIL_REPEAT_THRESHOLD:
        return
    now = time.time()
    last_sent = _repeat_alert_last_sent.get(ip, 0.0)
    if (now - last_sent) < _EMAIL_ALERT_COOLDOWN_SECONDS:
        return
    _repeat_alert_last_sent[ip] = now

    subject = f"[HoneyShield] Repeated request spike from {ip}"
    body = (
        "HoneyShield detected repeated incoming requests from a single IP.\n\n"
        f"IP: {ip}\n"
        f"Window: {_EMAIL_REPEAT_WINDOW_SECONDS} seconds\n"
        f"Requests in window: {count_window}\n"
        f"Latest request: {method} {path}\n"
        f"Detected at (UTC): {datetime.utcnow().isoformat()}Z\n"
    )
    await _send_email(subject, body)


async def _maybe_send_block_alert(ip: str, reason: str, count_window: int) -> None:
    if not _EMAIL_IP_BLOCK_ALERT_ENABLED:
        return
    subject = f"[HoneyShield] IP blocked: {ip}"
    body = (
        "HoneyShield blocked an IP address automatically.\n\n"
        f"IP: {ip}\n"
        f"Reason: {reason}\n"
        f"Observed malicious frequency: {count_window}/min\n"
        f"Blocked at (UTC): {datetime.utcnow().isoformat()}Z\n"
    )
    await _send_email(subject, body)


async def _daily_report_worker() -> None:
    global _daily_report_last_sent_date
    zone = _safe_zone()
    while not _shutdown_event.is_set():
        try:
            if _DAILY_AI_REPORT_ENABLED:
                now_local = datetime.now(zone)
                day_key = now_local.strftime("%Y-%m-%d")
                due = now_local.hour == _DAILY_AI_REPORT_HOUR and now_local.minute >= _DAILY_AI_REPORT_MINUTE
                if due and _daily_report_last_sent_date != day_key:
                    summary = await get_attack_summary(_DAILY_REPORT_LOOKBACK_HOURS)
                    report_text = await _generate_ai_daily_report(summary)
                    sent = await _send_email(
                        f"[HoneyShield] Daily AI Security Report - {day_key}",
                        report_text,
                    )
                    if sent:
                        _daily_report_last_sent_date = day_key
        except Exception as e:
            logger.warning(f"Daily report worker error: {e}")

        try:
            await asyncio.wait_for(_shutdown_event.wait(), timeout=60.0)
        except asyncio.TimeoutError:
            pass

def _extract_wp_login_username(content_type: str, body: str) -> Optional[str]:
    if not body:
        return None
    ctype = (content_type or "").lower()
    if "application/x-www-form-urlencoded" not in ctype:
        return None
    params = dict(parse_qsl(body, keep_blank_values=True))
    user = params.get("log") or params.get("username") or params.get("user_login")
    return _sanitize_text(user or "", 120) or None


def _wp_login_status(response_status: int, response_headers: dict[str, str], body: bytes) -> str:
    location = (response_headers.get("location") or "").lower()
    body_low = body[:4000].decode("utf-8", errors="ignore").lower()
    if response_status in {301, 302, 303, 307, 308} and "wp-admin" in location:
        return "success"
    if "login_error" in body_low or "incorrect" in body_low or "invalid username" in body_low:
        return "failure"
    return "failure"


def rewrite_wp_urls(content: str) -> str:
    content = content.replace(_wp_internal + "/", _proxy_public + "/")
    content = content.replace(_wp_internal, _proxy_public)
    content = content.replace(_wp_host_only, _proxy_host_only)
    return content


def _clean_host(host: str) -> str:
    host = unquote((host or "").strip())
    host = host.replace("\r", "").replace("\n", "").strip()
    if not host:
        return _proxy_host_only
    if host.startswith(("http://", "https://")):
        parsed = urlsplit(host)
        host = parsed.netloc or parsed.path
    if "," in host:
        host = host.split(",", 1)[0].strip()
    host = host.strip(" ,")
    return host or _proxy_host_only


def _split_host_port(host: str) -> tuple[str, Optional[str]]:
    host = _clean_host(host)
    if host.startswith("[") and "]" in host:
        idx = host.find("]")
        h = host[: idx + 1]
        p = host[idx + 2 :] if len(host) > idx + 2 and host[idx + 1] == ":" else None
        return h, p
    if ":" in host:
        h, p = host.rsplit(":", 1)
        if p.isdigit():
            return h, p
    return host, None


def _should_skip_request_logging(method: str, path: str) -> bool:
    if method.upper() not in {"GET", "HEAD"}:
        return False
    only_path = path.split("?", 1)[0].lower()
    if only_path in _IGNORE_REQUEST_PATHS:
        return True
    if only_path.endswith(_IGNORE_STATIC_EXTENSIONS):
        return True
    return False


def _normalize_public_url(url_text: str, scheme: str, host: str) -> str:
    host = _clean_host(host)
    if not url_text:
        return url_text

    rewritten = rewrite_wp_urls(url_text)
    external_base = f"{scheme}://{host}"
    if external_base != _proxy_public:
        rewritten = rewritten.replace(_proxy_public, external_base)
        rewritten = rewritten.replace(_proxy_host_only, host)

    return rewritten


def _rewrite_redirect_location(value: str, scheme: str, host: str) -> str:
    value = unquote((value or "").strip())
    value = value.replace("\r", "").replace("\n", "").strip()
    if not value:
        return value

    # Handles malformed values such as:
    # "https://host-a, host-b/path"
    if "," in value:
        parts = [p.strip() for p in value.split(",") if p.strip()]
        if len(parts) > 1:
            candidate = unquote(parts[-1]).strip()
            candidate = candidate.lstrip()
            if candidate.startswith(("http://", "https://", "/")):
                value = candidate
            else:
                value = f"{scheme}://{candidate.lstrip('/')}"

    if value.startswith("/"):
        return f"{scheme}://{_clean_host(host)}{value}"

    try:
        parsed = urlsplit(value)
        if not parsed.scheme:
            return f"{scheme}://{_clean_host(host)}/{value.lstrip('/')}"

        netloc_host, _ = _split_host_port(parsed.netloc)
        wp_host, _ = _split_host_port(_wp_host_only)
        proxy_host, _ = _split_host_port(_proxy_host_only)
        request_host, request_port = _split_host_port(_clean_host(host))

        if netloc_host in {wp_host, proxy_host, request_host}:
            target_netloc = request_host
            if request_port:
                target_netloc = f"{request_host}:{request_port}"
            return urlunsplit((scheme, target_netloc, parsed.path, parsed.query, parsed.fragment))

        return _normalize_public_url(value, scheme, host)
    except Exception:
        return _normalize_public_url(value, scheme, host)


def _resolve_session_id(cookies: dict, tab_id: Optional[str]) -> tuple[str, bool, Optional[str]]:
    now = time.time()

    if tab_id and is_valid_session_id(tab_id):
        cached = _tab_session_map.get(tab_id)
        if cached and cached[1] > now:
            _tab_session_map[tab_id] = (cached[0], now + _SESSION_MAP_TTL_SECONDS)
            return cached[0], False, tab_id

        _tab_session_map[tab_id] = (tab_id, now + _SESSION_MAP_TTL_SECONDS)
        return tab_id, True, tab_id

    cookie_session = extract_cookie_session_id(cookies)
    if cookie_session:
        return cookie_session, False, None

    fresh = new_session_id()
    return fresh, True, None


def _register_attack_frequency(ip: str) -> int:
    now = time.time()
    win = _attack_windows[ip]
    while win and (now - win[0]) > 60:
        win.popleft()
    win.append(now)
    return len(win)


def _prune_tab_sessions() -> None:
    now = time.time()
    stale = [k for k, (_sid, exp) in _tab_session_map.items() if exp <= now]
    for key in stale:
        _tab_session_map.pop(key, None)


TRACKING_SCRIPT = """
<script id=\"hp-tracker\">
(function(){
  if(window.__hp_init) return;
  window.__hp_init = true;

  var TAB_PARAM = 'hp_tab';

  function getCookie(name){
    var m = document.cookie.match(new RegExp('(?:^|; )'+name+'=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function validUuid(v){
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
  }

  function uuidv4(){
    if(window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function toInt(v, fallback){
    var n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : fallback;
  }

  function nowMs(){ return Date.now(); }

  var sid = getCookie('hp_sid');
    if(!validUuid(sid)){
        sid = uuidv4();
    }

  var tabId = sessionStorage.getItem('hp_tab_id');
  if(!validUuid(tabId)){
        tabId = sid;
    sessionStorage.setItem('hp_tab_id', tabId);
  }
    sid = tabId;

  function normalizePathWithTab(urlLike){
    try {
      var u = new URL(urlLike, window.location.href);
      if(u.origin !== window.location.origin) return urlLike;
      u.searchParams.set(TAB_PARAM, tabId);
      return u.pathname + (u.search || '') + (u.hash || '');
    } catch (_err) {
      return urlLike;
    }
  }

  function pathNoTab(){
    try {
      var u = new URL(window.location.href);
      u.searchParams.delete(TAB_PARAM);
      return u.pathname + (u.search || '');
    } catch (_err) {
      return window.location.pathname + window.location.search;
    }
  }

  function ensureCurrentUrlHasTab(){
    try {
      var u = new URL(window.location.href);
      if(u.searchParams.get(TAB_PARAM) !== tabId){
        u.searchParams.set(TAB_PARAM, tabId);
        history.replaceState(history.state, document.title, u.pathname + (u.search || '') + (u.hash || ''));
      }
    } catch (_err) {}
  }

  ensureCurrentUrlHasTab();

  document.addEventListener('click', function(e){
    var node = e.target;
    while(node && node !== document){
      if(node.tagName && node.tagName.toLowerCase() === 'a' && node.href){
        try {
          var hu = new URL(node.href, window.location.href);
          if(hu.origin === window.location.origin){
            hu.searchParams.set(TAB_PARAM, tabId);
            node.href = hu.toString();
          }
        } catch (_err) {}
        break;
      }
      node = node.parentNode;
    }
  }, true);

  document.addEventListener('submit', function(e){
    var form = e.target;
    if(!form || !form.action) return;
    try {
      var fu = new URL(form.action, window.location.href);
      if(fu.origin === window.location.origin){
        fu.searchParams.set(TAB_PARAM, tabId);
        form.action = fu.toString();
      }
    } catch (_err) {}
  }, true);

  if(window.fetch){
    var __origFetch = window.fetch;
    window.fetch = function(resource, init){
      try {
        if(typeof resource === 'string') {
          resource = normalizePathWithTab(resource);
        }
      } catch (_err) {}
      return __origFetch.call(window, resource, init);
    };
  }

  if(window.XMLHttpRequest && window.XMLHttpRequest.prototype && window.XMLHttpRequest.prototype.open){
    var __xhrOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url){
      try {
        arguments[1] = normalizePathWithTab(url);
      } catch (_err) {}
      return __xhrOpen.apply(this, arguments);
    };
  }

    var currentPath = pathNoTab();
    var lastMouseTs = 0;
    var lastScrollTs = 0;
    var pending = [];
    var MAX_BATCH = 250;
    var isAdmin = /\/wp-admin\b/i.test(currentPath);
    var mouseThrottle = isAdmin ? 32 : 16;
    var scrollThrottle = isAdmin ? 50 : 25;
    var flushInterval = isAdmin ? 1000 : 700;
    var viewportInterval = isAdmin ? 3500 : 2200;
    var snapshotInterval = isAdmin ? 20000 : 9000;
    var syncInterval = isAdmin ? 2000 : 1200;

  function readViewport(){
    return {
      vw: toInt(window.innerWidth || document.documentElement.clientWidth, 1280),
      vh: toInt(window.innerHeight || document.documentElement.clientHeight, 720),
      sx: toInt(window.scrollX || window.pageXOffset || 0, 0),
      sy: toInt(window.scrollY || window.pageYOffset || 0, 0),
    };
  }

  function postJSON(url, payload, keepalive){
    try {
      fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
        keepalive: !!keepalive,
        credentials: 'same-origin'
      }).catch(function(){});
    } catch (_err) {}
  }

  function pushEvent(evt){
    pending.push(evt);
    if(pending.length >= MAX_BATCH){ flush(false); }
  }

  function flush(useKeepAlive){
    if(!pending.length) return;
    var copy = pending.splice(0, pending.length);
    postJSON('/hp-events', {
      session_id: sid,
      tab_id: tabId,
      path: currentPath,
      events: copy,
      sent_at: nowMs(),
    }, useKeepAlive);
  }

  function sendViewport(){
    var vp = readViewport();
    postJSON('/hp-viewport', {
      session_id: sid,
      tab_id: tabId,
      path: currentPath,
      viewport_width: vp.vw,
      viewport_height: vp.vh,
      scroll_x: vp.sx,
      scroll_y: vp.sy,
      ts: nowMs(),
    }, false);
  }

  function snapshotDom(reason){
    try {
      var vp = readViewport();
      postJSON('/hp-snapshot', {
        session_id: sid,
        tab_id: tabId,
        path: currentPath,
        html: document.documentElement ? document.documentElement.outerHTML : '',
        viewport_width: vp.vw,
        viewport_height: vp.vh,
        scroll_x: vp.sx,
        scroll_y: vp.sy,
        reason: reason || 'periodic',
        ts: nowMs(),
      }, false);
    } catch (_err) {}
  }

    function syncPath(){
    ensureCurrentUrlHasTab();
    var nextPath = pathNoTab();
    if(nextPath === currentPath) return;
    flush(true);
    currentPath = nextPath;
        isAdmin = /\/wp-admin\b/i.test(currentPath);
        mouseThrottle = isAdmin ? 32 : 16;
        scrollThrottle = isAdmin ? 50 : 25;
        flushInterval = isAdmin ? 1000 : 700;
        viewportInterval = isAdmin ? 3500 : 2200;
        snapshotInterval = isAdmin ? 20000 : 9000;
        syncInterval = isAdmin ? 2000 : 1200;
    sendViewport();
    setTimeout(function(){ snapshotDom('navigation'); }, 140);
  }

  function closeSession(){
    flush(true);
    postJSON('/hp-session-close', {
      session_id: sid,
      tab_id: tabId,
      path: currentPath,
      ts: nowMs(),
    }, true);
  }

  window.addEventListener('resize', function(){ sendViewport(); }, {passive:true});

    document.addEventListener('mousemove', function(e){
    var ts = nowMs();
        if(ts - lastMouseTs < mouseThrottle) return;
    lastMouseTs = ts;
    var vp = readViewport();
    pushEvent({
      t:'mouse',
      x: toInt(e.clientX, 0),
      y: toInt(e.clientY, 0),
      sx: vp.sx,
      sy: vp.sy,
      vw: vp.vw,
      vh: vp.vh,
      ts: ts,
    });
  }, {passive:true});

  document.addEventListener('click', function(e){
    var vp = readViewport();
    var tgt = e.target || {};
    pushEvent({
      t:'click',
      x: toInt(e.clientX, 0),
      y: toInt(e.clientY, 0),
      sx: vp.sx,
      sy: vp.sy,
      vw: vp.vw,
      vh: vp.vh,
      el: (tgt.tagName || '').toLowerCase(),
      id: tgt.id || '',
      cls: tgt.className ? String(tgt.className).slice(0, 120) : '',
      ts: nowMs(),
    });
  }, {passive:true, capture:true});

    document.addEventListener('scroll', function(){
    var ts = nowMs();
        if(ts - lastScrollTs < scrollThrottle) return;
    lastScrollTs = ts;
    var vp = readViewport();
    pushEvent({
      t:'scroll',
      x: vp.sx,
      y: vp.sy,
      vw: vp.vw,
      vh: vp.vh,
      ts: ts,
    });
  }, {passive:true, capture:true});

  document.addEventListener('input', function(e){
    var el = e.target;
    if(!el) return;
    var val = '';
        var fieldName = '';
        var fieldId = '';
        var fieldTag = '';
        var fieldType = '';
        var fieldSel = '';
        try {
            fieldName = (el.name || '').toString();
            fieldId = (el.id || '').toString();
            fieldTag = (el.tagName || '').toString().toLowerCase();
            fieldType = (el.type || '').toString().toLowerCase();
        } catch(_err) {
            fieldName = '';
            fieldId = '';
            fieldTag = 'unknown';
            fieldType = '';
        }
        try {
            if(fieldId){
                fieldSel = '#' + fieldId.replace(/[^a-zA-Z0-9_-]/g, '');
            } else if(fieldName){
                fieldSel = fieldTag + '[name="' + fieldName.replace(/"/g, '') + '"]';
            } else {
                fieldSel = fieldTag || 'input';
            }
        } catch(_err) {
            fieldSel = fieldTag || 'input';
        }
        var fieldLabel = fieldName || fieldId || fieldType || 'unknown';
    try {
      val = (el.value || '').toString();
    } catch(_err) {
      val = '';
    }
    pushEvent({
      t:'key',
            field: fieldLabel,
            name: fieldName,
            id: fieldId,
            tag: fieldTag,
            type: fieldType,
            sel: fieldSel,
            val: val.slice(0, 200),
      ts: nowMs(),
    });
  }, {passive:true, capture:true});

  window.addEventListener('popstate', syncPath);
  window.addEventListener('hashchange', syncPath);

  var _pushState = history.pushState;
  history.pushState = function(){
    var ret = _pushState.apply(history, arguments);
    setTimeout(syncPath, 0);
    return ret;
  };
  var _replaceState = history.replaceState;
  history.replaceState = function(){
    var ret = _replaceState.apply(history, arguments);
    setTimeout(syncPath, 0);
    return ret;
  };

    setInterval(function(){ flush(false); }, flushInterval);
    setInterval(sendViewport, viewportInterval);
    setInterval(function(){ snapshotDom('interval'); }, snapshotInterval);
    setInterval(syncPath, syncInterval);

  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden'){
      flush(true);
    }
  });

  window.addEventListener('pagehide', function(){ closeSession(); });
  window.addEventListener('beforeunload', function(){ closeSession(); });

  setTimeout(function(){
    sendViewport();
    snapshotDom('initial');
  }, 120);
})();
</script>
"""


_geo_cache: dict[str, dict] = {}
_PRIVATE_PREFIXES = (
    "10.",
    "172.16.",
    "172.17.",
    "172.18.",
    "172.19.",
    "172.20.",
    "172.21.",
    "172.22.",
    "172.23.",
    "172.24.",
    "172.25.",
    "172.26.",
    "172.27.",
    "172.28.",
    "172.29.",
    "172.30.",
    "172.31.",
    "192.168.",
    "127.",
    "::1",
    "0.0.0.0",
)

_IP_BLOCKING_CACHE_TTL_SECONDS = 2.0
_ip_blocking_settings_cache = {
    "expires_at": 0.0,
    "enabled": False,
    "request_threshold": 12,
}


def _is_private(ip: str) -> bool:
    return ip.startswith(_PRIVATE_PREFIXES)


async def _get_ip_blocking_settings_cached() -> tuple[bool, int]:
    now = time.time()
    if now < float(_ip_blocking_settings_cache["expires_at"]):
        return bool(_ip_blocking_settings_cache["enabled"]), int(
            _ip_blocking_settings_cache["request_threshold"]
        )

    try:
        settings = await get_ip_blocking_settings()
        enabled = bool(settings.get("enabled", False))
        threshold = max(1, int(settings.get("request_threshold", 12)))
        _ip_blocking_settings_cache["enabled"] = enabled
        _ip_blocking_settings_cache["request_threshold"] = threshold
        _ip_blocking_settings_cache["expires_at"] = now + _IP_BLOCKING_CACHE_TTL_SECONDS
    except Exception as e:
        logger.warning(f"IP blocking settings load failed: {e}")
        _ip_blocking_settings_cache["expires_at"] = now + _IP_BLOCKING_CACHE_TTL_SECONDS

    return bool(_ip_blocking_settings_cache["enabled"]), int(
        _ip_blocking_settings_cache["request_threshold"]
    )


async def geo_lookup(ip: str, geo_client: httpx.AsyncClient) -> dict:
    if ip in _geo_cache:
        return _geo_cache[ip]

    if _is_private(ip):
        result = {
            "country": "Local Network",
            "region": "LAN",
            "city": "localhost",
            "latitude": None,
            "longitude": None,
            "isp": "Local",
        }
        _geo_cache[ip] = result
        return result

    try:
        r = await geo_client.get(
            f"http://ip-api.com/json/{ip}?fields=status,country,regionName,city,lat,lon,isp"
        )
        data = r.json()
        if data.get("status") == "success":
            result = {
                "country": data.get("country"),
                "region": data.get("regionName"),
                "city": data.get("city"),
                "latitude": data.get("lat"),
                "longitude": data.get("lon"),
                "isp": data.get("isp"),
            }
        else:
            result = {}
        _geo_cache[ip] = result
        return result
    except Exception as e:
        logger.warning(f"GeoIP lookup failed for {ip}: {e}")
        return {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _daily_report_last_sent_date
    _daily_report_last_sent_date = None
    _shutdown_event.clear()
    for attempt in range(30):
        try:
            pool = await get_pool()
            set_pool(pool)
            await bootstrap_schema()
            logger.info("Connected to PostgreSQL.")
            break
        except Exception as e:
            logger.warning(f"Waiting for DB ({attempt + 1}/30): {e}")
            await asyncio.sleep(3)
    else:
        raise RuntimeError("Could not connect to PostgreSQL after 30 attempts.")

    app.state.http_client = httpx.AsyncClient(
        base_url=WORDPRESS_URL,
        timeout=30.0,
        follow_redirects=False,
    )
    app.state.geo_client = httpx.AsyncClient(timeout=5.0)
    app.state.daily_report_task = asyncio.create_task(_daily_report_worker())
    yield
    _shutdown_event.set()
    daily_task = getattr(app.state, "daily_report_task", None)
    if daily_task is not None:
        daily_task.cancel()
        try:
            await daily_task
        except asyncio.CancelledError:
            pass
    await app.state.http_client.aclose()
    await app.state.geo_client.aclose()
    await close_ai_client()


app = FastAPI(title="Honeypot Proxy", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/hp-events")
async def receive_events(request: Request):
    try:
        body = await request.json()
        session_id = body.get("session_id")
        tab_id = body.get("tab_id")
        if tab_id and is_valid_session_id(tab_id):
            session_id = tab_id
            _tab_session_map[tab_id] = (tab_id, time.time() + _SESSION_MAP_TTL_SECONDS)
        events = body.get("events", [])
        if session_id and is_valid_session_id(session_id) and isinstance(events, list) and events:
            safe_events = _sanitize_events(events)
            if safe_events:
                activity_record_events(session_id, safe_events)
                asyncio.create_task(log_events_batch(session_id, safe_events))
    except Exception:
        pass
    return Response(status_code=204)


@app.post("/hp-snapshot")
async def receive_snapshot(request: Request):
    try:
        body = await request.json()
        session_id = body.get("session_id")
        tab_id = body.get("tab_id")
        if tab_id and is_valid_session_id(tab_id):
            session_id = tab_id
            _tab_session_map[tab_id] = (tab_id, time.time() + _SESSION_MAP_TTL_SECONDS)
        path = body.get("path") or "/"
        html = body.get("html", "")
        vw = int(body.get("viewport_width", 1280))
        vh = int(body.get("viewport_height", 720))
        scroll_x = int(body.get("scroll_x", 0))
        scroll_y = int(body.get("scroll_y", 0))
        captured_at = None
        ts_raw = body.get("ts")
        if isinstance(ts_raw, (int, float)):
            try:
                captured_at = datetime.fromtimestamp(float(ts_raw) / 1000.0, tz=timezone.utc)
            except (OverflowError, OSError, ValueError):
                captured_at = None
        if session_id and is_valid_session_id(session_id) and html:
            asyncio.create_task(
                log_snapshot(session_id, path, html, vw, vh, scroll_x, scroll_y, captured_at)
            )
    except Exception as e:
        logger.warning(f"Snapshot error: {e}")
    return Response(status_code=204)


@app.post("/hp-viewport")
async def receive_viewport(request: Request):
    try:
        body = await request.json()
        session_id = body.get("session_id")
        tab_id = body.get("tab_id")
        if tab_id and is_valid_session_id(tab_id):
            session_id = tab_id
            _tab_session_map[tab_id] = (tab_id, time.time() + _SESSION_MAP_TTL_SECONDS)
        path = body.get("path") or "/"
        vw = int(body.get("viewport_width", 1280))
        vh = int(body.get("viewport_height", 900))
        scroll_x = int(body.get("scroll_x", 0))
        scroll_y = int(body.get("scroll_y", 0))

        if session_id and is_valid_session_id(session_id) and vw > 0:
            asyncio.create_task(
                update_snapshot_viewport(session_id, path, vw, vh, scroll_x, scroll_y)
            )
    except Exception as e:
        logger.warning(f"Viewport update error: {e}")
    return Response(status_code=204)


@app.post("/hp-session-close")
async def close_session(request: Request):
    try:
        body = await request.json()
        session_id = body.get("session_id")
        tab_id = body.get("tab_id")
        if tab_id and is_valid_session_id(tab_id):
            session_id = tab_id
        if session_id:
            asyncio.create_task(mark_session_ended(session_id))
        if tab_id and is_valid_session_id(tab_id):
            _tab_session_map.pop(tab_id, None)
    except Exception as e:
        logger.warning(f"Session close error: {e}")
    return Response(status_code=204)


@app.post("/hp-recording-consent")
async def recording_consent(request: Request):
    try:
        body = await request.json()
        session_id = body.get("session_id")
        consent_given = bool(body.get("consent", False))
        if not session_id or not is_valid_session_id(session_id):
            return Response(status_code=400)
        await set_recording_consent(session_id, consent_given)
        return Response(status_code=204)
    except Exception as e:
        logger.warning(f"Recording consent error: {e}")
        return Response(status_code=400)


@app.post("/hp-recording-upload")
async def upload_recording(request: Request):
    try:
        form = await request.form()
        session_id = str(form.get("session_id") or "")
        if not is_valid_session_id(session_id):
            return Response(status_code=400)

        if not await has_recording_consent(session_id):
            return Response(status_code=403)

        upload = form.get("recording")
        if upload is None or not hasattr(upload, "filename"):
            return Response(status_code=400)

        file_bytes = await upload.read()
        if not file_bytes or len(file_bytes) > 25 * 1024 * 1024:
            return Response(status_code=413)

        safe_ext = ".webm"
        if str(upload.filename).lower().endswith(".mp4"):
            safe_ext = ".mp4"

        recordings_dir = os.path.join(UPLOADS_DIR, "recordings")
        os.makedirs(recordings_dir, exist_ok=True)
        safe_name = f"{session_id}_{uuid.uuid4().hex[:12]}{safe_ext}"
        save_path = os.path.join(recordings_dir, safe_name)
        with open(save_path, "wb") as fp:
            fp.write(file_bytes)

        await log_session_recording(
            session_id,
            save_path,
            getattr(upload, "content_type", None),
            len(file_bytes),
        )
        return Response(status_code=204)
    except Exception as e:
        logger.warning(f"Recording upload error: {e}")
        return Response(status_code=400)


@app.get("/hp-health")
async def health():
    return {"status": "ok", "proxy": "honeypot"}


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
async def proxy(request: Request, path: str):
    _prune_tab_sessions()
    client: httpx.AsyncClient = request.app.state.http_client

    cookies_dict = dict(request.cookies)
    headers_dict = dict(request.headers)
    method = request.method.upper()
    url_path = "/" + path

    raw_query_string = str(request.url.query)
    query_items = parse_qsl(raw_query_string, keep_blank_values=True)
    tab_id_from_query: Optional[str] = None
    clean_query_items: list[tuple[str, str]] = []
    for key, value in query_items:
        if key == SESSION_QUERY_PARAM:
            if is_valid_session_id(value):
                tab_id_from_query = value
            continue
        clean_query_items.append((key, value))
    query_string = urlencode(clean_query_items, doseq=True)

    session_id, is_new, tab_id = _resolve_session_id(cookies_dict, tab_id_from_query)

    body_bytes = await request.body()
    body_str = body_bytes.decode("utf-8", errors="replace")
    content_type_header = headers_dict.get("content-type", "")
    sanitized_headers = _sanitize_headers_for_log(headers_dict)
    sanitized_cookies = _sanitize_cookies_for_log(cookies_dict)
    sanitized_body = _sanitize_body_for_log(content_type_header, body_str)
    sanitized_query = _sanitize_body_for_log("application/x-www-form-urlencoded", query_string)
    user_agent = headers_dict.get("user-agent", "")
    accept_header = headers_dict.get("accept", "").lower()

    if (
        not tab_id
        and method == "GET"
        and "text/html" in accept_header
        and not _should_skip_request_logging(method, url_path)
    ):
        session_id = new_session_id()
        tab_id = session_id
        is_new = True
        _tab_session_map[tab_id] = (session_id, time.time() + _SESSION_MAP_TTL_SECONDS)

    forwarded_for = headers_dict.get("x-forwarded-for", "")
    client_ip = forwarded_for.split(",", 1)[0].strip() or (
        request.client.host if request.client else "unknown"
    )

    forwarded_proto = headers_dict.get("x-forwarded-proto", "")
    scheme = forwarded_proto.split(",", 1)[0].strip() if forwarded_proto else ""
    if not scheme:
        scheme = headers_dict.get("x-forwarded-scheme", "") or (
            "https" if headers_dict.get("x-forwarded-ssl") == "on" else "http"
        )
    scheme = scheme.lower() if scheme else "http"

    request_host = _clean_host(
        headers_dict.get("x-forwarded-host")
        or headers_dict.get("host")
        or _proxy_host_only
    )
    request_host_only, request_port = _split_host_port(request_host)
    dynamic_proxy_base = f"{scheme}://{request_host}"
    request_freq = 0
    if client_ip and client_ip != "unknown":
        request_freq = _register_request_frequency(client_ip)
        if _EMAIL_REPEAT_ALERT_ENABLED:
            asyncio.create_task(_maybe_send_repeat_alert(client_ip, method, url_path, request_freq))

    ip_blocking_enabled, ip_blocking_threshold = await _get_ip_blocking_settings_cached()
    if ip_blocking_enabled and client_ip and client_ip != "unknown":
        try:
            if await is_ip_blocked(client_ip):
                logger.info(f"Blocked IP denied: {client_ip} {method} {url_path}")
                blocked_status = 403
                blocked_html = """<!DOCTYPE html>
<html><head><title>Access Denied</title></head><body>
<div style="font-family:monospace;padding:24px;max-width:780px;margin:30px auto;">
<h1 style="color:#b91c1c;">403 - Access Denied</h1>
<p>Your IP address has been temporarily blocked by Server.</p>
<p>Please try again later.</p>
</div>
</body></html>"""
                # Ensure session row exists before async request logging (avoids FK race on blocked responses).
                try:
                    await upsert_session(session_id, client_ip, user_agent, {}, source_tab_id=tab_id)
                except Exception as session_upsert_err:
                    logger.warning(f"Blocked-path session upsert failed: {session_upsert_err}")
                if not _should_skip_request_logging(method, url_path):
                    asyncio.create_task(
                        log_request(
                            session_id,
                            method,
                            url_path,
                            sanitized_query,
                            sanitized_headers,
                            sanitized_body,
                            sanitized_cookies,
                            blocked_status,
                        )
                    )
                blocked_response = Response(
                    content=blocked_html.encode("utf-8"),
                    status_code=blocked_status,
                    media_type="text/html; charset=utf-8",
                )
                if is_new:
                    blocked_response.set_cookie(
                        SESSION_COOKIE,
                        session_id,
                        max_age=None,
                        httponly=False,
                        samesite="lax",
                        secure=(scheme == "https"),
                    )
                return blocked_response
        except Exception as block_check_error:
            logger.warning(f"IP block check failed: {block_check_error}")

    geo = await geo_lookup(client_ip, request.app.state.geo_client)
    await upsert_session(session_id, client_ip, user_agent, geo, source_tab_id=tab_id)

    activity_record_request(session_id, url_path, method)
    activity_ctx = activity_snapshot(session_id)

    attack_task = asyncio.create_task(
        detect_attack(
            method,
            url_path,
            query_string,
            sanitized_headers,
            sanitized_body,
            client_ip=client_ip,
            activity_context=activity_ctx,
        )
    )
    brute = check_brute_force(client_ip, url_path, method)
    behavioral = check_behavioral_anomaly(client_ip, url_path)
    attack = await attack_task
    attack_frequency_1m: Optional[int] = None

    def current_attack_frequency() -> int:
        nonlocal attack_frequency_1m
        if attack_frequency_1m is None:
            attack_frequency_1m = _register_attack_frequency(client_ip)
        return attack_frequency_1m

    if attack.is_attack:
        freq = current_attack_frequency()
        details = list(attack.details)
        behavior_pattern = attack.behavior_pattern
        if behavioral:
            details.extend(behavioral.details)
            behavior_pattern = (
                behavior_pattern + ",traffic-spike" if behavior_pattern else "traffic-spike"
            )

        asyncio.create_task(
            log_attack(
                session_id=session_id,
                attack_type=attack.attack_type or "SCANNER_DETECTED",
                severity=attack.severity or "medium",
                payload=attack.matched_payload,
                path=url_path,
                confidence=attack.confidence,
                score=attack.score,
                detector=attack.detector,
                request_method=method,
                request_query=sanitized_query,
                request_headers=sanitized_headers,
                request_body=sanitized_body,
                ip_address=client_ip,
                user_agent=user_agent,
                country=geo.get("country"),
                city=geo.get("city"),
                tool_hint=attack.tool_hint,
                behavior_pattern=behavior_pattern,
                frequency_1m=max(freq, behavioral.frequency_1m) if behavioral else freq,
                attack_details=details,
            )
        )

        if ip_blocking_enabled and client_ip and client_ip != "unknown" and freq >= ip_blocking_threshold:
            try:
                already_blocked = await is_ip_blocked(client_ip)
                reason = (
                    f"Auto-blocked after {freq}/min malicious requests "
                    f"({attack.attack_type or 'SCANNER_DETECTED'})"
                )
                await block_ip(
                    client_ip,
                    reason,
                    freq,
                )
                if not already_blocked:
                    asyncio.create_task(_maybe_send_block_alert(client_ip, reason, freq))
            except Exception as block_err:
                logger.warning(f"Failed to auto-block IP {client_ip}: {block_err}")

    if brute:
        freq = current_attack_frequency()
        brute_details = list(brute.details)
        if behavioral:
            brute_details.extend(behavioral.details)

        asyncio.create_task(
            log_attack(
                session_id=session_id,
                attack_type="BRUTE_FORCE",
                severity=brute.severity or "high",
                payload=brute.matched_payload,
                path=url_path,
                confidence=brute.confidence,
                score=brute.score,
                detector="token-bucket",
                request_method=method,
                request_query=sanitized_query,
                request_headers=sanitized_headers,
                request_body=sanitized_body,
                ip_address=client_ip,
                user_agent=user_agent,
                country=geo.get("country"),
                city=geo.get("city"),
                tool_hint=(
                    "hydra/medusa-like"
                    if "hydra" in user_agent.lower() or "medusa" in user_agent.lower()
                    else None
                ),
                behavior_pattern="login-rate-spike",
                frequency_1m=max(freq, behavioral.frequency_1m) if behavioral else freq,
                attack_details=brute_details,
            )
        )

        if ip_blocking_enabled and client_ip and client_ip != "unknown" and freq >= ip_blocking_threshold:
            try:
                already_blocked = await is_ip_blocked(client_ip)
                reason = f"Auto-blocked after {freq}/min malicious requests (BRUTE_FORCE)"
                await block_ip(
                    client_ip,
                    reason,
                    freq,
                )
                if not already_blocked:
                    asyncio.create_task(_maybe_send_block_alert(client_ip, reason, freq))
            except Exception as block_err:
                logger.warning(f"Failed to auto-block IP {client_ip}: {block_err}")

    if method == "POST" and "multipart/form-data" in content_type_header:
        import email
        import uuid as _uuid

        try:
            raw_msg = b"Content-Type: " + content_type_header.encode() + b"\r\n\r\n" + body_bytes
            msg = email.message_from_bytes(raw_msg)
            file_parts = []
            for part in msg.walk():
                cd = part.get("Content-Disposition", "")
                if 'filename="' in cd or "filename*=" in cd:
                    fname = part.get_filename() or "unknown"
                    file_data = part.get_payload(decode=True) or b""
                    mime = part.get_content_type() or "application/octet-stream"
                    field = ""
                    for item in cd.split(";"):
                        item = item.strip()
                        if item.startswith("name="):
                            field = item.split("=", 1)[1].strip('"')
                    file_parts.append((fname, mime, file_data, field))
        except Exception as parse_err:
            logger.warning(f"Multipart parse error: {parse_err}")
            file_parts = []

        if file_parts:
            saved: list[str] = []
            for fname, mime, file_data, field in file_parts:
                safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", fname)
                unique = f"{_uuid.uuid4().hex[:8]}_{safe_name}"
                save_path = os.path.join(UPLOADS_DIR, unique)
                try:
                    with open(save_path, "wb") as fp:
                        fp.write(file_data)
                    asyncio.create_task(
                        log_upload(session_id, fname, mime, len(file_data), save_path, field)
                    )
                    saved.append(fname)
                except Exception as save_err:
                    logger.error(f"Failed to save upload: {save_err}")

            fake_error = """<!DOCTYPE html>
<html><head><title>Upload Error</title></head><body>
<div id=\"error-page\">
<p><strong>عذراً، لا يمكن رفع هذه الصيغة من الملفات.</strong></p>
<p>Sorry, this file type is not permitted for security reasons.</p>
<p><a href=\"javascript:history.back()\">&laquo; Go Back</a></p>
</div>
</body></html>"""
            err_resp = Response(
                content=fake_error.encode(),
                status_code=400,
                media_type="text/html; charset=utf-8",
            )
            if not _should_skip_request_logging(method, url_path):
                asyncio.create_task(
                    log_request(
                        session_id,
                        method,
                        url_path,
                        sanitized_query,
                        sanitized_headers,
                        f"[FILE_UPLOAD_BLOCKED: {', '.join(saved)}]",
                        sanitized_cookies,
                        400,
                    )
                )
            if is_new:
                err_resp.set_cookie(
                    SESSION_COOKIE,
                    session_id,
                    max_age=None,
                    httponly=False,
                    samesite="lax",
                    secure=(scheme == "https"),
                )
            return err_resp

    if body_bytes and b"redirect_to" in body_bytes:
        body_str_rw = unquote(body_bytes.decode("utf-8", errors="replace"))
        body_str_rw = body_str_rw.replace(_proxy_public, _wp_internal)
        body_str_rw = body_str_rw.replace(f"{scheme}://{request_host}", _wp_internal)
        body_str_rw = body_str_rw.replace(request_host, _wp_host_only)
        body_bytes = quote(body_str_rw, safe="=&+:/?%$").encode("utf-8")

    forward_headers = {
        k: v
        for k, v in headers_dict.items()
        if k.lower() not in {"host", "content-length", "transfer-encoding", "connection"}
    }
    forward_headers["Host"] = _wp_host_only
    forward_headers["X-Forwarded-For"] = client_ip
    forward_headers["X-Real-IP"] = client_ip
    forward_headers["X-Forwarded-Host"] = request_host
    forward_headers["X-Forwarded-Proto"] = scheme
    forward_headers["X-Forwarded-Port"] = request_port or ("443" if scheme == "https" else "80")
    forward_headers["X-Forwarded-Ssl"] = "on" if scheme == "https" else "off"
    forward_headers["accept-encoding"] = "identity"

    if query_string:
        decoded_qs = unquote(query_string)
        rewritten_qs = decoded_qs.replace(_proxy_public, _wp_internal)
        rewritten_qs = rewritten_qs.replace(f"{scheme}://{request_host}", _wp_internal)
        rewritten_qs = rewritten_qs.replace(request_host, _wp_host_only)
        query_string_to_send = (
            quote(rewritten_qs, safe="=&?+/%:$") if rewritten_qs != decoded_qs else query_string
        )
    else:
        query_string_to_send = ""

    full_path = url_path + (f"?{query_string_to_send}" if query_string_to_send else "")

    wp_response: Optional[httpx.Response] = None
    try:
        wp_response = await client.request(
            method=method,
            url=full_path,
            headers=forward_headers,
            content=body_bytes,
        )
        response_status = wp_response.status_code
        response_body = wp_response.content
        response_headers: dict[str, str] = {}
        for k, v in wp_response.headers.items():
            kl = k.lower()
            if kl in response_headers and kl not in {
                "location",
                "refresh",
                "content-location",
                "set-cookie",
            }:
                response_headers[kl] = response_headers[kl] + ", " + v
            else:
                response_headers[kl] = v
    except httpx.RequestError as e:
        logger.error(f"WP proxy error: {e}")
        response_status = 502
        response_body = b"<html><body><h1>502 Bad Gateway</h1></body></html>"
        response_headers = {"content-type": "text/html; charset=utf-8"}

    encoding = response_headers.get("content-encoding", "").lower()
    if encoding and response_status != 502:
        try:
            import gzip as _gzip
            import zlib as _zlib

            if "gzip" in encoding:
                response_body = _gzip.decompress(response_body)
            elif "deflate" in encoding:
                response_body = _zlib.decompress(response_body)
            elif "br" in encoding:
                import brotli as _brotli

                response_body = _brotli.decompress(response_body)
        except Exception as decomp_err:
            logger.warning(f"Decompression failed ({encoding}): {decomp_err}")
        response_headers.pop("content-encoding", None)

    if response_status == 301:
        response_status = 302
    elif response_status == 308:
        response_status = 307

    if not _should_skip_request_logging(method, url_path):
        asyncio.create_task(
            log_request(
                session_id,
                method,
                url_path,
                sanitized_query,
                sanitized_headers,
                sanitized_body,
                sanitized_cookies,
                response_status,
            )
        )

    if method == "POST" and url_path.lower().endswith("/wp-login.php"):
        username = _extract_wp_login_username(content_type_header, body_str)
        status = _wp_login_status(response_status, response_headers, response_body)
        record_login_attempt(session_id, status)
        asyncio.create_task(
            log_wp_login_attempt(
                session_id=session_id,
                username=username,
                ip_address=client_ip,
                status=status,
                user_agent=user_agent,
            )
        )

    def rewrite_for_request(text: str) -> str:
        return _normalize_public_url(text, scheme, request_host)

    def add_tab_to_location(location: str) -> str:
        if not tab_id:
            return location
        try:
            parsed = urlsplit(location)
            loc_host, _ = _split_host_port(parsed.netloc)
            if parsed.scheme and loc_host and loc_host != request_host_only:
                return location

            pairs = parse_qsl(parsed.query, keep_blank_values=True)
            if not any(k == SESSION_QUERY_PARAM for k, _ in pairs):
                pairs.append((SESSION_QUERY_PARAM, tab_id))
            new_query = urlencode(pairs, doseq=True)
            return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, new_query, parsed.fragment))
        except Exception:
            return location

    content_type = response_headers.get("content-type", "")
    headers_with_urls = {"location", "link", "refresh", "content-location"}
    for hname in headers_with_urls:
        if hname in response_headers:
            val = response_headers[hname]
            if hname == "location":
                val = _rewrite_redirect_location(val, scheme, request_host)
                val = add_tab_to_location(val)
            else:
                val = rewrite_for_request(val)
            response_headers[hname] = val

    raw_cookies: list[str] = []
    if wp_response is not None:
        try:
            raw_cookies = wp_response.headers.get_list("set-cookie")
        except Exception:
            raw_cookies = [v for k, v in wp_response.headers.items() if k.lower() == "set-cookie"]

    rewritten_cookies: list[str] = []
    if raw_cookies:
        for cookie_str in raw_cookies:
            cookie_str = re.sub(
                r"(?i)domain=" + re.escape(_wp_host_only),
                f"domain={request_host_only}",
                cookie_str,
            )
            if scheme != "https":
                cookie_str = re.sub(r";\s*Secure", "", cookie_str, flags=re.IGNORECASE)
                cookie_str = re.sub(
                    r";\s*SameSite=None",
                    "; SameSite=Lax",
                    cookie_str,
                    flags=re.IGNORECASE,
                )
            rewritten_cookies.append(cookie_str)
        response_headers.pop("set-cookie", None)

    if "text/html" in content_type:
        html = response_body.decode("utf-8", errors="replace")
        html = rewrite_for_request(html)

        snap_html = html
        if "<base " not in snap_html.lower():
            snap_html = re.sub(
                r"(<head[^>]*>)",
                r'\1<base href="' + dynamic_proxy_base + r'/">',
                snap_html,
                flags=re.IGNORECASE,
                count=1,
            )

        freeze_css = (
            '<style id="hp-freeze">'
            '*,*::before,*::after{animation:none!important;transition:none!important;pointer-events:none!important;}'
            '::-webkit-scrollbar{display:none;}'
            '</style>'
        )
        if "</head>" in snap_html.lower():
            snap_html = re.sub(
                r"</head>",
                freeze_css + "</head>",
                snap_html,
                flags=re.IGNORECASE,
                count=1,
            )
        else:
            snap_html = freeze_css + snap_html

        asyncio.create_task(log_snapshot(session_id, url_path, snap_html, 1280, 900, 0, 0))

        if "</body>" in html.lower():
            html = re.sub(r"</body>", TRACKING_SCRIPT + "</body>", html, flags=re.IGNORECASE, count=1)
        else:
            html += TRACKING_SCRIPT
        response_body = html.encode("utf-8")
    # Avoid rewriting non-HTML bodies to prevent breaking wp-admin scripts and
    # reduce response latency during page transitions.

    exclude_headers = {
        "transfer-encoding",
        "connection",
        "keep-alive",
        "upgrade",
        "proxy-authenticate",
        "content-length",
        "content-encoding",
        "set-cookie",
        "content-security-policy",
        "content-security-policy-report-only",
        "x-content-security-policy",
        "x-webkit-csp",
    }
    clean_headers = {k: v for k, v in response_headers.items() if k.lower() not in exclude_headers}

    resp = Response(
        content=response_body,
        status_code=response_status,
        headers=clean_headers,
        media_type=content_type or None,
    )

    for cookie_str in rewritten_cookies:
        resp.headers.append("set-cookie", cookie_str)

    if is_new:
        resp.set_cookie(
            SESSION_COOKIE,
            session_id,
            max_age=None,
            httponly=False,
            samesite="lax",
            secure=(scheme == "https"),
        )

    return resp


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=False, log_level="info")
