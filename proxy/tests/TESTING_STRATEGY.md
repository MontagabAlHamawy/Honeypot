# HoneyShield Testing Strategy

This strategy validates the implemented requirements for session tracking, replay accuracy, redirect handling, and attack detection.

## 1) Unit Tests (Fast Feedback)

Run:

```bash
cd proxy
python3 -m unittest discover -s tests -v
```

Coverage:
- Detection pipeline taxonomy and signatures
- Brute-force token bucket behavior
- Session ID generation and cookie/session parsing
- Redirect helper behavior for malformed tunneled location values

## 2) Session Tracking Validation (Per Tab)

Goal: each tab is an independent session and closes cleanly.

Steps:
1. Open two separate tabs to the proxy URL.
2. In each tab, browse to different pages.
3. Check sessions list in dashboard.

Expected:
- Two different session IDs.
- Both have independent event timelines.
- `source_tab_id` is populated.

Close behavior:
1. Close one tab.
2. Wait 2-5 seconds.
3. Refresh dashboard session list.

Expected:
- Closed tab session shows `ended_at` set.
- Active tab session remains live.

## 3) Replay Accuracy Validation

Goal: verify full replay flow quality.

Steps:
1. In one tab, perform:
   - mouse movement over multiple areas
   - scroll up/down multiple times
   - clicks on links/buttons
   - typing in non-password fields
2. Open corresponding session in dashboard replay.

Expected:
- Cursor follows timeline with correct coordinates and scale.
- Click ring appears on click points.
- Scroll position is applied during replay.
- Captured input appears in timeline order.
- Snapshot transitions follow page timeline without major stalls.

## 4) Public URL / Tunnel Redirect Validation

Goal: no malformed redirects with forwarded host/proto.

Steps:
1. Expose proxy with ngrok or devtunnels.
2. Access a page via tunneled URL, for example:

```
https://<tunnel-host>/?page_id=948
```

3. Perform login/logout and wp-admin navigation.

Expected:
- No URLs like `https://host, host/...`.
- Redirect Location headers contain a single valid host.
- wp-admin transitions remain functional.

## 5) Attack Simulation Validation

Goal: verify only allowed attack types are produced.

Allowed types:
- SQL_INJECTION
- XSS
- PATH_TRAVERSAL
- COMMAND_INJECTION
- BRUTE_FORCE
- WP_SCAN
- SCANNER_DETECTED

Examples:

```bash
# SQL injection
curl "http://localhost:8001/?id=1%20UNION%20SELECT%20user()"

# XSS
curl -X POST "http://localhost:8001/comment" -d "message=<script>alert(1)</script>"

# Path traversal
curl "http://localhost:8001/download?file=../../../../etc/passwd"

# Command injection
curl -X POST "http://localhost:8001/api/run" -d "cmd=hello;whoami"

# WP scan path
curl "http://localhost:8001/xmlrpc.php"

# Scanner UA
curl -A "sqlmap/1.8.2" "http://localhost:8001/"
```

Brute-force simulation:

```bash
for i in $(seq 1 20); do
  curl -X POST "http://localhost:8001/wp-login.php" -d "log=admin&pwd=bad" > /dev/null
 done
```

Expected:
- Detections map only to the allowed set.
- Attack rows include enriched metadata: detector, confidence, score, tool hint, request details, IP/geo, and frequency.

## 6) Stability / Performance Check

Run a burst test against static + page requests and verify:
- static assets are not flooding request logs (`favicon`, css/js/png/etc)
- replay still loads snapshots and events
- response latency remains acceptable under concurrent traffic

Optional command:

```bash
# Requires apachebench
ab -n 1000 -c 20 http://localhost:8001/
```

## 7) Acceptance Criteria

- Per-tab session isolation works.
- Session closure writes `ended_at`.
- Replay includes mouse/click/scroll/keyboard timeline.
- Tunnel redirects are valid with forwarded headers.
- Attack labels are limited strictly to the required set.
- Unit tests pass.
