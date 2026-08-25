// PATH: dashboard/app/api/ai/analyze/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_MODELS_URL = "https://models.inference.ai.azure.com/chat/completions";
// نموذج مدعوم في GitHub Models مع Copilot Pro
const MODEL = "gpt-4o";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId: string | undefined = body.sessionId;
    const hoursBack: number = body.hoursBack ?? 24;
    const language: "ar" | "en" = body.language === "en" ? "en" : "ar";
    const languageName = language === "en" ? "English" : "Arabic";

    // ── 1. جلب بيانات الهجمات من قاعدة البيانات ──────────────────────────
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const attacksWhere = sessionId
      ? { sessionId, timestamp: { gte: since } }
      : { timestamp: { gte: since } };

    const [attacks, sessions, totalRequests] = await Promise.all([
      prisma.attack.findMany({
        where: attacksWhere,
        orderBy: { timestamp: "desc" },
        take: 100,
        include: {
          session: {
            select: {
              ipAddress: true,
              country: true,
              city: true,
              userAgent: true,
              isp: true,
            },
          },
        },
      }),
      prisma.session.findMany({
        where: sessionId
          ? { id: sessionId }
          : { startedAt: { gte: since } },
        take: 50,
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          ipAddress: true,
          country: true,
          city: true,
          userAgent: true,
          isp: true,
          startedAt: true,
          _count: { select: { attacks: true, requests: true } },
        },
      }),
      prisma.request.count({
        where: sessionId
          ? { sessionId, timestamp: { gte: since } }
          : { timestamp: { gte: since } },
      }),
    ]);

    if (attacks.length === 0) {
      return NextResponse.json({
        summary:
          language === "ar"
            ? "لا توجد هجمات مسجّلة في الفترة المحددة."
            : "No attacks were recorded in the selected period.",
        attackPatterns: [],
        topThreats: [],
        riskScore: 0,
        recommendations: [],
        mitigations: [],
        geoInsights: [],
        behaviorAnalysis: "",
        rawAnalysis: "",
        attackCount: 0,
        sessionCount: sessions.length,
        requestCount: totalRequests,
        analyzedAt: new Date().toISOString(),
      });
    }

    // ── 2. بناء ملخص إحصائي ───────────────────────────────────────────────
    const severityCount = attacks.reduce(
      (acc, a) => { acc[a.severity] = (acc[a.severity] || 0) + 1; return acc; },
      {} as Record<string, number>
    );

    const typeCount = attacks.reduce(
      (acc, a) => { acc[a.attackType] = (acc[a.attackType] || 0) + 1; return acc; },
      {} as Record<string, number>
    );

    const topAttackers = sessions
      .sort((a, b) => b._count.attacks - a._count.attacks)
      .slice(0, 5)
      .map((s) => ({
        ip: s.ipAddress,
        country: s.country,
        city: s.city,
        isp: s.isp,
        attacks: s._count.attacks,
        requests: s._count.requests,
        userAgent: s.userAgent?.substring(0, 120),
      }));

    const samplePayloads = attacks
      .filter((a) => a.payload)
      .slice(0, 20)
      .map((a) => ({
        type: a.attackType,
        severity: a.severity,
        path: a.path,
        payload: a.payload?.substring(0, 200),
        method: a.requestMethod,
        tool: a.toolHint,
        confidence: a.confidence,
        score: a.score,
      }));

    const countries = [...new Set(
      attacks.map((a) => a.country || a.session?.country).filter(Boolean)
    )];

    const toolsUsed = [...new Set(attacks.map((a) => a.toolHint).filter(Boolean))];

    // ── 3. بناء prompt ────────────────────────────────────────────────────
    const systemPrompt = `You are an expert cybersecurity analyst specializing in web attack analysis and Honeypot systems.
Your task is to analyze detected attack data and produce a detailed, accurate security report in JSON format only.
Do not write any text outside of the JSON. Be precise and practical in your recommendations.
Always respond in ${languageName}.`;

    const userPrompt = `
Analyze the following attack data and return a comprehensive security report:

## General Statistics
- Time period: last ${hoursBack} hours
- Total attacks: ${attacks.length}
- Total sessions: ${sessions.length}
- Total requests: ${totalRequests}

## Severity Distribution
${JSON.stringify(severityCount, null, 2)}

## Attack Types
${JSON.stringify(typeCount, null, 2)}

## Top Attackers
${JSON.stringify(topAttackers, null, 2)}

## Sample Detected Payloads
${JSON.stringify(samplePayloads, null, 2)}

## Geographic Sources
${countries.join(", ")}

## Detected Attack Tools
${toolsUsed.join(", ") || "Not identified"}

Return your response as JSON with EXACTLY this structure:
{
  "summary": "Executive summary (3-4 sentences in ${languageName})",
  "riskScore": <0-100>,
  "riskLevel": "<critical|high|medium|low>",
  "attackPatterns": [
    {
      "pattern": "pattern name in ${languageName}",
      "description": "detailed description in ${languageName}",
      "frequency": <count>,
      "severity": "<critical|high|medium|low>",
      "indicators": ["indicator1", "indicator2"]
    }
  ],
  "topThreats": [
    {
      "threat": "threat name in ${languageName}",
      "detail": "details in ${languageName}",
      "affectedEndpoints": ["endpoint1"],
      "severity": "<critical|high|medium|low>"
    }
  ],
  "behaviorAnalysis": "Detailed behavioral analysis in ${languageName}",
  "toolsAnalysis": "Analysis of attack tools and techniques in ${languageName}",
  "geoInsights": [
    {
      "country": "country name",
      "threatLevel": "<high|medium|low>",
      "note": "note in ${languageName}"
    }
  ],
  "recommendations": [
    {
      "priority": "<immediate|high|medium|low>",
      "category": "<firewall|waf|code|config|monitoring>",
      "title": "recommendation title in ${languageName}",
      "description": "detailed description in ${languageName}",
      "implementation": "practical implementation steps in ${languageName}"
    }
  ],
  "mitigations": [
    {
      "attackType": "attack type in ${languageName}",
      "mitigation": "proposed solution in ${languageName}",
      "codeExample": "code or config example if applicable",
      "urgency": "<immediate|soon|planned>"
    }
  ],
  "conclusionAr": "Final conclusion in ${languageName}"
}`;

    // ── 4. استدعاء GitHub Models API ──────────────────────────────────────
    const response = await fetch(GITHUB_MODELS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("GitHub Models API error:", response.status, errText);
      return NextResponse.json(
        { error: `GitHub Models API error: ${response.status}`, detail: errText },
        { status: 502 }
      );
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "{}";

    let analysis: Record<string, unknown>;
    try {
      const clean = rawContent.replace(/```json|```/g, "").trim();
      analysis = JSON.parse(clean);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response", raw: rawContent },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...analysis,
      attackCount: attacks.length,
      sessionCount: sessions.length,
      requestCount: totalRequests,
      hoursBack,
      analyzedAt: new Date().toISOString(),
      tokensUsed: data.usage?.total_tokens ?? 0,
    });
  } catch (err) {
    console.error("AI analyze error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
