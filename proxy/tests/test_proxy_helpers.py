import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_IMPORT_ERROR = None
try:
    from main import _rewrite_redirect_location, _should_skip_request_logging
except ModuleNotFoundError as exc:
    _IMPORT_ERROR = exc


@unittest.skipIf(_IMPORT_ERROR is not None, f"proxy runtime dependencies missing: {_IMPORT_ERROR}")
class ProxyHelperTests(unittest.TestCase):
    def test_skip_favicon_and_static(self):
        self.assertTrue(_should_skip_request_logging("GET", "/favicon.ico"))
        self.assertTrue(_should_skip_request_logging("GET", "/wp-content/theme/style.css"))
        self.assertFalse(_should_skip_request_logging("POST", "/favicon.ico"))
        self.assertFalse(_should_skip_request_logging("GET", "/wp-login.php"))

    def test_rewrite_malformed_redirect_value(self):
        malformed = "https://abc.devtunnels.ms, abc.devtunnels.ms/?page_id=948"
        fixed = _rewrite_redirect_location(malformed, "https", "abc.devtunnels.ms")
        self.assertEqual(fixed, "https://abc.devtunnels.ms/?page_id=948")

    def test_rewrite_malformed_redirect_value_encoded_space(self):
        malformed = "https://abc.devtunnels.ms,%20abc.devtunnels.ms/?page_id=948"
        fixed = _rewrite_redirect_location(malformed, "https", "abc.devtunnels.ms")
        self.assertEqual(fixed, "https://abc.devtunnels.ms/?page_id=948")


if __name__ == "__main__":
    unittest.main()
