import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
      where: {
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        ipAddress: true,
        country: true,
        city: true,
        region: true,
        latitude: true,
        longitude: true,
        isp: true,
        startedAt: true,
        _count: { select: { attacks: true } },
      },
    });

    return NextResponse.json(
      sessions.map((s) => ({
        id: s.id,
        ip: s.ipAddress,
        country: s.country,
        city: s.city,
        region: s.region,
        lat: s.latitude,
        lng: s.longitude,
        isp: s.isp,
        startedAt: s.startedAt,
        attackCount: s._count.attacks,
      }))
    );
  } catch (err) {
    console.error("Map data error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
