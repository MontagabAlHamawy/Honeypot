import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

function riskLevelFromSeverity(severity: string): "low" | "medium" | "high" {
  const s = (severity || "").toLowerCase();
  if (s === "critical" || s === "high") return "high";
  if (s === "medium") return "medium";
  return "low";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const type = searchParams.get("type");
  const severity = searchParams.get("severity");
  const skip = (page - 1) * limit;

  const where = {
    ...(type ? { attackType: type } : {}),
    ...(severity ? { severity } : {}),
  };

  try {
    const [attacks, total] = await Promise.all([
      prisma.attack.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: "desc" },
        include: {
          session: {
            select: { ipAddress: true, country: true, city: true, userAgent: true },
          },
        },
      }),
      prisma.attack.count({ where }),
    ]);

    return NextResponse.json({
      attacks: attacks.map((a) => ({
        id: a.id.toString(),
        attackType: a.attackType,
        severity: a.severity,
        payload: a.payload,
        path: a.path,
        confidence: a.confidence,
        score: a.score,
        detector: a.detector,
        toolHint: a.toolHint,
        behaviorPattern: a.behaviorPattern,
        frequency1m: a.frequency1m,
        requestMethod: a.requestMethod,
        requestQuery: a.requestQuery,
        requestHeaders: a.requestHeaders,
        requestBody: a.requestBody,
        attackDetails: a.attackDetails,
        riskLevel: riskLevelFromSeverity(a.severity),
        reason:
          (Array.isArray(a.attackDetails) && a.attackDetails.length > 0
            ? String(a.attackDetails[0])
            : null) ||
          a.behaviorPattern ||
          a.payload ||
          "No additional explanation",
        timestamp: a.timestamp,
        sessionId: a.sessionId,
        ip: a.ipAddress || a.session?.ipAddress,
        country: a.country || a.session?.country,
        city: a.city || a.session?.city,
        userAgent: a.userAgent || a.session?.userAgent,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Attacks error:", err);
    return NextResponse.json({ error: "Failed to load attacks" }, { status: 500 });
  }
}
