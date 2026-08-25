import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signToken, COOKIE_NAME } from "@/lib/auth";
import { verifyAndConsumeOtp } from "@/lib/otp";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const challengeId = String(body.challengeId || "");
    const otp = String(body.otp || "");

    if (!challengeId || !otp) {
      return NextResponse.json({ error: "OTP and challenge are required" }, { status: 400 });
    }

    const verified = await verifyAndConsumeOtp({
      challengeId,
      purpose: "login",
      code: otp,
    });
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error || "OTP verification failed" }, { status: 401 });
    }

    const userId = verified.userId;
    if (!userId) {
      return NextResponse.json({ error: "OTP challenge is missing user context" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const token = await signToken({ userId: user.id, email: user.email, role: user.role });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 86400,
      path: "/",
    });
    return response;
  } catch (err) {
    console.error("Login OTP verify error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
