# 🍯 HoneyShield — Web Honeypot Monitoring Platform

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-green)
![Python](https://img.shields.io/badge/Python-3.12-blue)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED)

**منصة مراقبة أمنية تعتمد على WordPress Honeypot لاصطياد المهاجمين وتحليل سلوكهم في الوقت الفعلي.**

</div>

---

## 📋 جدول المحتويات

- [نظرة عامة](#نظرة-عامة)
- [المميزات](#المميزات)
- [المتطلبات](#المتطلبات)
- [التشغيل السريع — Docker](#التشغيل-السريع--docker)
- [بيئة التطوير](#بيئة-التطوير)
- [هيكل المشروع](#هيكل-المشروع)
- [قاعدة البيانات](#قاعدة-البيانات)
- [الـ API](#الـ-api)
- [اختبار الهجمات](#اختبار-الهجمات)

---

## نظرة عامة

HoneyShield هو نظام Web Honeypot يعمل كـ Reverse Proxy أمام موقع WordPress، يسجّل كل طلب، يحلّل أنماط الهجوم، ويلتقط السلوك الكامل للمهاجم (حركة الفأرة، النقرات، المدخلات)، ثم يعرضه في لوحة تحكم أمنية مع Session Replay مرئي.

```
المهاجم
    │
    ▼
┌──────────────────┐
│  Python Proxy    │  :8001  ← يستقبل كل الطلبات
│  FastAPI Core    │         ← يحلّل ويسجّل ويحقن JS
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐  ┌───────────┐
│Postgres│  │ WordPress │  (داخلي فقط)
│  :5444 │  │  + MySQL  │
└────┬───┘  └───────────┘
     │
     ▼
┌──────────────────┐
│  Next.js 15      │  :3000  ← لوحة التحكم
│  Dashboard       │
└──────────────────┘
```

---

## المميزات

### كشف الهجمات

| النوع | أمثلة | الشدة |
|---|---|---|
| SQL Injection | `' OR 1=1--` , `UNION SELECT` , `SLEEP()` | Critical/High |
| XSS | `<script>` , `onerror=` , `javascript:` | High |
| Path Traversal | `../../etc/passwd` , `%252e%252e` | High |
| Command Injection | `; whoami` , `\| bash` | Critical |
| Brute Force | ≥5 محاولات login / 60 ثانية | Critical/High |
| WP Scan | `/wp-admin` , `xmlrpc.php` | Medium |
| Scanner Detection | sqlmap, Nikto, Nmap, Burp, ZAP | Medium |

### تتبع السلوك
- حركة الفأرة (XY كل 100ms)
- النقرات مع الإحداثيات والعنصر
- لوحة المفاتيح per-field
- DOM Snapshot كامل مع تجميد الانيميشن

### Session Replay
- عرض الصفحة الحقيقية في iframe
- مؤشر فأرة متحرك مُعيَّر بحجم الشاشة الأصلي
- حلقة نقرة حمراء عند كل click
- تحكم: Play / Pause / Reset + سرعات 0.5x 1x 2x 4x

---

## المتطلبات

### Docker (الإنتاج)
- Docker Desktop 24+ أو Docker Engine 24+
- Docker Compose v2
- 4GB RAM على الأقل

### محلي (التطوير)
- Python 3.12+
- Node.js 20+
- Docker (للـ DB و WordPress فقط)

---

## التشغيل السريع — Docker

```bash
# 1. استنساخ المشروع
git clone https://github.com/MontagabAlHamawy/Honeypot.git
cd honeypot

# 2. تشغيل كامل المنظومة
docker compose up --build

# 3. إصلاح روابط WordPress (مرة واحدة فقط)
# Linux/Mac:
bash fix-wp-urls.sh

# Windows PowerShell:
docker exec honeypot-wp-db mysql -u wordpress -pwordpress_secret wordpress -e "
UPDATE wp_options SET option_value = 'http://localhost:8001' WHERE option_name = 'siteurl';
UPDATE wp_options SET option_value = 'http://localhost:8001' WHERE option_name = 'home';"
```

### الخدمات بعد التشغيل

| الخدمة | الرابط |
|---|---|
| 🕵️ Honeypot Proxy | http://localhost:8001 |
| 🖥️ Dashboard | http://localhost:3000 |
| 🗄️ Prisma Studio | http://localhost:5555 |
| 🐘 PostgreSQL | localhost:5444 |

**بيانات الدخول:** `montagabalh@gmail.com` / `Admin@123`

```bash
# إيقاف مع حفظ البيانات
docker compose down

# إيقاف مع مسح البيانات
docker compose down -v
```

---

## بيئة التطوير

البنية التحتية (postgres + wordpress) في Docker، بينما الـ proxy والـ dashboard تشغّلهم محلياً.

### Terminal 1 — البنية التحتية
```bash
docker compose -f docker-compose.dev.yml up
```

### Terminal 2 — Proxy
```bash
cd proxy
python3 -m venv venv
source venv/bin/activate          # Linux/Mac
# أو: venv\Scripts\activate       # Windows

pip install -r requirements.txt
python main.py
```

`proxy/.env`:
```env
DATABASE_URL=postgresql://honeypot:honeypot_secret@localhost:5444/honeypot
WORDPRESS_URL=http://localhost:8080
SECRET_KEY=dev_secret_key
PROXY_PUBLIC_URL=http://localhost:8001
```

### Terminal 3 — Dashboard
```bash
cd dashboard
npm install
npx prisma generate
npx prisma db push      # أول مرة فقط
npx prisma db seed
npm run dev
```

`dashboard/.env.local`:
```env
DATABASE_URL=postgresql://honeypot:honeypot_secret@localhost:5444/honeypot
NEXTAUTH_SECRET=dev_secret_key
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_PROXY_URL=http://localhost:8001
```

### إصلاح روابط WordPress (بيئة التطوير)
```bash
docker exec honeypot-wp-db mysql -u wordpress -pwordpress_secret wordpress -e "
UPDATE wp_options SET option_value = 'http://localhost:8001' WHERE option_name = 'siteurl';
UPDATE wp_options SET option_value = 'http://localhost:8001' WHERE option_name = 'home';"
```

### Makefile — اختصارات
```bash
make infra          # Docker: postgres + wordpress فقط
make proxy-dev      # تشغيل proxy محلياً
make dashboard-dev  # تشغيل dashboard محلياً
make prod           # docker compose up --build
make prod-clean     # docker compose down -v
```

---

## هيكل المشروع

```
honeypot/
├── docker-compose.yml          # الإنتاج
├── docker-compose.dev.yml      # التطوير
├── fix-wp-urls.sh              # إصلاح روابط WP
├── Makefile
├── .gitignore
│
├── proxy/
│   ├── main.py                 # FastAPI + Reverse Proxy
│   ├── attack_detector.py      # كشف الهجمات
│   ├── logger.py               # كاتب DB (asyncpg)
│   ├── session_manager.py      # إدارة الجلسات
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .dockerignore
│   └── .env
│
└── dashboard/
    ├── app/
    │   ├── (auth)/login/
    │   ├── (dashboard)/
    │   │   ├── overview/
    │   │   ├── attacks/
    │   │   ├── sessions/
    │   │   ├── sessions/[id]/  # Session Replay
    │   │   ├── map/
    │   │   └── requests/
    │   └── api/
    │       ├── auth/
    │       ├── stats/
    │       ├── sessions/
    │       ├── attacks/
    │       ├── requests/
    │       ├── map/
    │       └── snapshots/
    ├── components/dashboard/
    ├── lib/                    # auth, db, utils
    ├── prisma/
    ├── middleware.ts
    ├── Dockerfile
    ├── Dockerfile.studio
    ├── .dockerignore
    └── .env.local
```

---

## قاعدة البيانات

```sql
sessions      -- الجلسات + GeoIP (country, city, lat, lng, isp)
requests      -- طلبات HTTP كاملة
events        -- أحداث السلوك (mouse, click, key, scroll)
attacks       -- الهجمات المكتشفة مع التصنيف
page_snapshots -- لقطات DOM للصفحات
users         -- مستخدمو الـ Dashboard
```

```bash
# مسح البيانات
docker exec honeypot-postgres psql -U honeypot -d honeypot \
  -c "TRUNCATE attacks, events, requests, sessions, page_snapshots RESTART IDENTITY CASCADE;"
```

---

## الـ API

### Proxy (8001)
| Endpoint | Method | الوصف |
|---|---|---|
| `/*` | ANY | Reverse proxy لـ WordPress |
| `/hp-events` | POST | أحداث السلوك من JS Tracker |
| `/hp-snapshot` | POST | DOM snapshot |
| `/hp-health` | GET | فحص الصحة |

### Dashboard (3000)
| Endpoint | الوصف |
|---|---|
| `POST /api/auth/login` | تسجيل دخول |
| `GET /api/stats` | إحصاءات عامة |
| `GET /api/sessions` | قائمة الجلسات |
| `GET /api/attacks` | الهجمات (مع فلترة) |
| `GET /api/requests` | الطلبات (مع بحث) |
| `GET /api/map` | بيانات الخريطة |
| `GET /api/snapshots?sessionId=` | DOM snapshots |

---

## اختبار الهجمات

```bash
BASE="http://localhost:8001"

# SQL Injection
curl "$BASE/?id=1' OR 1=1--"
curl -X POST "$BASE/wp-login.php" --data "log=admin' OR '1'='1&pwd=x"

# XSS
curl "$BASE/?q=<script>alert(1)</script>"

# Path Traversal
curl "$BASE/?file=../../etc/passwd"

# Command Injection
curl "$BASE/?cmd=;whoami"

# Brute Force
for i in {1..6}; do
  curl -s -X POST "$BASE/wp-login.php" --data "log=admin&pwd=pass$i" -o /dev/null
done

# Scanner Detection
curl "$BASE/" -H "User-Agent: sqlmap/1.7"
curl "$BASE/" -H "User-Agent: Nikto/2.1.6"
curl "$BASE/" -H "User-Agent: OWASP ZAP/2.14.0"
```

---

## الأمان

- WordPress **غير مكشوف** خارج Docker
- كلمات المرور مشفرة بـ **bcrypt** (cost 12)
- JWT tokens تنتهي بعد **24 ساعة**
- Payloads تُقطَّع عند **8KB**
- **غيّر كلمات المرور الافتراضية** في الإنتاج

---

> ⚠️ **للأغراض التعليمية والبحثية فقط.** استخدم في بيئات تحت سيطرتك الكاملة.

