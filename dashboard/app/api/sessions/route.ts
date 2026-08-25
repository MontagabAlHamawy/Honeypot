import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const skip = (page - 1) * limit;

  try {
    const [sessions, total] = await Promise.all([
      prisma.session.findMany({
        skip,
        take: limit,
        orderBy: { startedAt: "desc" },
        include: {
          loginAttempts: {
            select: { status: true },
            take: 200,
          },
          recordingConsent: {
            select: { consentGiven: true, updatedAt: true },
          },
          recordings: {
            select: { id: true, recordedAt: true, sizeBytes: true, mimeType: true },
            take: 20,
            orderBy: { recordedAt: "desc" },
          },
          _count: { select: { requests: true, attacks: true, events: true } },
        },
      }),
      prisma.session.count(),
    ]);

    const sessionIds = sessions.map((s) => s.id);
    const pagesPerSession = await Promise.all(
      sessionIds.map(async (sid) => {
        const rows = await prisma.request.findMany({
          where: { sessionId: sid },
          select: { path: true },
          distinct: ["path"],
        });
        return [sid, rows.length] as const;
      })
    );
    const pagesMap = new Map(pagesPerSession);

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        ipAddress: s.ipAddress,
        country: s.country,
        city: s.city,
        region: s.region,
        latitude: s.latitude,
        longitude: s.longitude,
        isp: s.isp,
        userAgent: s.userAgent,
        sourceTabId: s.sourceTabId,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        requestCount: s._count.requests,
        attackCount: s._count.attacks,
        eventCount: s._count.events,
        pagesVisited: pagesMap.get(s.id) || 0,
        durationSeconds: Math.max(
          0,
          Math.floor(((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()) / 1000)
        ),
        actionsPerMinute:
          s._count.events > 0
            ? Number(
                (
                  s._count.events /
                  Math.max(1, ((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()) / 60000)
                ).toFixed(2)
              )
            : 0,
        loginAttempts: s.loginAttempts.length,
        failedLoginAttempts: s.loginAttempts.filter((a) => a.status === "failure").length,
        recordingConsent: s.recordingConsent?.consentGiven || false,
        recordingsCount: s.recordings.length,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Sessions error:", err);
    return NextResponse.json({ error: "Failed to load sessions" }, { status: 500 });
  }
}
