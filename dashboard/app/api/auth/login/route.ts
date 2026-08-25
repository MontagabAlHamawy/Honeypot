import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createOtpChallenge } from "@/lib/otp";
import { sendEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const { challengeId, code, expiresAt } = await createOtpChallenge({
      userId: user.id,
      email: user.email,
      purpose: "login",
      payload: { role: user.role },
    });

    try {
      await sendEmail({
        to: user.email,
        subject: "HoneyShield OTP - Login Verification",
        text:
          "A login attempt was detected for your HoneyShield account.\n\n"
          + `OTP Code: ${code}\n`
          + `Expires At (UTC): ${expiresAt.toISOString()}\n\n`
          + "If this wasn't you, please change your password immediately.",
      });
    } catch (mailErr) {
      console.error("Login OTP email error:", mailErr);
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
    console.error("Login error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
