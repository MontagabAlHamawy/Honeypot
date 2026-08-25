"""
Session Manager
Creates and tracks visitor sessions, ensuring each unique visitor
gets a consistent session_id stored as a cookie.
"""
import uuid
from typing import Optional


SESSION_COOKIE = "hp_sid"
SESSION_QUERY_PARAM = "hp_tab"


def new_session_id() -> str:
    return str(uuid.uuid4())


def is_valid_session_id(value: Optional[str]) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(value)
        return True
    except (ValueError, TypeError):
        return False


def extract_cookie_session_id(cookies: dict) -> Optional[str]:
    existing = cookies.get(SESSION_COOKIE)
    if is_valid_session_id(existing):
        return existing
    return None


def get_or_create_session_id(cookies: dict) -> tuple[str, bool]:
    """
    Returns (session_id, is_new).
    Reads from the hp_sid cookie, or generates a new UUID.
    """
    existing = extract_cookie_session_id(cookies)
    if existing:
        return existing, False
    return new_session_id(), True


def _is_valid_uuid(value: str) -> bool:
    return is_valid_session_id(value)
