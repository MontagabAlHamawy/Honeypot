#!/bin/bash
# ─────────────────────────────────────────────────────────
# fix-wp-urls.sh
# يصلح siteurl و home في قاعدة بيانات WordPress
# بحيث يشير للـ proxy بدل WordPress المباشر
#
# الاستخدام:
#   bash fix-wp-urls.sh                    # default: localhost:8000
#   bash fix-wp-urls.sh 192.168.1.100:8000 # IP مخصص
# ─────────────────────────────────────────────────────────

PROXY_URL="${1:-https://kgdtnc9g-8001.uks1.devtunnels.ms/}"

echo "🔧 Setting WordPress siteurl and home to: $PROXY_URL"

docker exec honeypot-wp-db mysql \
  -u wordpress \
  -pwordpress_secret \
  wordpress \
  -e "
UPDATE wp_options SET option_value = '${PROXY_URL}' WHERE option_name = 'siteurl';
UPDATE wp_options SET option_value = '${PROXY_URL}' WHERE option_name = 'home';
SELECT option_name, option_value FROM wp_options WHERE option_name IN ('siteurl','home');
"

echo ""
echo "✅ Done! WordPress now points to: $PROXY_URL"
echo "   Clear your browser cache then visit: $PROXY_URL"
