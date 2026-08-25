import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        requests: {
          orderBy: [{ timestamp: "asc" }, { id: "asc" }],
          take: 200,
        },
        attacks: {
          orderBy: [{ timestamp: "asc" }, { id: "asc" }],
        },
        events: {
          orderBy: [{ timestamp: "asc" }, { id: "asc" }],
          take: 5000,
        },
        loginAttempts: {
          orderBy: { timestamp: "desc" },
          take: 200,
        },
        recordings: {
          orderBy: { recordedAt: "desc" },
          take: 50,
        },
        recordingConsent: true,
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...session,
      requests: session.requests.map((r) => ({
        ...r,
        id: r.id.toString(),
      })),
      attacks: session.attacks.map((a) => ({
        ...a,
        id: a.id.toString(),
      })),
      events: session.events.map((e) => ({
        ...e,
        id: e.id.toString(),
      })),
      loginAttempts: session.loginAttempts.map((l) => ({
        ...l,
        id: l.id.toString(),
      })),
      recordings: session.recordings.map((r) => ({
        ...r,
        id: r.id.toString(),
        sizeBytes: r.sizeBytes ? Number(r.sizeBytes) : 0,
      })),
    });
  } catch (err) {
    console.error("Session detail error:", err);
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
  }
}
