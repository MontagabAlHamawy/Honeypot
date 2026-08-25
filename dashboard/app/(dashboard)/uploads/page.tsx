// honeypot/dashboard/app/(dashboard)/uploads/page.tsx
"use client";

import { useEffect, useState } from "react";
import {
  Upload, Download, ChevronLeft, ChevronRight,
  FileText, Image as ImageIcon, Archive, Code,
  Eye, X, AlertTriangle,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

interface UploadEntry {
  id: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  savedPath: string;
  uploadField: string | null;
  timestamp: string;
  sessionId: string | null;
  ip: string | null;
  country: string | null;
}

// ── helpers ──────────────────────────────────────────────────
function fileIcon(mime: string | null, name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (mime?.startsWith("image/")) return <ImageIcon className="w-4 h-4 text-blue-400" />;
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext))
    return <Archive className="w-4 h-4 text-yellow-400" />;
  if (["php", "js", "py", "sh", "rb", "pl", "asp", "jsp", "html", "xml"].includes(ext))
    return <Code className="w-4 h-4 text-red-400" />;
  return <FileText className="w-4 h-4 text-muted-foreground" />;
}

function dangerLevel(name: string): { label: string; cls: string } {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const critical = ["php", "exe", "sh", "bat", "py", "js", "jsp", "asp", "cmd", "ps1", "vbs", "rb", "pl", "elf"];
  if (critical.includes(ext))
    return { label: "DANGEROUS", cls: "text-red-400 bg-red-400/10 border-red-400/30" };
  const warn = ["zip", "tar", "gz", "rar", "7z", "jar", "war", "apk"];
  if (warn.includes(ext))
    return { label: "ARCHIVE", cls: "text-orange-400 bg-orange-400/10 border-orange-400/30" };
  return { label: "FILE", cls: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30" };
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function isPreviewable(mime: string | null, name: string): boolean {
  if (!mime) return false;
  if (mime.startsWith("image/")) return true;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const textExts = ["txt", "log", "csv", "json", "xml", "html", "htm", "php",
                    "py", "js", "ts", "sh", "bat", "css", "md", "yaml", "yml", "ini", "conf"];
  if (textExts.includes(ext)) return true;
  if (mime.startsWith("text/")) return true;
  return false;
}

// ── Preview Modal ─────────────────────────────────────────────
function PreviewModal({ upload, onClose }: { upload: UploadEntry; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isImage = upload.mimeType?.startsWith("image/");

  useEffect(() => {
    const url = `/api/uploads/${upload.id}?preview=1`;
    if (isImage) {
      setImgSrc(url);
      setLoading(false);
    } else {
      fetch(url)
        .then(async (r) => {
          if (!r.ok) {
            const err = await r.json().catch(() => ({ error: "Failed" }));
            throw new Error(err.error || "Failed to load file");
          }
          return r.text();
        })
        .then((text) => { setContent(text); setLoading(false); })
        .catch((e) => { setError(e.message); setLoading(false); });
    }
  }, [upload.id, isImage]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-[95vw] lg:max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-5 py-4 border-b border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {fileIcon(upload.mimeType, upload.originalName)}
            <div>
              <div className="font-mono text-sm font-semibold text-foreground">
                {upload.originalName}
              </div>
              <div className="text-xs text-muted-foreground">
                {upload.mimeType} · {formatSize(upload.sizeBytes)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <a
              href={`/api/uploads/${upload.id}`}
              download={upload.originalName}
              className="flex items-center gap-1.5 bg-secondary hover:bg-primary/10 hover:text-primary text-muted-foreground px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Warning */}
        <div className="px-5 py-2 bg-red-400/5 border-b border-red-400/10 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="text-xs text-red-400">
            This file was uploaded by an attacker. Content is displayed in read-only mode.
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {loading && (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              Loading…
            </div>
          )}
          {error && (
            <div className="bg-red-400/10 border border-red-400/20 rounded-lg p-4 text-sm text-red-400 font-mono">
              {error}
              <p className="text-xs text-muted-foreground mt-2">
                In dev mode: add <code className="text-primary">UPLOADS_DIR=../proxy/uploads</code> to{" "}
                <code className="text-primary">dashboard/.env.local</code>
              </p>
            </div>
          )}
          {imgSrc && !loading && (
            <div className="flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgSrc}
                alt={upload.originalName}
                className="max-w-full max-h-[60vh] object-contain rounded-lg border border-border"
                onError={() => setError("Failed to load image")}
              />
            </div>
          )}
          {content !== null && !loading && (
            <pre className="text-xs font-mono text-muted-foreground bg-secondary/30 rounded-lg p-4 overflow-auto whitespace-pre-wrap break-all max-h-[60vh]">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function UploadsPage() {
  const [uploads, setUploads]   = useState<UploadEntry[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [pages, setPages]       = useState(1);
  const [loading, setLoading]   = useState(true);
  const [preview, setPreview]   = useState<UploadEntry | null>(null);

  useEffect(() => { fetchUploads(); }, [page]);

  async function fetchUploads() {
    setLoading(true);
    const res  = await fetch(`/api/uploads?page=${page}&limit=50`);
    const data = await res.json();
    setUploads(data.uploads || []);
    setTotal(data.total || 0);
    setPages(data.pages || 1);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-3">
            <Upload className="w-6 h-6 text-orange-400" />
            Captured Uploads
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {total.toLocaleString()} files intercepted and quarantined
          </p>
        </div>
        <div className="text-xs font-mono text-muted-foreground bg-secondary px-3 py-1.5 rounded-lg border border-border w-fit">
          Isolated in Docker volume — read-only
        </div>
      </div>

      {/* Warning */}
      <div className="bg-red-400/5 border border-red-400/20 rounded-xl px-4 sm:px-5 py-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-red-400">Security Notice</p>
          <p className="text-xs text-muted-foreground mt-1">
            All uploads were blocked from reaching WordPress and quarantined.
            Files may contain malware — exercise caution when downloading.
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {["File", "Risk", "Size", "IP", "Time", "Actions"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-widest">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-secondary/50 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : uploads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">
                    No uploads intercepted yet.
                    <br />
                    <span className="text-xs opacity-60 mt-1 block">
                      Try uploading a file through the honeypot proxy
                    </span>
                  </td>
                </tr>
              ) : (
                uploads.map((u) => {
                  const danger = dangerLevel(u.originalName);
                  const canPreview = isPreviewable(u.mimeType, u.originalName);
                  return (
                    <tr key={u.id} className="hover:bg-secondary/20 transition-colors">
                      {/* File */}
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {fileIcon(u.mimeType, u.originalName)}
                          <div>
                            <div className="text-sm font-mono text-foreground font-medium">
                              {u.originalName}
                            </div>
                            {u.mimeType && (
                              <div className="text-xs font-mono text-muted-foreground">
                                {u.mimeType}
                              </div>
                            )}
                            {u.sessionId && (
                              <Link href={`/sessions/${u.sessionId}`}
                                className="text-xs font-mono text-primary hover:underline">
                                session {u.sessionId.slice(0, 8)}…
                              </Link>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Risk */}
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${danger.cls}`}>
                          {danger.label}
                        </span>
                      </td>
                      {/* Size */}
                      <td className="px-5 py-3 text-sm font-mono text-muted-foreground">
                        {formatSize(u.sizeBytes)}
                      </td>
                      {/* IP */}
                      <td className="px-5 py-3 text-xs font-mono text-muted-foreground">
                        <div>{u.ip || "—"}</div>
                        {u.country && <div className="opacity-60">{u.country}</div>}
                      </td>
                      {/* Time */}
                      <td className="px-5 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {formatDate(u.timestamp)}
                      </td>
                      {/* Actions */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          {canPreview && (
                            <button
                              onClick={() => setPreview(u)}
                              className="inline-flex items-center gap-1.5 bg-secondary hover:bg-blue-400/10 hover:text-blue-400 text-muted-foreground px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Preview
                            </button>
                          )}
                          <a
                            href={`/api/uploads/${u.id}`}
                            download={u.originalName}
                            className="inline-flex items-center gap-1.5 bg-secondary hover:bg-orange-400/10 hover:text-orange-400 text-muted-foreground px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 py-4 border-t border-border">
            <span className="text-xs font-mono text-muted-foreground">Page {page} of {pages}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 transition-all">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}
                className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 transition-all">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {preview && <PreviewModal upload={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
