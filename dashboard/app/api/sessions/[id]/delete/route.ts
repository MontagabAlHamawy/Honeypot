// honeypot/dashboard/app/api/sessions/[id]/delete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Delete in correct FK order
    await prisma.attack.deleteMany({ where: { sessionId: id } });
    await prisma.event.deleteMany({ where: { sessionId: id } });
    await prisma.request.deleteMany({ where: { sessionId: id } });
    await prisma.pageSnapshot.deleteMany({ where: { sessionId: id } });
    await prisma.capturedUpload.deleteMany({ where: { sessionId: id } });
    await prisma.session.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Session delete error:", err);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}