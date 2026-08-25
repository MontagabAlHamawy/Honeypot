# ─────────────────────────────────────────────────────────────
# HoneyShield – Makefile
# ─────────────────────────────────────────────────────────────

# ══════════════════════════════
# وضع الإنتاج (كل شيء في Docker)
# ══════════════════════════════
prod:
	docker compose up --build

prod-down:
	docker compose down

prod-clean:
	docker compose down -v

# ══════════════════════════════
# وضع التطوير (فقط البنية التحتية في Docker)
# ══════════════════════════════
infra:
	docker compose -f docker-compose.dev.yml up

infra-down:
	docker compose -f docker-compose.dev.yml down

# تثبيت مكتبات الـ proxy
proxy-install:
	cd proxy && pip install -r requirements.txt

# تشغيل الـ proxy محلياً
proxy-dev:
	cd proxy && python main.py

# تثبيت مكتبات الـ dashboard
dashboard-install:
	cd dashboard && npm install

# تشغيل الـ dashboard محلياً
dashboard-dev:
	cd dashboard && npx prisma generate && npm run dev

# تشغيل كل شيء في وضع التطوير (في 3 terminals منفصلة)
# Terminal 1: make infra
# Terminal 2: make proxy-dev
# Terminal 3: make dashboard-dev

.PHONY: prod prod-down prod-clean infra infra-down proxy-install proxy-dev dashboard-install dashboard-dev
