// honeypot/dashboard/app/(dashboard)/sessions/[id]/page.tsx
import { notFound } from "next/navigation";
import DeleteSessionButton from "@/components/dashboard/DeleteSessionButton";
import { prisma } from "@/lib/db";
import SessionReplay from "@/components/dashboard/SessionReplay";
import { SeverityBadge, AttackTypeBadge, MethodBadge } from "@/components/dashboard/Badges";
import { formatDate } from "@/lib/utils";

async function getSession(id: string) {
  try {
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        requests: { orderBy: [{ timestamp: "asc" }, { id: "asc" }], take: 200 },
        attacks: { orderBy: [{ timestamp: "asc" }, { id: "asc" }] },
        events: { orderBy: [{ timestamp: "asc" }, { id: "asc" }], take: 5000 },
        loginAttempts: { orderBy: { timestamp: "desc" }, take: 100 },
        recordings: { orderBy: { recordedAt: "desc" }, take: 20 },
        recordingConsent: true,
      },
    });
    return session;
  } catch {
    return null;
  }
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();

  const serialized = {
    ...session,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    requests: session.requests.map((r) => ({
      ...r,
      id: r.id.toString(),
      timestamp: r.timestamp.toISOString(),
    })),
    attacks: session.attacks.map((a) => ({
      ...a,
      id: a.id.toString(),
      timestamp: a.timestamp.toISOString(),
    })),
    events: session.events.map((e) => ({
      ...e,
      id: e.id.toString(),
      timestamp: e.timestamp.toISOString(),
      dataJson: e.dataJson,
    })),
    loginAttempts: session.loginAttempts.map((l) => ({
      ...l,
      id: l.id.toString(),
      timestamp: l.timestamp.toISOString(),
    })),
    recordings: session.recordings.map((r) => ({
      ...r,
      id: r.id.toString(),
      recordedAt: r.recordedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      sizeBytes: r.sizeBytes ? Number(r.sizeBytes) : 0,
    })),
  };

  const durationSeconds = Math.max(
    0,
    Math.floor(((session.endedAt ?? new Date()).getTime() - session.startedAt.getTime()) / 1000)
  );
  const pagesVisited = new Set(session.requests.map((r) => r.path)).size;
  const actionsPerMinute =
    session.events.length > 0
      ? Number((session.events.length / Math.max(1, durationSeconds / 60)).toFixed(2))
      : 0;

  const fmtDuration = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-2">
            <a href="/sessions" className="hover:text-primary transition-colors">Sessions</a>
            <span>/</span>
            <span className="text-foreground">{id.slice(0, 8)}…</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Session Replay</h1>
        </div>
        <DeleteSessionButton sessionId={id} />
      </div>

      {/* Meta */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "IP Address", value: session.ipAddress },
          { label: "Location", value: [session.city, session.country].filter(Boolean).join(", ") || "Unknown" },
          { label: "ISP", value: session.isp || "Unknown" },
          { label: "Started", value: formatDate(session.startedAt) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">{label}</div>
            <div className="text-sm font-mono text-foreground font-medium truncate">{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="text-xs font-mono text-muted-foreground">
          Session Status: {session.endedAt ? `Closed at ${formatDate(session.endedAt)}` : "Live / active tab"}
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          Source Tab ID: {session.sourceTabId || "N/A"}
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          Duration: {fmtDuration(durationSeconds)} | Pages visited: {pagesVisited}
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          Actions/min: {actionsPerMinute} | Events: {session.events.length}
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          Recording consent: {session.recordingConsent?.consentGiven ? "Yes" : "No"}
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          Stored recordings: {serialized.recordings.length}
        </div>
      </div>

      {/* WordPress Login Attempts */}
      {serialized.loginAttempts.length > 0 && (
        <div className="bg-card border border-border rounded-xl">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
              WordPress Login Attempts ({serialized.loginAttempts.length})
            </h2>
          </div>
          <div className="divide-y divide-border">
            {serialized.loginAttempts.map((l) => (
              <div key={l.id} className="px-4 sm:px-5 py-3 grid grid-cols-1 md:grid-cols-5 gap-2 text-xs font-mono">
                <span className="text-muted-foreground">User: {l.username || "unknown"}</span>
                <span className="text-muted-foreground">IP: {l.ipAddress || "unknown"}</span>
                <span className={l.status === "success" ? "text-green-400" : "text-red-400"}>
                  Status: {l.status}
                </span>
                <span className="text-muted-foreground">{formatDate(l.timestamp)}</span>
                <span className="text-muted-foreground truncate">{l.userAgent || "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session Recordings */}
      {serialized.recordings.length > 0 && (
        <div className="bg-card border border-border rounded-xl">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
              Session Recordings ({serialized.recordings.length})
            </h2>
          </div>
          <div className="divide-y divide-border">
            {serialized.recordings.map((r) => (
              <div key={r.id} className="px-4 sm:px-5 py-3 grid grid-cols-1 md:grid-cols-4 gap-2 text-xs font-mono text-muted-foreground">
                <span className="truncate">Path: {r.savedPath}</span>
                <span>Type: {r.mimeType || "unknown"}</span>
                <span>Size: {Math.round((r.sizeBytes || 0) / 1024)} KB</span>
                <span>{formatDate(r.recordedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* UA */}
      {session.userAgent && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">User Agent</div>
          <div className="text-xs font-mono text-muted-foreground">{session.userAgent}</div>
        </div>
      )}

      {/* Session Replay */}
      <SessionReplay events={serialized.events as any} sessionId={id} />

      {/* Attacks */}
      {session.attacks.length > 0 && (
        <div className="bg-card border border-border rounded-xl">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
              Detected Attacks ({session.attacks.length})
            </h2>
          </div>
          <div className="divide-y divide-border">
            {serialized.attacks.map((a) => (
              <div key={a.id} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                <AttackTypeBadge type={a.attackType} />
                <SeverityBadge severity={a.severity} />
                <span className="text-xs font-mono text-muted-foreground">{a.path}</span>
                <span className="text-xs font-mono text-muted-foreground sm:ml-auto whitespace-nowrap">
                  {formatDate(a.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Requests */}
      <div className="bg-card border border-border rounded-xl">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
            HTTP Requests ({session.requests.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                {["Method", "Path", "Status", "Time"].map((h) => (
                  <th key={h} className="px-4 sm:px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {serialized.requests.map((r) => (
                <tr key={r.id} className="hover:bg-secondary/20">
                  <td className="px-4 sm:px-5 py-3"><MethodBadge method={r.method} /></td>
                  <td className="px-4 sm:px-5 py-3 text-xs font-mono text-muted-foreground max-w-xs truncate">{r.path}</td>
                  <td className="px-4 sm:px-5 py-3 text-xs font-mono">
                    <span className={r.responseStatus && r.responseStatus >= 400 ? "text-red-400" : "text-green-400"}>
                      {r.responseStatus || "—"}
                    </span>
                  </td>
                  <td className="px-4 sm:px-5 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">{formatDate(r.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
