import json
import pathlib
import sys
import unittest

import httpx

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import smart_detector
from smart_detector import ALLOWED_ATTACK_TYPES, check_brute_force


def _mock_ai_client(ai_payload: dict) -> httpx.AsyncClient:
    def handler(_request: httpx.Request) -> httpx.Response:
        response = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(ai_payload),
                    }
                }
            ]
        }
        return httpx.Response(200, json=response)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class DetectorPipelineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.prev_token = smart_detector._AI.token
        smart_detector._AI.token = "test-token"

    async def asyncTearDown(self):
        smart_detector._AI.token = self.prev_token

    async def test_ai_detects_sql_injection(self):
        client = _mock_ai_client(
            {
                "is_attack": True,
                "attack_type": "SQL_INJECTION",
                "severity": "critical",
                "confidence": 0.94,
                "score": 96,
                "matched_payload": "id=1 UNION SELECT user()",
                "details": ["UNION SELECT pattern"],
                "tool_hint": "sqlmap-like",
                "behavior_pattern": "query-anomaly",
            }
        )
        try:
            res = await smart_detector.detect_attack(
                method="GET",
                path="/",
                query_string="id=1 UNION SELECT user()",
                headers={"user-agent": "Mozilla/5.0", "content-type": "text/html"},
                body="",
                client_ip="203.0.113.10",
                ai_client=client,
            )
        finally:
            await client.aclose()

        self.assertTrue(res.is_attack)
        self.assertEqual(res.attack_type, "SQL_INJECTION")
        self.assertIn(res.attack_type, ALLOWED_ATTACK_TYPES)
        self.assertGreaterEqual(res.confidence, 0.9)

    async def test_ai_can_return_non_attack(self):
        client = _mock_ai_client(
            {
                "is_attack": False,
                "attack_type": "NONE",
                "severity": "low",
                "confidence": 0.12,
                "score": 10,
                "matched_payload": "",
                "details": ["normal browsing pattern"],
                "tool_hint": None,
                "behavior_pattern": None,
            }
        )
        try:
            res = await smart_detector.detect_attack(
                method="GET",
                path="/about",
                query_string="page=1",
                headers={"user-agent": "Mozilla/5.0", "content-type": "text/html"},
                body="",
                client_ip="203.0.113.11",
                ai_client=client,
            )
        finally:
            await client.aclose()

        self.assertFalse(res.is_attack)
        self.assertIsNone(res.attack_type)

    async def test_fallback_if_ai_fails(self):
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"error": "upstream error"})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            res = await smart_detector.detect_attack(
                method="POST",
                path="/comment",
                query_string="",
                headers={"user-agent": "Mozilla/5.0", "content-type": "application/x-www-form-urlencoded"},
                body="message=<script>alert(1)</script>",
                client_ip="203.0.113.12",
                ai_client=client,
            )
        finally:
            await client.aclose()

        self.assertTrue(res.is_attack)
        self.assertEqual(res.attack_type, "XSS")

    def test_brute_force_detector(self):
        ip = "203.0.113.50"
        last = None
        for _ in range(12):
            last = check_brute_force(ip, "/wp-login.php", "POST")
        self.assertIsNotNone(last)
        self.assertEqual(last.attack_type, "BRUTE_FORCE")


if __name__ == "__main__":
    unittest.main()
