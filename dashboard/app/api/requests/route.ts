import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const search = searchParams.get("search") || "";
  const skip = (page - 1) * limit;

  const where = search
    ? {
        OR: [
          { path: { contains: search, mode: "insensitive" as const } },
          { method: { contains: search, mode: "insensitive" as const } },
          { payload: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  try {
    const [requests, total] = await Promise.all([
      prisma.request.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: "desc" },
        include: {
          session: {
            select: { ipAddress: true, country: true },
          },
        },
      }),
      prisma.request.count({ where }),
    ]);

    return NextResponse.json({
      requests: requests.map((r) => ({
        id: r.id.toString(),
        method: r.method,
        path: r.path,
        queryString: r.queryString,
        payload: r.payload,
        responseStatus: r.responseStatus,
        timestamp: r.timestamp,
        sessionId: r.sessionId,
        ip: r.session?.ipAddress,
        country: r.session?.country,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Requests error:", err);
    return NextResponse.json({ error: "Failed to load requests" }, { status: 500 });
  }
}
