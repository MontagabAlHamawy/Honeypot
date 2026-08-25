import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { createOtpChallenge } from "@/lib/otp";
import { sendEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Current and new password are required." }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

    const validCurrent = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validCurrent) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    const { challengeId, code, expiresAt } = await createOtpChallenge({
      userId: user.id,
      email: user.email,
      purpose: "password_change",
      payload: { newPasswordHash },
    });

    try {
      await sendEmail({
        to: user.email,
        subject: "HoneyShield OTP - Password Change Confirmation",
        text:
          "A request to change your HoneyShield password was received.\n\n"
          + `OTP Code: ${code}\n`
          + `Expires At (UTC): ${expiresAt.toISOString()}\n\n`
          + "If this wasn't you, please ignore this message.",
      });
    } catch (mailErr) {
      console.error("Password change OTP email error:", mailErr);
      return NextResponse.json(
        { error: "OTP email delivery failed. Please check SMTP configuration." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      otpRequired: true,
      challengeId,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("Password change OTP request error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
