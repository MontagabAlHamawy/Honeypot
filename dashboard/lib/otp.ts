import crypto from "crypto";
import { prisma } from "@/lib/db";

export type OtpPurpose = "login" | "password_change";

type OtpRow = {
  id: string;
  user_id: string | null;
  email: string;
  purpose: string;
  code_hash: string;
  payload_json: unknown;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
};

const OTP_TTL_SECONDS = Math.max(120, Number(process.env.OTP_TTL_SECONDS || 600));
const OTP_SECRET = process.env.OTP_SECRET || process.env.NEXTAUTH_SECRET || "otp-fallback-secret";
let otpTablesEnsured = false;

export async function ensureOtpTables(): Promise<void> {
  if (otpTablesEnsured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS auth_otp_challenges (
      id          TEXT PRIMARY KEY,
      user_id     TEXT,
      email       TEXT NOT NULL,
      purpose     TEXT NOT NULL,
      code_hash   TEXT NOT NULL,
      payload_json JSONB,
      attempts    INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      expires_at  TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_auth_otp_challenges_email_purpose
    ON auth_otp_challenges (email, purpose, created_at DESC)
  `);
  otpTablesEnsured = true;
}

function sanitizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase().slice(0, 180);
}

function otpHash(challengeId: string, email: string, purpose: OtpPurpose, code: string): string {
  const base = `${challengeId}|${sanitizeEmail(email)}|${purpose}|${String(code || "").trim()}|${OTP_SECRET}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}

export function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function createOtpChallenge(input: {
  userId?: string | null;
  email: string;
  purpose: OtpPurpose;
  payload?: Record<string, unknown>;
  ttlSeconds?: number;
  maxAttempts?: number;
}): Promise<{ challengeId: string; code: string; expiresAt: Date }> {
  await ensureOtpTables();

  const challengeId = crypto.randomUUID();
  const email = sanitizeEmail(input.email);
  const code = generateOtpCode();
  const ttl = Math.max(60, Number(input.ttlSeconds || OTP_TTL_SECONDS));
  const maxAttempts = Math.max(1, Math.min(10, Number(input.maxAttempts || 5)));
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const hash = otpHash(challengeId, email, input.purpose, code);
  const payloadJson = JSON.stringify(input.payload || {});

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO auth_otp_challenges
      (id, user_id, email, purpose, code_hash, payload_json, attempts, max_attempts, expires_at)
    VALUES
      ($1, $2, $3, $4, $5, $6::jsonb, 0, $7, $8::timestamptz)
    `,
    challengeId,
    input.userId || null,
    email,
    input.purpose,
    hash,
    payloadJson,
    maxAttempts,
    expiresAt
  );

  return { challengeId, code, expiresAt };
}

export async function verifyAndConsumeOtp(input: {
  challengeId: string;
  purpose: OtpPurpose;
  code: string;
}): Promise<{
  ok: boolean;
  error?: string;
  userId?: string | null;
  email?: string;
  payload?: Record<string, unknown>;
}> {
  await ensureOtpTables();

  const challengeId = String(input.challengeId || "").trim().slice(0, 120);
  const code = String(input.code || "").trim();
  if (!challengeId || !code) return { ok: false, error: "OTP and challenge are required." };

  const rows = await prisma.$queryRawUnsafe<OtpRow[]>(
    `
    SELECT id, user_id, email, purpose, code_hash, payload_json, attempts, max_attempts, expires_at, consumed_at
    FROM auth_otp_challenges
    WHERE id = $1
    LIMIT 1
    `,
    challengeId
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "Invalid OTP challenge." };

  if (row.purpose !== input.purpose) {
    return { ok: false, error: "OTP purpose mismatch." };
  }
  if (row.consumed_at) {
    return { ok: false, error: "OTP already used." };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "OTP expired." };
  }
  if ((row.attempts || 0) >= (row.max_attempts || 5)) {
    return { ok: false, error: "Maximum OTP attempts reached." };
  }

  const expectedHash = otpHash(challengeId, row.email, input.purpose, code);
  if (expectedHash !== row.code_hash) {
    await prisma.$executeRawUnsafe(
      `
      UPDATE auth_otp_challenges
      SET attempts = attempts + 1
      WHERE id = $1
      `,
      challengeId
    );
    return { ok: false, error: "Invalid OTP code." };
  }

  await prisma.$executeRawUnsafe(
    `
    UPDATE auth_otp_challenges
    SET consumed_at = NOW()
    WHERE id = $1
    `,
    challengeId
  );

  const payload =
    row.payload_json && typeof row.payload_json === "object"
      ? (row.payload_json as Record<string, unknown>)
      : {};
  return { ok: true, userId: row.user_id, email: row.email, payload };
}
