// honeypot/dashboard/app/api/uploads/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { existsSync, readFileSync } from "fs";
import path from "path";

// Resolve uploads directory — works in Docker and dev mode
function getUploadsDir(): string {
  // In Docker: mounted at /uploads (set via UPLOADS_DIR env)
  // In dev: proxy saves to ./uploads relative to proxy/ directory
  return process.env.UPLOADS_DIR || "/uploads";
}

function resolveFilePath(savedPath: string): string {
  const uploadsDir = getUploadsDir();

  // savedPath might be absolute (/uploads/xxx) or relative (./uploads/xxx)
  // Normalize: just use the filename + uploads dir
  const filename = path.basename(savedPath);
  const resolved = path.join(uploadsDir, filename);

  if (existsSync(resolved)) return resolved;

  // Try the savedPath directly as fallback
  if (existsSync(savedPath)) return savedPath;

  return "";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const preview = searchParams.get("preview") === "1";

  try {
    const upload = await prisma.capturedUpload.findUnique({
      where: { id: BigInt(id) },
    });

    if (!upload) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const filePath = resolveFilePath(upload.savedPath);

    if (!filePath) {
      return new NextResponse(
        JSON.stringify({
          error: "File not found on disk",
          savedPath: upload.savedPath,
          uploadsDir: getUploadsDir(),
          tip: "In dev mode, set UPLOADS_DIR in dashboard/.env.local to point to the proxy/uploads folder",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const buffer = readFileSync(filePath);
    const mime   = upload.mimeType || "application/octet-stream";

    if (preview) {
      // Serve inline for preview (images, text, etc.)
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Content-Disposition": `inline; filename="${upload.originalName}"`,
          "X-Content-Type-Options": "nosniff",
          // Sandbox the preview — prevent any scripts from running
          "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        },
      });
    }

    // Download
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${upload.originalName}"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (err) {
    console.error("Upload download error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}