// honeypot/dashboard/app/(dashboard)/attacks/page.tsx
"use client";

import React from "react";

import { useEffect, useState } from "react";
import { SeverityBadge, AttackTypeBadge } from "@/components/dashboard/Badges";
import { formatDate } from "@/lib/utils";
import { Crosshair, ChevronLeft, ChevronRight, Filter, Shield, ShieldOff, Ban, X } from "lucide-react";
import Link from "next/link";

interface Attack {
  id: string;
  attackType: string;
  severity: string;
  payload: string | null;
  path: string | null;
  confidence?: number | null;
  score?: number | null;
  detector?: string | null;
  toolHint?: string | null;
  behaviorPattern?: string | null;
  frequency1m?: number | null;
  requestMethod?: string | null;
  requestQuery?: string | null;
  requestHeaders?: any;
  requestBody?: string | null;
  attackDetails?: any;
  riskLevel?: "low" | "medium" | "high";
  reason?: string;
  timestamp: string;
  sessionId: string | null;
  ip: string | null;
  country: string | null;
  city: string | null;
  userAgent: string | null;
}

interface BlockedIp {
  ip: string;
  reason: string | null;
  hitCount: number;
  blockedAt: string | null;
  lastSeenAt: string | null;
}

const ATTACK_TYPES = ["", "SQL_INJECTION", "XSS", "PATH_TRAVERSAL", "COMMAND_INJECTION", "BRUTE_FORCE", "WP_SCAN", "SCANNER_DETECTED"];
const SEVERITIES = ["", "critical", "high", "medium", "low"];

// Decode URL-encoded and make payload human-readable
function decodePayload(raw: string): string {
  if (!raw) return "";
  try {
    // Try URL decode
    const decoded = decodeURIComponent(raw.replace(/\+/g, " "));
    // If it changed, show both
    if (decoded !== raw) return `${decoded}

(raw: ${raw})`;
    return raw;
  } catch {
    return raw;
  }
}

