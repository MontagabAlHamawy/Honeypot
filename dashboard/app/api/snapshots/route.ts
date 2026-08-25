// honeypot/dashboard/app/api/snapshots/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const snapshots = await prisma.pageSnapshot.findMany({
      where: { sessionId },
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      select: {
        id: true,
        path: true,
        html: true,
        viewportWidth: true,
        viewportHeight: true,
        scrollX: true,
        scrollY: true,
        timestamp: true,
      },
    });

    return NextResponse.json(
      snapshots.map((s) => ({
        id: s.id.toString(),
        path: s.path,
        html: s.html,
        viewportWidth: s.viewportWidth,
        viewportHeight: s.viewportHeight,
        scrollX: s.scrollX,
        scrollY: s.scrollY,
        timestamp: s.timestamp.toISOString(),
        // Epoch ms for timeline matching
        ts: s.timestamp.getTime(),
      }))
    );
  } catch (err) {
    console.error("Snapshots error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
