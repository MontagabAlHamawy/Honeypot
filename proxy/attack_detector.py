# honeypot/proxy/attack_detector.py
"""
Attack Detection Engine
Classifies incoming requests by attack type and severity.
"""
import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class AttackResult:
    is_attack: bool
    attack_type: Optional[str]
    severity: Optional[str]  # low | medium | high | critical
    matched_payload: Optional[str]


# ─────────────────────────────────────────────────────────────
# Signature patterns
# ─────────────────────────────────────────────────────────────
SQL_INJECTION_PATTERNS = [
    r"(\%27)|(\')|(\-\-)|(\%23)|(#)",
    r"((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))",
    r"\w*((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))",
    r"((\%27)|(\'))union",
    r"union.{0,20}select",
    r"select.{0,20}from",
    r"insert.{0,20}into",
    r"drop.{0,20}table",
    r"delete.{0,20}from",
    r"update.{0,20}set",
    r"exec(\s|\+)+(s|x)p\w+",
    r"1=1",
    r"OR\s+1\s*=\s*1",
    r"AND\s+1\s*=\s*1",
    r"SLEEP\s*\(",
    r"BENCHMARK\s*\(",
    r"WAITFOR\s+DELAY",
]

XSS_PATTERNS = [
    r"<script[\s\S]*?>[\s\S]*?<\/script>",
    r"<script",
    r"javascript\s*:",
    r"on\w+\s*=",
    r"<\s*img[^>]*onerror",
    r"<\s*iframe",
    r"<\s*object",
    r"<\s*embed",
    r"alert\s*\(",
    r"document\.cookie",
    r"document\.write",
    r"eval\s*\(",
    r"expression\s*\(",
    r"vbscript\s*:",
    r"<\s*svg[^>]*onload",
]

PATH_TRAVERSAL_PATTERNS = [
    r"\.\./",
    r"\.\.\\",
    r"%2e%2e%2f",
    r"%252e%252e%252f",
    r"\.\.%2f",
    r"%2e%2e/",
    r"etc/passwd",
    r"etc/shadow",
    r"windows/win.ini",
    r"boot\.ini",
]

CMD_INJECTION_PATTERNS = [
    r";\s*(ls|dir|cat|type|pwd|whoami|id|uname)\s",
    r"\|\s*(ls|dir|cat|bash|sh|cmd|powershell)",
    r"`.*`",
    r"\$\(.*\)",
    r"&&\s*(ls|dir|cat|bash|sh|whoami)",
    r";\s*rm\s+-rf",
    r"\|\|\s*\w+",
    r"nc\s+-[lnvp]+",
    r"wget\s+http",
    r"curl\s+http",
    r"/bin/bash",
    r"/bin/sh",
    r"cmd\.exe",
    r"powershell\.exe",
]

WORDPRESS_SCAN_PATTERNS = [
    r"wp-login\.php",
    r"wp-admin",
    r"xmlrpc\.php",
    r"wp-content/plugins",
    r"wp-includes",
    r"\.env",
    r"phpinfo",
    r"admin/config",
    r"phpmyadmin",
    r"/etc/passwd",
]


def _check_patterns(text: str, patterns: list[str]) -> Optional[str]:
    """Returns the actual matched text from input (not the regex pattern), or None."""
    text_lower = text.lower()
    for pattern in patterns:
        m = re.search(pattern, text_lower, re.IGNORECASE)
        if m:
            # Return the actual matched substring from the original input (preserve case)
            start, end = m.start(), m.end()
            return text[start:end] if end <= len(text) else m.group(0)
    return None


def detect_attack(
    method: str,
    path: str,
    query_string: str,
    headers: dict,
    body: str,
) -> AttackResult:
    """
    Analyse a single HTTP request and return an AttackResult.
    """
    from urllib.parse import unquote_plus

    # Decode URL-encoded chars: %3Cscript%3E -> <script>, %27 -> ' etc.
    decoded_query = unquote_plus(query_string)
    decoded_body  = unquote_plus(body)
    decoded_path  = unquote_plus(path)

    # Surface includes both raw and decoded to catch all encoding variants
    surface = f"{path} {decoded_path} {query_string} {decoded_query} {body} {decoded_body}"

    # SQL Injection
    matched = _check_patterns(surface, SQL_INJECTION_PATTERNS)
    if matched:
        severity = "critical" if any(
            kw in surface.lower() for kw in ["union", "select", "drop", "sleep", "benchmark"]
        ) else "high"
        return AttackResult(True, "SQL_INJECTION", severity, matched)

    # XSS
    matched = _check_patterns(surface, XSS_PATTERNS)
    if matched:
        return AttackResult(True, "XSS", "high", matched)

    # Path Traversal
    matched = _check_patterns(surface, PATH_TRAVERSAL_PATTERNS)
    if matched:
        return AttackResult(True, "PATH_TRAVERSAL", "high", matched)

    # Command Injection
    matched = _check_patterns(surface, CMD_INJECTION_PATTERNS)
    if matched:
        return AttackResult(True, "COMMAND_INJECTION", "critical", matched)

    # WordPress-specific scanning
    # استثناء الملفات الثابتة المشروعة التي يحمّلها WP بنفسه
    _static_ext = (".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg",
                   ".woff", ".woff2", ".ttf", ".ico", ".map", ".min.js", ".min.css")
    _is_static_asset = (
        method.upper() == "GET"
        and any(path.lower().endswith(ext) for ext in _static_ext)
    )
    if not _is_static_asset:
        matched = _check_patterns(path, WORDPRESS_SCAN_PATTERNS)
        if matched:
            return AttackResult(True, "WP_SCAN", "medium", matched)

    # Suspicious user-agent (scanner fingerprints)
    ua = headers.get("user-agent", "").lower()
    scanner_uas = ["sqlmap", "nikto", "nmap", "masscan", "burpsuite", "zap", "acunetix", "nessus", "hydra", "medusa"]
    for scanner in scanner_uas:
        if scanner in ua:
            return AttackResult(True, "SCANNER_DETECTED", "medium", ua)

    return AttackResult(False, None, None, None)


# Brute-force tracking (in-memory, per-process)
_login_attempts: dict[str, list[float]] = {}


def check_brute_force(ip: str, path: str, method: str) -> Optional[AttackResult]:
    """
    Return AttackResult if the IP is brute-forcing login.
    Tracks login POST attempts per IP in a sliding 60-second window.
    """
    import time
    is_login = any(kw in path.lower() for kw in ["login", "wp-login", "signin", "admin"])
    if not (is_login and method.upper() == "POST"):
        return None

    now = time.time()
    window = 60.0
    attempts = _login_attempts.setdefault(ip, [])
    attempts[:] = [t for t in attempts if now - t < window]
    attempts.append(now)

    if len(attempts) >= 5:
        severity = "critical" if len(attempts) >= 20 else "high"
        return AttackResult(True, "BRUTE_FORCE", severity, f"{len(attempts)} attempts in {window}s")
    return None