export default function AttacksPage() {
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ipBlockingEnabled, setIpBlockingEnabled] = useState(false);
  const [ipBlockThreshold, setIpBlockThreshold] = useState(12);
  const [blockedIps, setBlockedIps] = useState<BlockedIp[]>([]);
  const [showBlockedPopup, setShowBlockedPopup] = useState(false);
  const [ipBlockingLoading, setIpBlockingLoading] = useState(true);
  const [ipBlockingSaving, setIpBlockingSaving] = useState(false);
  const [unblockingIp, setUnblockingIp] = useState<string | null>(null);
  const [ipBlockingError, setIpBlockingError] = useState<string | null>(null);

  useEffect(() => {
    fetchAttacks();
  }, [page, typeFilter, severityFilter]);

  useEffect(() => {
    fetchIpBlockingState();
  }, []);

  async function fetchAttacks() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (typeFilter) params.set("type", typeFilter);
    if (severityFilter) params.set("severity", severityFilter);
    const res = await fetch(`/api/attacks?${params}`);
    const data = await res.json();
    setAttacks(data.attacks || []);
    setTotal(data.total || 0);
    setPages(data.pages || 1);
    setLoading(false);
  }

  async function fetchIpBlockingState() {
    setIpBlockingLoading(true);
    setIpBlockingError(null);
    try {
      const res = await fetch("/api/ip-blocking", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIpBlockingEnabled(Boolean(data.enabled));
      setIpBlockThreshold(Number(data.threshold || 12));
      setBlockedIps(Array.isArray(data.blockedIps) ? data.blockedIps : []);
    } catch {
      setIpBlockingError("Failed to load IP blocking state");
    } finally {
      setIpBlockingLoading(false);
    }
  }

  async function toggleIpBlocking(nextEnabled: boolean) {
    if (ipBlockingSaving) return;
    setIpBlockingSaving(true);
    setIpBlockingError(null);
    try {
      const res = await fetch("/api/ip-blocking", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled, threshold: ipBlockThreshold }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIpBlockingEnabled(Boolean(data.enabled));
      setIpBlockThreshold(Number(data.threshold || 12));
      setBlockedIps(Array.isArray(data.blockedIps) ? data.blockedIps : []);
    } catch {
      setIpBlockingError("Failed to update IP blocking state");
    } finally {
      setIpBlockingSaving(false);
    }
  }

  async function unblockIp(ip: string) {
    if (!ip || unblockingIp) return;
    setUnblockingIp(ip);
    setIpBlockingError(null);
    try {
      const res = await fetch("/api/ip-blocking", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIpBlockingEnabled(Boolean(data.enabled));
      setIpBlockThreshold(Number(data.threshold || 12));
      setBlockedIps(Array.isArray(data.blockedIps) ? data.blockedIps : []);
    } catch {
      setIpBlockingError(`Failed to unblock ${ip}`);
    } finally {
      setUnblockingIp(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-3">
            <Crosshair className="w-6 h-6 text-red-400" />
            Attack Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {total.toLocaleString()} total attacks detected
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <button
            type="button"
            onClick={() => toggleIpBlocking(!ipBlockingEnabled)}
            disabled={ipBlockingLoading || ipBlockingSaving}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-mono transition-all ${
              ipBlockingEnabled
                ? "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {ipBlockingEnabled ? <Shield className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
            {ipBlockingEnabled ? "IP Blocking: ON" : "IP Blocking: OFF"}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              Threshold: {ipBlockThreshold}/min
            </span>
            <button
              type="button"
              onClick={() => {
                setShowBlockedPopup(true);
                void fetchIpBlockingState();
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/30 px-2 py-1 text-xs font-mono text-foreground hover:bg-secondary/60 transition-all"
            >
              <Ban className="w-3.5 h-3.5" />
              Blocked IPs ({blockedIps.length})
            </button>
          </div>
          {ipBlockingError && (
            <p className="text-[11px] font-mono text-red-400">{ipBlockingError}</p>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="w-full sm:w-auto bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="">All Types</option>
          {ATTACK_TYPES.filter(Boolean).map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
          className="w-full sm:w-auto bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="">All Severities</option>
          {SEVERITIES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s.toUpperCase()}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {["Type", "Severity", "Risk", "Reason", "IP", "Path", "Time", "Session"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-widest">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-secondary/50 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : attacks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-muted-foreground">
                    No attacks found
                  </td>
                </tr>
              ) : (
                attacks.map((a) => (
                  <React.Fragment key={a.id}>
                    <tr
                      className="hover:bg-secondary/20 transition-colors cursor-pointer"
                      onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                    >
                      <td className="px-5 py-3"><AttackTypeBadge type={a.attackType} /></td>
                      <td className="px-5 py-3"><SeverityBadge severity={a.severity} /></td>
                      <td className="px-5 py-3 text-xs font-mono">
                        <span className={
                          a.riskLevel === "high"
                            ? "text-red-400"
                            : a.riskLevel === "medium"
                              ? "text-yellow-400"
                              : "text-blue-400"
                        }>
                          {(a.riskLevel || "low").toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground max-w-[260px] truncate">
                        {a.reason || (Array.isArray(a.attackDetails) ? a.attackDetails[0] : "—")}
                      </td>
                      <td className="px-5 py-3 text-xs font-mono text-muted-foreground">{a.ip || "—"}</td>
                      <td className="px-5 py-3 text-xs font-mono text-muted-foreground max-w-[200px] truncate">{a.path || "—"}</td>
                      <td className="px-5 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">{formatDate(a.timestamp)}</td>
                      <td className="px-5 py-3">
                        {a.sessionId && (
                          <Link
                            href={`/sessions/${a.sessionId}`}
                            className="text-xs font-mono text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {a.sessionId.slice(0, 8)}…
                          </Link>
                        )}
                      </td>
                    </tr>
                    {expanded === a.id && (
                      <tr key={`${a.id}-expanded`} className="bg-secondary/10">
                        <td colSpan={8} className="px-5 py-4">
                          <div className="space-y-2">
                            <div>
                              <span className="text-xs text-muted-foreground uppercase tracking-widest">Analysis</span>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-mono">
                                <span className="bg-secondary/20 rounded px-2 py-1">
                                  Risk: {(a.riskLevel || "low").toUpperCase()}
                                </span>
                                <span className="bg-secondary/20 rounded px-2 py-1">
                                  Detector: {a.detector || "—"}
                                </span>
                                <span className="bg-secondary/20 rounded px-2 py-1">
                                  Reason: {a.reason || "—"}
                                </span>
                              </div>
                            </div>
                            {a.payload && (
                              <div>
                                <span className="text-xs text-muted-foreground uppercase tracking-widest">Payload</span>
                                <pre className="mt-1 text-xs font-mono text-red-300 bg-red-400/5 border border-red-400/10 rounded-lg px-4 py-3 overflow-x-auto whitespace-pre-wrap break-all">
                                  {decodePayload(a.payload)}
                                </pre>
                              </div>
                            )}
                            {a.userAgent && (
                              <div>
                                <span className="text-xs text-muted-foreground uppercase tracking-widest">User Agent</span>
                                <p className="mt-1 text-xs font-mono text-muted-foreground">{a.userAgent}</p>
                              </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                              <div className="bg-secondary/20 rounded px-2 py-1">
                                <span className="text-muted-foreground">Score:</span> {a.score ?? "—"}
                              </div>
                              <div className="bg-secondary/20 rounded px-2 py-1">
                                <span className="text-muted-foreground">Confidence:</span> {a.confidence != null ? `${Math.round(a.confidence * 100)}%` : "—"}
                              </div>
                              <div className="bg-secondary/20 rounded px-2 py-1">
                                <span className="text-muted-foreground">Detector:</span> {a.detector || "—"}
                              </div>
                              <div className="bg-secondary/20 rounded px-2 py-1">
                                <span className="text-muted-foreground">Tool:</span> {a.toolHint || "—"}
                              </div>
                            </div>
                            {(a.behaviorPattern || a.frequency1m != null) && (
                              <div className="text-xs font-mono text-muted-foreground">
                                Pattern: {a.behaviorPattern || "—"} | Frequency/min: {a.frequency1m ?? "—"}
                              </div>
                            )}
                            {Array.isArray(a.attackDetails) && a.attackDetails.length > 0 && (
                              <div>
                                <span className="text-xs text-muted-foreground uppercase tracking-widest">Detection Evidence</span>
                                <ul className="mt-1 text-xs font-mono text-muted-foreground space-y-1">
                                  {a.attackDetails.slice(0, 8).map((d: string, idx: number) => (
                                    <li key={`${a.id}-detail-${idx}`}>• {d}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 py-4 border-t border-border">
            <span className="text-xs font-mono text-muted-foreground">
              Page {page} of {pages}
            </span>
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

      {showBlockedPopup && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-[95vw] md:max-w-3xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/20">
              <div className="flex items-center gap-2">
                <Ban className="w-4 h-4 text-red-400" />
                <h2 className="text-sm font-semibold text-foreground tracking-wide">Blocked IP Addresses</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowBlockedPopup(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto">
              {blockedIps.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground font-mono">
                  No blocked IPs
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-secondary/20">
                        {["IP", "Hits/Min", "Reason", "Blocked At", "Last Seen", "Action"].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-widest"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {blockedIps.map((entry) => (
                        <tr key={entry.ip} className="hover:bg-secondary/10 transition-colors">
                          <td className="px-4 py-2.5 text-xs font-mono text-foreground">{entry.ip}</td>
                          <td className="px-4 py-2.5 text-xs font-mono text-red-300">{entry.hitCount}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{entry.reason || "--"}</td>
                          <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                            {entry.blockedAt ? formatDate(entry.blockedAt) : "--"}
                          </td>
                          <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                            {entry.lastSeenAt ? formatDate(entry.lastSeenAt) : "--"}
                          </td>
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              onClick={() => void unblockIp(entry.ip)}
                              disabled={Boolean(unblockingIp)}
                              className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-mono text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                              {unblockingIp === entry.ip ? "Unblocking..." : "Unblock"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
