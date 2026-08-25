// PATH: dashboard/app/api/ai/chat/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_MODELS_URL = "https://models.inference.ai.azure.com/chat/completions";
const MODEL = "gpt-4o";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const messages: { role: string; content: string }[] = body.messages || [];
    const sessionId: string | undefined = body.sessionId;
    const preferredLanguage = body.preferredLanguage === "ar" ? "Arabic" : "English";

    // جلب سياق أمني من DB
    const [recentAttacks, activeSessions] = await Promise.all([
      prisma.attack.findMany({
        where: { timestamp: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
        take: 30,
        orderBy: { timestamp: "desc" },
        select: {
          attackType: true,
          severity: true,
          payload: true,
          path: true,
          toolHint: true,
          country: true,
          confidence: true,
        },
      }),
      prisma.session.count({
        where: { startedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      }),
    ]);

    const attackSummary = recentAttacks.slice(0, 15).map((a) => ({
      type: a.attackType,
      severity: a.severity,
      path: a.path,
      tool: a.toolHint,
      country: a.country,
      confidence: a.confidence,
      payload: a.payload?.substring(0, 100),
    }));

    const systemPrompt = `You are HoneyShield AI — a specialized cybersecurity assistant integrated into a WordPress Honeypot monitoring platform.

## Your Role
- Analyze detected attacks on the WordPress Honeypot system
- Answer security team questions accurately and professionally
- Provide practical, implementable recommendations
- Explain attack techniques and defensive methods

## Current System Context (last 24 hours)
- Active sessions: ${activeSessions}
- Total detected attacks: ${recentAttacks.length}
- Attack sample: ${JSON.stringify(attackSummary)}
${sessionId ? `- Session-specific analysis: ${sessionId}` : ""}

## Response Rules
1. Always respond in the same language the user writes in (Arabic or English)
2. If the user's message is ambiguous, default to ${preferredLanguage}
3. Use Markdown to format code blocks and lists
4. Be concise but comprehensive
5. Always include practical examples
6. If asked about unavailable data, clarify and provide what you can

## Your Specializations
- SQL Injection, XSS, CSRF, Path Traversal, Command Injection
- Brute Force detection & mitigation
- Web Application Firewalls (WAF) configuration  
- WordPress security hardening
- OWASP Top 10
- Threat Intelligence & IOC analysis
- Incident Response procedures`;

    const fullMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    // Streaming request to GitHub Models
    const response = await fetch(GITHUB_MODELS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        temperature: 0.5,
        stream: true,
        messages: fullMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("GitHub Models chat error:", response.status, err);
      return new Response(
        JSON.stringify({ error: `GitHub Models API error: ${response.status}`, detail: err }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    // تحويل SSE stream إلى نص خام للعميل
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === "data: [DONE]") continue;
              if (!trimmed.startsWith("data: ")) continue;

              try {
                const json = JSON.parse(trimmed.slice(6));
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                  controller.enqueue(encoder.encode(delta));
                }
              } catch {
                // skip malformed chunks
              }
            }
          }
        } finally {
          controller.close();
          reader.releaseLock();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("AI chat error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
