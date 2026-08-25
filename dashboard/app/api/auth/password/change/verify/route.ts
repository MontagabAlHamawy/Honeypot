import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { verifyAndConsumeOtp } from "@/lib/otp";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const challengeId = String(body.challengeId || "");
    const otp = String(body.otp || "");

    if (!challengeId || !otp) {
      return NextResponse.json({ error: "OTP and challenge are required." }, { status: 400 });
    }

    const verified = await verifyAndConsumeOtp({
      challengeId,
      purpose: "password_change",
      code: otp,
    });
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error || "OTP verification failed." }, { status: 401 });
    }

    if (verified.userId !== session.userId) {
      return NextResponse.json({ error: "OTP challenge does not belong to current user." }, { status: 403 });
    }

    const newPasswordHash = String(verified.payload?.newPasswordHash || "");
    if (!newPasswordHash) {
      return NextResponse.json({ error: "Missing password update payload." }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.userId },
      data: { passwordHash: newPasswordHash },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Password change OTP verify error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
