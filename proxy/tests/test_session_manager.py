import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from session_manager import (
    SESSION_COOKIE,
    extract_cookie_session_id,
    get_or_create_session_id,
    is_valid_session_id,
    new_session_id,
)


class SessionManagerTests(unittest.TestCase):
    def test_new_session_id_is_uuid(self):
        sid = new_session_id()
        self.assertTrue(is_valid_session_id(sid))

    def test_new_session_id_is_unique(self):
        sid1 = new_session_id()
        sid2 = new_session_id()
        self.assertNotEqual(sid1, sid2)

    def test_extract_cookie_session_id(self):
        sid = new_session_id()
        got = extract_cookie_session_id({SESSION_COOKIE: sid})
        self.assertEqual(got, sid)

    def test_extract_cookie_session_id_rejects_invalid(self):
        got = extract_cookie_session_id({SESSION_COOKIE: "not-a-uuid"})
        self.assertIsNone(got)

    def test_get_or_create_reuses_cookie(self):
        sid = new_session_id()
        got, is_new = get_or_create_session_id({SESSION_COOKIE: sid})
        self.assertEqual(got, sid)
        self.assertFalse(is_new)

    def test_get_or_create_mints_when_missing(self):
        got, is_new = get_or_create_session_id({})
        self.assertTrue(is_valid_session_id(got))
        self.assertTrue(is_new)


if __name__ == "__main__":
    unittest.main()
