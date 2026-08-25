"use client";

import React from "react";

import { useEffect, useState } from "react";
import { MethodBadge } from "@/components/dashboard/Badges";
import { formatDate } from "@/lib/utils";
import { List, Search, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

interface Req {
  id: string;
  method: string;
  path: string;
  queryString: string | null;
  payload: string | null;
  responseStatus: number | null;
  timestamp: string;
  sessionId: string | null;
  ip: string | null;
  country: string | null;
}

export default function RequestsPage() {
  const [requests, setRequests] = useState<Req[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetchRequests();
  }, [page, search]);

  async function fetchRequests() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (search) params.set("search", search);
    const res = await fetch(`/api/requests?${params}`);
    const data = await res.json();
    setRequests(data.requests || []);
    setTotal(data.total || 0);
    setPages(data.pages || 1);
    setLoading(false);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  function statusColor(status: number | null) {
    if (!status) return "text-muted-foreground";
    if (status < 300) return "text-green-400";
    if (status < 400) return "text-yellow-400";
    return "text-red-400";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-3">
            <List className="w-6 h-6 text-primary" />
            Request Explorer
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {total.toLocaleString()} captured HTTP requests
          </p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search path, method, payload…"
            className="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
          />
        </div>
        <button
          type="submit"
          className="w-full sm:w-auto bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-all"
        >
          Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}
            className="w-full sm:w-auto bg-secondary text-muted-foreground px-4 py-2.5 rounded-lg text-sm font-medium hover:text-foreground transition-all"
          >
            Clear
          </button>
        )}
      </form>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {["Method", "Path", "IP", "Country", "Status", "Time", "Session"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-5 py-4">
                          <div className="h-4 bg-secondary/50 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                : requests.length === 0
                ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground">
                      No requests found
                    </td>
                  </tr>
                )
                : requests.map((r) => (
                    <React.Fragment key={r.id}>
                      <tr
                        className="hover:bg-secondary/20 transition-colors cursor-pointer"
                        onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      >
                        <td className="px-5 py-3"><MethodBadge method={r.method} /></td>
                        <td className="px-5 py-3 text-xs font-mono text-muted-foreground max-w-[240px] truncate">
                          {r.path}{r.queryString ? `?${r.queryString}` : ""}
                        </td>
                        <td className="px-5 py-3 text-xs font-mono text-muted-foreground">{r.ip || "—"}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">{r.country || "—"}</td>
                        <td className={`px-5 py-3 text-xs font-mono font-semibold ${statusColor(r.responseStatus)}`}>
                          {r.responseStatus || "—"}
                        </td>
                        <td className="px-5 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                          {formatDate(r.timestamp)}
                        </td>
                        <td className="px-5 py-3">
                          {r.sessionId && (
                            <Link
                              href={`/sessions/${r.sessionId}`}
                              className="text-xs font-mono text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {r.sessionId.slice(0, 8)}…
                            </Link>
                          )}
                        </td>
                      </tr>
                      {expanded === r.id && r.payload && (
                        <tr key={`${r.id}-exp`} className="bg-secondary/10">
                          <td colSpan={7} className="px-5 py-4">
                            <div className="text-xs text-muted-foreground uppercase tracking-widest mb-2">Payload</div>
                            <pre className="text-xs font-mono text-muted-foreground bg-secondary/30 border border-border rounded-lg px-4 py-3 overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                              {r.payload}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
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
    </div>
  );
}
