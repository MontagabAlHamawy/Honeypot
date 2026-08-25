import { cn, severityColor, attackTypeLabel } from "@/lib/utils";

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono",
        severityColor(severity),
        severity === "critical" ? "severity-critical" : ""
      )}
    >
      {severity?.toUpperCase()}
    </span>
  );
}

export function AttackTypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground border border-border font-mono">
      {attackTypeLabel(type)}
    </span>
  );
}

export function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    POST: "text-green-400 bg-green-400/10 border-green-400/20",
    PUT: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
    DELETE: "text-red-400 bg-red-400/10 border-red-400/20",
    PATCH: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono",
        colors[method?.toUpperCase()] || "text-zinc-400 bg-zinc-400/10 border-zinc-400/20"
      )}
    >
      {method}
    </span>
  );
}
