"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";
import { Video, ChevronLeft, ChevronRight, Globe } from "lucide-react";
import Link from "next/link";

interface Session {
  id: string;
  ipAddress: string;
  country: string | null;
  city: string | null;
  userAgent: string | null;
  startedAt: string;
  endedAt?: string | null;
  requestCount: number;
  attackCount: number;
  eventCount: number;
  pagesVisited: number;
  durationSeconds: number;
  actionsPerMinute: number;
  loginAttempts: number;
  failedLoginAttempts: number;
  recordingConsent: boolean;
  recordingsCount: number;
}

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSessions();
  }, [page]);

  async function fetchSessions() {
    setLoading(true);
    const res = await fetch(`/api/sessions?page=${page}&limit=20`);
    const data = await res.json();
    setSessions(data.sessions || []);
    setTotal(data.total || 0);
    setPages(data.pages || 1);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-3">
          <Video className="w-6 h-6 text-primary" />
          Attacker Sessions
        </h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono">
          {total.toLocaleString()} recorded sessions - click to replay
        </p>
      </div>

      <div className="grid gap-3">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 sm:p-5 animate-pulse h-52 sm:h-36" />
            ))
          : sessions.length === 0
          ? (
            <div className="bg-card border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
              No sessions recorded yet
            </div>
          )
          : sessions.map((s) => (
              <Link
                key={s.id}
                href={`/sessions/${s.id}`}
                className="bg-card border border-border rounded-xl p-4 sm:p-5 hover:border-primary/30 hover:bg-card/80 transition-all group block"
              >
                <div className="space-y-3.5">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-secondary border border-border flex items-center justify-center shrink-0 mt-0.5">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold text-foreground">{s.ipAddress}</span>
                        {s.country && (
                          <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                            {s.city ? `${s.city}, ` : ""}{s.country}
                          </span>
                        )}
                        {s.attackCount > 0 && (
                          <span className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-0.5 rounded font-mono">
                            {s.attackCount} attacks
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
                        Started: {formatDate(s.startedAt)}
                      </p>
                      <p className="text-xs font-mono mt-1">
                        <span className={s.endedAt ? "text-zinc-400" : "text-green-400"}>
                          {s.endedAt ? `Closed: ${formatDate(s.endedAt)}` : "Live (tab still active)"}
                        </span>
                      </p>
                    </div>
                    <span className="text-xs font-mono text-primary whitespace-nowrap pl-2">Replay -&gt;</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-secondary/30 border border-border rounded-lg p-2.5 text-center">
                      <div className="text-base font-bold font-mono text-foreground">{s.requestCount}</div>
                      <div className="text-[11px] text-muted-foreground">Requests</div>
                    </div>
                    <div className="bg-secondary/30 border border-border rounded-lg p-2.5 text-center">
                      <div className="text-base font-bold font-mono text-primary">{s.eventCount}</div>
                      <div className="text-[11px] text-muted-foreground">Events</div>
                    </div>
                    <div className="bg-secondary/30 border border-border rounded-lg p-2.5 text-center">
                      <div className="text-base font-bold font-mono text-foreground">{s.pagesVisited}</div>
                      <div className="text-[11px] text-muted-foreground">Pages</div>
                    </div>
                    <div className="bg-secondary/30 border border-border rounded-lg p-2.5 text-center">
                      <div className="text-base font-bold font-mono text-foreground">{s.actionsPerMinute}</div>
                      <div className="text-[11px] text-muted-foreground">Actions/min</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
                    <div className="bg-secondary/20 border border-border rounded-lg px-2.5 py-2 text-muted-foreground">
                      Duration: <span className="text-foreground">{fmtDuration(s.durationSeconds)}</span>
                    </div>
                    <div className="bg-secondary/20 border border-border rounded-lg px-2.5 py-2 text-muted-foreground">
                      Login: <span className="text-foreground">{s.loginAttempts}</span>{" "}
                      failed: <span className="text-red-400">{s.failedLoginAttempts}</span>
                    </div>
                    <div className="bg-secondary/20 border border-border rounded-lg px-2.5 py-2 text-muted-foreground">
                      Consent: <span className="text-foreground">{s.recordingConsent ? "Yes" : "No"}</span>{" "}
                      recordings: <span className="text-foreground">{s.recordingsCount}</span>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground font-mono break-words">
                    {s.userAgent || "Unknown agent"}
                  </p>
                </div>
              </Link>
            ))}
      </div>

      {pages > 1 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs font-mono text-muted-foreground">Page {page} of {pages}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
