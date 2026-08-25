import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const [
      totalSessions,
      totalRequests,
      totalAttacks,
      attacksByType,
      attacksBySeverity,
      topTargetPaths,
      recentAttacks,
      attacksOverTime,
    ] = await Promise.all([
      prisma.session.count(),
      prisma.request.count(),
      prisma.attack.count(),

      prisma.attack.groupBy({
        by: ["attackType"],
        _count: { _all: true },
        orderBy: { _count: { attackType: "desc" } },
      }),

      prisma.attack.groupBy({
        by: ["severity"],
        _count: { _all: true },
      }),

      prisma.request.groupBy({
        by: ["path"],
        _count: { _all: true },
        orderBy: { _count: { path: "desc" } },
        take: 10,
      }),

      prisma.attack.findMany({
        take: 20,
        orderBy: { timestamp: "desc" },
        include: {
          session: {
            select: { ipAddress: true, country: true, city: true },
          },
        },
      }),

      // Attacks per day (last 14 days)
      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE_TRUNC('day', timestamp)::date::text AS day,
               COUNT(*)::bigint AS count
        FROM attacks
        WHERE timestamp > NOW() - INTERVAL '14 days'
        GROUP BY day
        ORDER BY day ASC
      `,
    ]);

    return NextResponse.json({
      totalSessions,
      totalRequests,
      totalAttacks,
      attacksByType: attacksByType.map((a) => ({
        type: a.attackType,
        count: a._count._all,
      })),
      attacksBySeverity: attacksBySeverity.map((a) => ({
        severity: a.severity,
        count: a._count._all,
      })),
      topTargetPaths: topTargetPaths.map((p) => ({
        path: p.path,
        count: p._count._all,
      })),
      recentAttacks: recentAttacks.map((a) => ({
        id: a.id.toString(),
        attackType: a.attackType,
        severity: a.severity,
        payload: a.payload,
        path: a.path,
        timestamp: a.timestamp,
        ip: a.session?.ipAddress,
        country: a.session?.country,
        city: a.session?.city,
      })),
      attacksOverTime: attacksOverTime.map((r) => ({
        day: r.day,
        count: Number(r.count),
      })),
    });
  } catch (err) {
    console.error("Stats error:", err);
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}
