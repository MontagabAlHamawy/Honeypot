#!/bin/sh
set -e

check_db_connection() {
node <<'NODE'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$queryRawUnsafe("SELECT 1");
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
NODE
}

ensure_users_table() {
node <<'NODE'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
NODE
}

seed_admin_user() {
node <<'NODE'
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || "montagabalh@gmail.com";
  const password = process.env.ADMIN_PASSWORD || "Admin@123";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Admin already exists");
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { email, passwordHash: hash, role: "admin" },
  });
  console.log("Admin created:", email);
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
NODE
}

echo "Waiting for PostgreSQL..."
MAX_RETRIES="${DB_READY_MAX_RETRIES:-40}"
ATTEMPT=1

while [ "$ATTEMPT" -le "$MAX_RETRIES" ]; do
  if check_db_connection; then
    break
  fi
  echo "  DB not ready (attempt ${ATTEMPT}/${MAX_RETRIES}), retrying in 3s..."
  ATTEMPT=$((ATTEMPT + 1))
  sleep 3
done

if [ "$ATTEMPT" -gt "$MAX_RETRIES" ]; then
  echo "Failed to connect to PostgreSQL after ${MAX_RETRIES} attempts."
  exit 1
fi

echo "Database is reachable."
echo "Ensuring users table exists..."
ensure_users_table

echo "Seeding admin user..."
seed_admin_user

echo "Starting Next.js..."
exec node server.js
