import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type SettingsRow = {
  enabled: boolean;
  request_threshold: number;
};

type BlockedIpRow = {
  ip_address: string;
  reason: string | null;
  hit_count: number;
  first_blocked_at: Date;
  last_seen_at: Date;
};

type CountRow = {
  total: bigint;
};

function clampThreshold(value: number): number {
  const normalized = Math.round(Number(value) || 12);
  return Math.min(500, Math.max(1, normalized));
}

function sanitizeIpInput(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 120);
}

async function ensureIpBlockingTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ip_blocking_settings (
      id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled           BOOLEAN NOT NULL DEFAULT FALSE,
      request_threshold INTEGER NOT NULL DEFAULT 12,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO ip_blocking_settings (id, enabled, request_threshold)
    VALUES (1, FALSE, 12)
    ON CONFLICT (id) DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS blocked_ips (
      ip_address       TEXT PRIMARY KEY,
      reason           TEXT,
      hit_count        INTEGER NOT NULL DEFAULT 0,
      first_blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readState(limit: number = 200) {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
  const settingsRows = await prisma.$queryRaw<SettingsRow[]>`
    SELECT enabled, request_threshold
    FROM ip_blocking_settings
    WHERE id = 1
    LIMIT 1
  `;
  const settings = settingsRows[0] || { enabled: false, request_threshold: 12 };

  const blockedRows = await prisma.$queryRaw<BlockedIpRow[]>`
    SELECT ip_address, reason, hit_count, first_blocked_at, last_seen_at
    FROM blocked_ips
    ORDER BY last_seen_at DESC
    LIMIT ${safeLimit}
  `;
  const countRows = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS total
    FROM blocked_ips
  `;
  const blockedCount = Number(countRows[0]?.total ?? 0);

  return {
    enabled: Boolean(settings.enabled),
    threshold: clampThreshold(settings.request_threshold),
    blockedCount,
    blockedIps: blockedRows.map((row) => ({
      ip: row.ip_address,
      reason: row.reason,
      hitCount: Number(row.hit_count || 0),
      blockedAt: row.first_blocked_at?.toISOString?.() || null,
      lastSeenAt: row.last_seen_at?.toISOString?.() || null,
    })),
  };
}

export async function GET() {
  try {
    await ensureIpBlockingTables();
    const state = await readState(400);
    return NextResponse.json(state);
  } catch (err) {
    console.error("IP blocking GET error:", err);
    return NextResponse.json({ error: "Failed to load IP blocking state" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await ensureIpBlockingTables();
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const nextEnabled = typeof body.enabled === "boolean" ? body.enabled : null;
    const thresholdInput = body.threshold;
    const hasThreshold = typeof thresholdInput === "number";
    const nextThreshold = hasThreshold ? clampThreshold(Number(thresholdInput)) : null;

    const result = await prisma.$transaction(async (tx) => {
      const currentRows = await tx.$queryRaw<SettingsRow[]>`
        SELECT enabled, request_threshold
        FROM ip_blocking_settings
        WHERE id = 1
        LIMIT 1
      `;
      const current = currentRows[0] || { enabled: false, request_threshold: 12 };
      const mergedEnabled = nextEnabled ?? Boolean(current.enabled);
      const mergedThreshold = nextThreshold ?? clampThreshold(current.request_threshold);

      await tx.$executeRaw`
        INSERT INTO ip_blocking_settings (id, enabled, request_threshold, updated_at)
        VALUES (1, ${mergedEnabled}, ${mergedThreshold}, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          enabled = EXCLUDED.enabled,
          request_threshold = EXCLUDED.request_threshold,
          updated_at = NOW()
      `;

      let clearedCount = 0;
      if (!mergedEnabled) {
        const deleted = await tx.$executeRaw`DELETE FROM blocked_ips`;
        clearedCount = Number(deleted || 0);
      }

      return { mergedEnabled, mergedThreshold, clearedCount };
    });

    const state = await readState(400);
    return NextResponse.json({
      ...state,
      enabled: result.mergedEnabled,
      threshold: result.mergedThreshold,
      clearedCount: result.clearedCount,
    });
  } catch (err) {
    console.error("IP blocking PATCH error:", err);
    return NextResponse.json({ error: "Failed to update IP blocking state" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureIpBlockingTables();
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const ip = sanitizeIpInput(body.ip);
    if (!ip) {
      return NextResponse.json({ error: "IP is required" }, { status: 400 });
    }

    const deleted = await prisma.$executeRaw`DELETE FROM blocked_ips WHERE ip_address = ${ip}`;
    const state = await readState(400);
    return NextResponse.json({
      ...state,
      unblockedIp: ip,
      removed: Number(deleted || 0) > 0,
    });
  } catch (err) {
    console.error("IP blocking DELETE error:", err);
    return NextResponse.json({ error: "Failed to unblock IP" }, { status: 500 });
  }
}
