// honeypot/dashboard/app/api/uploads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readFileSync, existsSync } from "fs";
import path from "path";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page  = parseInt(searchParams.get("page")  || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const skip  = (page - 1) * limit;

  try {
    const [uploads, total] = await Promise.all([
      prisma.capturedUpload.findMany({
        skip,
        take: limit,
        orderBy: { timestamp: "desc" },
        include: {
          session: {
            select: { ipAddress: true, country: true, city: true },
          },
        },
      }),
      prisma.capturedUpload.count(),
    ]);

    return NextResponse.json({
      uploads: uploads.map((u) => ({
        id:           u.id.toString(),
        originalName: u.originalName,
        mimeType:     u.mimeType,
        sizeBytes:    u.sizeBytes,
        savedPath:    u.savedPath,
        uploadField:  u.uploadField,
        timestamp:    u.timestamp,
        sessionId:    u.sessionId,
        ip:           u.session?.ipAddress,
        country:      u.session?.country,
        city:         u.session?.city,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Uploads error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}