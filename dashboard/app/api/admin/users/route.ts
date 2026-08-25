import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

function normalizeRole(value: unknown): string {
  const role = String(value || "admin").trim().toLowerCase();
  if (role === "admin" || role === "analyst") return role;
  return "analyst";
}

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  return Boolean(session?.userId && session.role === "admin");
}

export async function GET() {
  try {
    const session = await getSession();
    if (!requireAdmin(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("Users GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!requireAdmin(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = normalizeRole(body.role);

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
      },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: created.id,
        email: created.email,
        role: created.role,
        createdAt: created.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("Users POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
