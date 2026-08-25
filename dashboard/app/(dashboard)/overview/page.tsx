import { Crosshair, Globe, Activity, Database } from "lucide-react";
import { prisma } from "@/lib/db";
import StatCard from "@/components/dashboard/StatCard";
import { SeverityBadge, AttackTypeBadge } from "@/components/dashboard/Badges";
import { formatDate, attackTypeLabel } from "@/lib/utils";
import AttackChart from "@/components/dashboard/AttackChart";

async function getStats() {
  const [totalSessions, totalRequests, totalAttacks, recentAttacks, attacksByType, attacksOverTime] =
    await Promise.all([
      prisma.session.count(),
      prisma.request.count(),
      prisma.attack.count(),
      prisma.attack.findMany({
        take: 10,
        orderBy: { timestamp: "desc" },
        include: { session: { select: { ipAddress: true, country: true } } },
      }),
      prisma.attack.groupBy({
        by: ["attackType"],
        _count: { _all: true },
        orderBy: { _count: { attackType: "desc" } },
        take: 6,
      }),
      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE_TRUNC('day', timestamp)::date::text AS day, COUNT(*)::bigint AS count
        FROM attacks
        WHERE timestamp > NOW() - INTERVAL '14 days'
        GROUP BY day ORDER BY day ASC
      `,
    ]);

  return {
    totalSessions,
    totalRequests,
    totalAttacks,
    recentAttacks: recentAttacks.map((a) => ({
      id: a.id.toString(),
      attackType: a.attackType,
      severity: a.severity,
      payload: a.payload,
      path: a.path,
      timestamp: a.timestamp.toISOString(),
      ip: a.session?.ipAddress,
      country: a.session?.country,
    })),
    attacksByType: attacksByType.map((a) => ({ type: a.attackType, count: a._count._all })),
    attacksOverTime: (attacksOverTime as any[]).map((r) => ({
      day: r.day,
      count: Number(r.count),
    })),
  };
}

export default async function OverviewPage() {
  const stats = await getStats();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Security Overview</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Real-time honeypot monitoring dashboard
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg px-4 py-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-mono text-primary font-medium">LIVE</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Sessions"
          value={stats.totalSessions.toLocaleString()}
          subtitle="Unique attacker sessions"
          icon={Globe}
          variant="default"
        />
        <StatCard
          title="HTTP Requests"
          value={stats.totalRequests.toLocaleString()}
          subtitle="All intercepted requests"
          icon={Activity}
          variant="default"
        />
        <StatCard
          title="Attacks Detected"
          value={stats.totalAttacks.toLocaleString()}
          subtitle="Classified attack events"
          icon={Crosshair}
          variant="danger"
        />
        <StatCard
          title="Data Captured"
          value={`${Math.round(stats.totalRequests * 0.4)}KB`}
          subtitle="Behavioral events stored"
          icon={Database}
          variant="success"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Attacks over time */}
        <div className="xl:col-span-2 bg-card border border-border rounded-xl p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4 uppercase tracking-widest">
            Attack Frequency (14 days)
          </h2>
          <AttackChart data={stats.attacksOverTime} />
        </div>

        {/* Attack types */}
        <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4 uppercase tracking-widest">
            Attack Types
          </h2>
          {stats.attacksByType.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              No attacks yet
            </div>
          ) : (
            <div className="space-y-3">
              {stats.attacksByType.map((a) => {
                const pct = stats.totalAttacks > 0 ? (a.count / stats.totalAttacks) * 100 : 0;
                return (
                  <div key={a.type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-muted-foreground">
                        {attackTypeLabel(a.type)}
                      </span>
                      <span className="text-xs font-mono text-foreground font-medium">{a.count}</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent attacks */}
      <div className="bg-card border border-border rounded-xl">
        <div className="px-4 sm:px-6 py-4 border-b border-border flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
            Recent Attacks
          </h2>
          <a href="/attacks" className="text-xs text-primary hover:underline font-mono">
            View all →
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Type", "Severity", "IP", "Country", "Path", "Time"].map((h) => (
                  <th
                    key={h}
                    className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-widest"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.recentAttacks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 sm:px-6 py-8 text-center text-sm text-muted-foreground">
                    No attacks detected yet. Send requests to{" "}
                    <code className="font-mono text-primary">http://localhost:8000</code> to start
                    monitoring.
                  </td>
                </tr>
              ) : (
                stats.recentAttacks.map((a) => (
                  <tr key={a.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 sm:px-6 py-3">
                      <AttackTypeBadge type={a.attackType} />
                    </td>
                    <td className="px-4 sm:px-6 py-3">
                      <SeverityBadge severity={a.severity} />
                    </td>
                    <td className="px-4 sm:px-6 py-3 text-sm font-mono text-muted-foreground">
                      {a.ip || "—"}
                    </td>
                    <td className="px-4 sm:px-6 py-3 text-sm text-muted-foreground">{a.country || "—"}</td>
                    <td className="px-4 sm:px-6 py-3 text-xs font-mono text-muted-foreground max-w-[180px] truncate">
                      {a.path || "—"}
                    </td>
                    <td className="px-4 sm:px-6 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {formatDate(a.timestamp)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
